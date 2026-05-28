import { buildChildEnv } from "./child-env.js";
const DEFAULT_BASH_TIMEOUT_MS = 3e4;
const DEFAULT_MAX_OUTPUT_BYTES = 1024 * 1024;
function makeRunBash(opts = {}) {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_BASH_TIMEOUT_MS;
  const maxOutputBytes = opts.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  const hostEnv = opts.hostEnv ?? process.env;
  return async (cmd, env) => {
    const { spawn } = await import("node:child_process");
    let timedOut = false;
    let outputCapped = false;
    let killed = false;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    timer.unref?.();
    try {
      return await new Promise((resolve) => {
        const child = spawn("bash", ["-c", cmd], {
          env: buildChildEnv(hostEnv, env),
          stdio: ["ignore", "pipe", "pipe"],
          signal: controller.signal,
          detached: true
        });
        let stdout = "";
        let stderr = "";
        let stdoutBytes = 0;
        let stderrBytes = 0;
        const capStream = (buf, accBytes, chunk) => {
          if (outputCapped) return { buf, bytes: accBytes };
          const remaining = maxOutputBytes - accBytes;
          if (chunk.length <= remaining) {
            return { buf: buf + chunk.toString(), bytes: accBytes + chunk.length };
          }
          outputCapped = true;
          const kept = remaining > 0 ? buf + chunk.subarray(0, remaining).toString() : buf;
          controller.abort();
          return { buf: kept, bytes: maxOutputBytes };
        };
        child.stdout?.on("data", (d) => {
          const r = capStream(stdout, stdoutBytes, d);
          stdout = r.buf;
          stdoutBytes = r.bytes;
        });
        child.stderr?.on("data", (d) => {
          const r = capStream(stderr, stderrBytes, d);
          stderr = r.buf;
          stderrBytes = r.bytes;
        });
        const killGroup = (sig) => {
          if (killed) return;
          killed = true;
          if (typeof child.pid !== "number") return;
          try {
            process.kill(-child.pid, sig);
          } catch {
          }
        };
        const onAbort = () => {
          killGroup("SIGTERM");
          const escalate = setTimeout(() => killGroup("SIGKILL"), 250);
          escalate.unref?.();
        };
        if (controller.signal.aborted) onAbort();
        else controller.signal.addEventListener("abort", onAbort, { once: true });
        const abortMarker = () => outputCapped ? `
[killed: output exceeded ${maxOutputBytes} bytes]` : "\n[killed by timeout]";
        child.on("close", (code, sig) => {
          const wasKilled = timedOut || outputCapped || sig !== null;
          const exitCode = wasKilled ? 124 : code ?? -1;
          const stderrOut = wasKilled ? stderr + abortMarker() : stderr;
          resolve({ exitCode, stdout, stderr: stderrOut });
        });
        child.on("error", (err) => {
          const isAbort = err.code === "ABORT_ERR" || err.name === "AbortError";
          if (isAbort || timedOut || outputCapped) {
            resolve({ exitCode: 124, stdout, stderr: stderr + abortMarker() });
            return;
          }
          resolve({ exitCode: -1, stdout, stderr: stderr + err.message });
        });
      });
    } finally {
      clearTimeout(timer);
    }
  };
}
export {
  DEFAULT_BASH_TIMEOUT_MS,
  DEFAULT_MAX_OUTPUT_BYTES,
  makeRunBash
};
