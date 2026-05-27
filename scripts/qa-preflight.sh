#!/usr/bin/env bash
# QA preflight probe runner. Reads probe descriptors from stdin, emits OK/MISSING lines to stdout.
#
# Stdin format (one per line, tab-separated):
#   env<TAB>VAR_NAME
#   service<TAB>URL
#   db<TAB>DSN
#
# Stdout format (one per line):
#   OK <ident>
#   MISSING <ident> (<reason>)
#
# Exit code: always 0. The caller (Perun) parses stdout to count gaps.
# Security: NEVER prints env-var values. Only names and OK/MISSING.

set -u  # treat unset as error inside the script itself; intentionally no `-e` (we
        # never want a single probe failure to abort the whole run)

probe_env() {
    local name="$1"
    # Defense in depth (SEC-006): Perun pre-validates env var names against
    # `^[A-Z_][A-Z0-9_]*$`, but reject invalid names here too so the script is
    # safe to run from any caller. The case-guard mirrors the regex:
    #   - empty string is rejected outright,
    #   - `*[!A-Z0-9_]*` matches any character outside `[A-Z0-9_]` anywhere,
    #   - `[!A-Z_]*` matches a leading digit (or any non-letter/underscore).
    # We deliberately do NOT call `printenv` for invalid names — even though
    # `printenv` itself wouldn't dereference an arbitrary string as a shell
    # var, keeping the rejection at the boundary makes the contract explicit.
    case "$name" in
        ""|*[!A-Z0-9_]*|[!A-Z_]*)
            echo "MISSING env:$name (invalid env var name)"
            return ;;
    esac
    # printenv exits 0 if set, 1 if not. Redirect stdout so the value never
    # reaches our pipeline — only the exit code matters.
    if printenv "$name" >/dev/null 2>&1; then
        echo "OK env:$name"
    else
        echo "MISSING env:$name (not set in process env)"
    fi
}

probe_service() {
    local url="$1"
    # Guard against argument injection (CWE-88): a URL beginning with `-`
    # would be parsed by curl as a flag (e.g. `-K /tmp/cfg` reads a config
    # file). Restrict to http:// and https:// schemes before invoking curl,
    # and pass `--` so any future allowed scheme still can't be misread.
    case "$url" in
        http://*|https://*) ;;
        *) echo "MISSING service:$url (unsupported scheme — must be http:// or https://)"; return ;;
    esac
    # Cap each probe at 3s. Accept 2xx/3xx/401/403 as reachable.
    local code
    code=$(curl -sS -o /dev/null -w "%{http_code}" --max-time 3 -- "$url" 2>/dev/null || echo "000")
    case "$code" in
        2*|3*|401|403) echo "OK service:$url" ;;
        000)           echo "MISSING service:$url (connection failure)" ;;
        *)             echo "MISSING service:$url (HTTP $code)" ;;
    esac
}

