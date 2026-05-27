import { buildChildEnv } from "./child-env.js";
const DEFAULT_BASH_TIMEOUT_MS = 3e4;
function makeRunBash(opts = {}) {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_BASH_TIMEOUT_MS;
  const hostEnv = opts.hostEnv ?? process.env;
  return async (cmd, env) => {
    const { spawn } = await import("node:child_process");
    let timedOut = false;
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
        child.stdout?.on("data", (d) => {
          stdout += d.toString();
        });
        child.stderr?.on("data", (d) => {
          stderr += d.toString();
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
        child.on("close", (code, sig) => {
          const wasKilled = timedOut || sig !== null;
          const exitCode = wasKilled ? 124 : code ?? -1;
          const stderrOut = wasKilled ? stderr + "\n[killed by timeout]" : stderr;
          resolve({ exitCode, stdout, stderr: stderrOut });
        });
        child.on("error", (err) => {
          const isAbort = err.code === "ABORT_ERR" || err.name === "AbortError";
          if (isAbort || timedOut) {
            resolve({ exitCode: 124, stdout, stderr: stderr + "\n[killed by timeout]" });
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
  makeRunBash
};
