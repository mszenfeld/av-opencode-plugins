import { Plugin } from '@opencode-ai/plugin';
import { createOpencodeClient, Message } from '@opencode-ai/sdk';

/**
 * Neutralizes specialist output before it is returned to the coordinator.
 *
 * Specialist results may originate from attacker-controlled surfaces (an
 * attacker-controlled web page rendered by Playwright, `curl` output from an
 * attacker-controlled server, etc.). When the coordinator (@perun) parses the
 * result string back into its own prompt context, hostile content could
 * plausibly influence subsequent tool invocations (prompt re-injection).
 *
 * This function does NOT try to make the content "safe" semantically — that is
 * @perun's job via guardrail rules in perun.md. It removes the most obvious
 * vectors that exploit terminal/markdown rendering:
 *
 *   - ANSI escape sequences (CSI `\x1b[...m` style) that can hide content in
 *     terminals or in some markdown renderers.
 *   - ASCII control characters (except whitespace `\n`, `\r`, `\t`) that can
 *     hide or distort text.
 *   - Angle-bracketed substrings that look like HTML or pseudo tags
 *     (`<script>`, `<system>`, etc.) — escaped so they render verbatim instead
 *     of being interpreted as instructions or tags.
 */
declare function neutralizeUntrustedOutput(s: string): string;
/**
 * Derives the canonical report file path from a plan path.
 *
 * Strips the `YYYY-MM-DD-` prefix and `-test-plan` suffix from the plan
 * basename, validates the remaining topic against `[a-z0-9-]+`, and returns
 * a POSIX path under `docs/testing/reports/`.
 *
 * Throws if the derived topic is empty or contains characters that could be
 * exploited for path traversal or filename injection.
 *
 * Example:
 *   deriveReportPath("docs/testing/plans/2026-05-18-example-auth-test-plan.md",
 *                    "2026-05-18")
 *   → "docs/testing/reports/2026-05-18-example-auth-report.md"
 */
declare function deriveReportPath(planPath: string, today: string): string;

interface PollerMessage {
    role: string;
    content: string;
    finish_reason?: string | null | undefined;
}

interface DispatchSpecialist {
    startTask(agentName: string, prompt: string): Promise<string>;
    fetchMessages(sessionId: string): Promise<PollerMessage[]>;
    /**
     * Cancel a previously-started session. Called when `ToolContext.abort`
     * fires so the child session is cleaned up server-side (no orphaned
     * compute, no charges) — see COMPOSITE-3 / ARCH-001. Implementations
     * should treat this as best-effort: errors must not surface to the
     * caller (the abort path already returns an "aborted" result).
     */
    abortTask(sessionId: string): Promise<void>;
}
interface AgentInfo {
    mode: "primary" | "subagent" | "all";
}

/**
 * SDK adapter layer: bridges the strongly-typed OpenCode SDK client into the
 * plain `DispatchSpecialist` / `AgentInfo` shapes that `dispatchParallel`
 * consumes. Extracting this here keeps `index.ts` thin and — crucially — makes
 * the adapter independently unit-testable with a fake `OpencodeClient` (see
 * `tests/sdk-specialist.test.ts`).
 */
type SDKClient = ReturnType<typeof createOpencodeClient>;
declare function createSDKSpecialist(client: SDKClient, parentSessionID: string): DispatchSpecialist;
declare function toPollerMessage(raw: {
    info: Message;
    parts: Array<{
        type: string;
        text?: string;
    }>;
}): PollerMessage;
declare function loadAgentRegistry(client: SDKClient): Promise<Record<string, AgentInfo>>;

declare const AppVerkCoordinatorPlugin: Plugin;

export { AppVerkCoordinatorPlugin, createSDKSpecialist, deriveReportPath, loadAgentRegistry, neutralizeUntrustedOutput, toPollerMessage };
