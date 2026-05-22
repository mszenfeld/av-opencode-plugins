/**
 * Pure helper that turns a dependency-annotated scenario list into a
 * topologically-ordered list of waves (Kahn's algorithm).
 *
 * Wave 0 = scenarios with no dependencies.
 * Wave N+1 = scenarios whose dependencies all live in some wave ≤ N.
 * Within a wave, scenarios are emitted in source order (the order they
 * appear in the input array as captured by `sourceOrder`). This makes the
 * dispatch order deterministic and matches what Perun emits in `tasks[]`.
 *
 * Extracted from Perun's prompt (steps 5d–5e) so the cycle/wave logic is
 * pure TypeScript that can be unit-tested. See MAINT-002 in
 * `docs/reviews/2026-05-19-feature-harness-2.md`.
 */
interface Scenario {
    id: string;
    dependsOn: string[];
    sourceOrder: number;
}
type ComputeWavesError = {
    kind: "self-ref";
    details: string;
} | {
    kind: "dangling";
    details: string;
} | {
    kind: "cycle";
    details: string;
};
interface ComputeWavesResult {
    waves: string[][];
    error?: ComputeWavesError;
}
/**
 * Compute dispatch waves from a flat scenario list.
 *
 * - Returns `{ waves: [] }` for empty input (the dispatcher uses this to
 *   abort with "no executable scenarios").
 * - Returns `{ waves: [], error }` on validation failure. The caller is
 *   responsible for surfacing the error to the user without dispatching.
 * - Otherwise returns `{ waves }` where each inner array is the wave's
 *   scenario IDs in source order.
 */
declare function computeWaves(scenarios: Scenario[]): ComputeWavesResult;

export { type ComputeWavesError, type ComputeWavesResult, type Scenario, computeWaves };