probe_db() {
    local dsn="$1"
    # Dispatch by scheme prefix.
    case "$dsn" in
        postgresql://*|postgres://*)
            # Strip scheme, then strip optional `user:pass@` credentials segment
            # (no-op if `@` is absent). Then split on `/` for dbname, and on `:`
            # for host:port with a default-port fallback when port is omitted.
            local rest="${dsn#postgresql://}"; rest="${rest#postgres://}"
            # Greedy `##*@`: strip up to and including the LAST `@`. Per RFC 3986
            # a raw `@` in userinfo must be percent-encoded, so the last `@` is
            # always the credential/host separator. A non-greedy `#*@` would
            # misparse passwords containing literal `@` (e.g. `user:pa@ss@host`).
            rest="${rest##*@}"
            # IPv6 hosts are wrapped in `[...]` in DSNs (RFC 3986 host syntax)
            # but the colon-split logic below cannot handle them without
            # ambiguity (a `:` inside `[::1]` would be misread as the port
            # separator). Reject early with a clear message rather than
            # silently producing a garbled host:port. This check runs BEFORE
            # the client-tool guard so the diagnostic is deterministic
            # regardless of whether `pg_isready` is installed.
            if [[ "$rest" == \[* ]]; then
                echo "MISSING db:$dsn (IPv6 DSNs not yet supported — use IPv4 or hostname)"
                return
            fi
            if ! command -v pg_isready >/dev/null 2>&1; then
                echo "MISSING db:$dsn (client tool 'pg_isready' not installed)"
                return
            fi
            local hostport="${rest%%/*}"
            local dbname="${rest#*/}"
            local host port
            if [[ "$hostport" == *:* ]]; then
                host="${hostport%:*}"
                port="${hostport#*:}"
            else
                host="$hostport"
                port="5432"
            fi
            if pg_isready -h "$host" -p "$port" -d "$dbname" -t 3 >/dev/null 2>&1; then
                echo "OK db:$dsn"
            else
                echo "MISSING db:$dsn (pg_isready failed)"
            fi
            ;;
        mysql://*)
            local rest="${dsn#mysql://}"
            # See postgresql branch for `##*@` rationale (greedy strip to last `@`).
            rest="${rest##*@}"
            # See postgresql branch: IPv6 hosts wrapped in `[...]` are rejected
            # early (before the client-tool guard) to avoid ambiguous
            # colon-split between host and port.
            if [[ "$rest" == \[* ]]; then
                echo "MISSING db:$dsn (IPv6 DSNs not yet supported — use IPv4 or hostname)"
                return
            fi
            if ! command -v mysqladmin >/dev/null 2>&1; then
                echo "MISSING db:$dsn (client tool 'mysqladmin' not installed)"
                return
            fi
            local hostport="${rest%%/*}"
            local host port
            if [[ "$hostport" == *:* ]]; then
                host="${hostport%:*}"
                port="${hostport#*:}"
            else
                host="$hostport"
                port="3306"
            fi
            if mysqladmin ping -h "$host" -P "$port" --silent >/dev/null 2>&1; then
                echo "OK db:$dsn"
            else
                echo "MISSING db:$dsn (mysqladmin ping failed)"
            fi
            ;;
        redis://*)
            local rest="${dsn#redis://}"
            # See postgresql branch for `##*@` rationale (greedy strip to last `@`).
            rest="${rest##*@}"
            # See postgresql branch: IPv6 hosts wrapped in `[...]` are rejected
            # early (before the client-tool guard) to avoid ambiguous
            # colon-split between host and port.
            if [[ "$rest" == \[* ]]; then
                echo "MISSING db:$dsn (IPv6 DSNs not yet supported — use IPv4 or hostname)"
                return
            fi
            if ! command -v redis-cli >/dev/null 2>&1; then
                echo "MISSING db:$dsn (client tool 'redis-cli' not installed)"
                return
            fi
            local hostport="$rest"
            local host port
            if [[ "$hostport" == *:* ]]; then
                host="${hostport%:*}"
                port="${hostport#*:}"
            else
                host="$hostport"
                port="6379"
            fi
            if redis-cli -h "$host" -p "$port" ping >/dev/null 2>&1; then
                echo "OK db:$dsn"
            else
                echo "MISSING db:$dsn (redis-cli ping failed)"
            fi
            ;;
        sqlite:///*)
            # SEC-003 (CWE-200): without a path allowlist, this branch is a
            # file-existence oracle for any world-readable file on the host
            # (e.g. `sqlite:////etc/passwd` would probe /etc/passwd).
            #
            # SQLAlchemy convention: 3 slashes (`sqlite:///foo.db`) means a
            # project-relative path; 4 slashes (`sqlite:////tmp/foo.db`) means
            # an absolute path. After stripping `sqlite://` (2 slashes), the
            # absolute form still starts with TWO `/` (`//tmp/foo.db`) while
            # the relative form has only ONE (`/foo.db`). The `//*` pattern
            # below matches only the 2+ leading-slash case, so absolute DSNs
            # are rejected and relative DSNs proceed. The `*..*` pattern
            # rejects path traversal (`sqlite:///../etc/passwd`).
            local rel="${dsn#sqlite://}"
            case "$rel" in
                //*|*..*)
                    echo "MISSING db:$dsn (sqlite path must be project-relative, no traversal)"
                    return ;;
            esac
            # Strip the single leading `/` left from the 3-slash relative form
            # so `$path` is a true project-relative filesystem path.
            local path="${rel#/}"
            if [ -r "$path" ]; then
                echo "OK db:$dsn"
            else
                echo "MISSING db:$dsn (file not readable: $path)"
            fi
            ;;
        *)
            echo "MISSING db:$dsn (unrecognised DSN scheme — must be postgresql:// / mysql:// / redis:// / sqlite:///)"
            ;;
    esac
}

# Read stdin descriptors. Format is tab-separated `kind<TAB>value`.
while IFS=$'\t' read -r kind value; do
    case "$kind" in
        env)     probe_env "$value" ;;
        service) probe_service "$value" ;;
        db)      probe_db "$value" ;;
        '')      ;;  # skip blank lines
        *)       echo "MISSING $kind:$value (unknown probe kind '$kind')" ;;
    esac
done
