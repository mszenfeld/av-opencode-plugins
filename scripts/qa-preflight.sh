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
    # Cap each probe at 3s. Accept 2xx/3xx/401/403 as reachable.
    local code
    code=$(curl -sS -o /dev/null -w "%{http_code}" --max-time 3 "$url" 2>/dev/null || echo "000")
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
            if ! command -v pg_isready >/dev/null 2>&1; then
                echo "MISSING db:$dsn (client tool 'pg_isready' not installed)"
                return
            fi
            # Strip scheme, parse host:port/db. Format: postgresql://host:port/db
            local rest="${dsn#postgresql://}"; rest="${rest#postgres://}"
            local hostport="${rest%%/*}"
            local dbname="${rest#*/}"
            local host="${hostport%:*}"
            local port="${hostport#*:}"
            if pg_isready -h "$host" -p "$port" -d "$dbname" -t 3 >/dev/null 2>&1; then
                echo "OK db:$dsn"
            else
                echo "MISSING db:$dsn (pg_isready failed)"
            fi
            ;;
        mysql://*)
            if ! command -v mysqladmin >/dev/null 2>&1; then
                echo "MISSING db:$dsn (client tool 'mysqladmin' not installed)"
                return
            fi
            local rest="${dsn#mysql://}"
            local hostport="${rest%%/*}"
            local host="${hostport%:*}"
            local port="${hostport#*:}"
            if mysqladmin ping -h "$host" -P "$port" --silent >/dev/null 2>&1; then
                echo "OK db:$dsn"
            else
                echo "MISSING db:$dsn (mysqladmin ping failed)"
            fi
            ;;
        redis://*)
            if ! command -v redis-cli >/dev/null 2>&1; then
                echo "MISSING db:$dsn (client tool 'redis-cli' not installed)"
                return
            fi
            local rest="${dsn#redis://}"
            local host="${rest%:*}"
            local port="${rest#*:}"
            if redis-cli -h "$host" -p "$port" ping >/dev/null 2>&1; then
                echo "OK db:$dsn"
            else
                echo "MISSING db:$dsn (redis-cli ping failed)"
            fi
            ;;
        sqlite:///*)
            local path="${dsn#sqlite:///}"
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
