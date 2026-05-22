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

export interface Scenario {
  id: string
  dependsOn: string[]
  sourceOrder: number
}

export type ComputeWavesError =
  | { kind: "self-ref"; details: string }
  | { kind: "dangling"; details: string }
  | { kind: "cycle"; details: string }

export interface ComputeWavesResult {
  waves: string[][]
  error?: ComputeWavesError
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
export function computeWaves(scenarios: Scenario[]): ComputeWavesResult {
  if (scenarios.length === 0) {
    return { waves: [] }
  }

  // Preserve the caller's source order. Callers may pass `sourceOrder`
  // explicitly, but we also accept the array order itself as a fallback so
  // that callers that forget to set the field still get deterministic output.
  // Build a stable copy keyed by source order (asc).
  const ordered = scenarios
    .map((scenario, index) => ({
      scenario,
      tieBreaker: Number.isFinite(scenario.sourceOrder)
        ? scenario.sourceOrder
        : index,
    }))
    .sort((a, b) => a.tieBreaker - b.tieBreaker)
    .map(({ scenario }) => scenario)

  const idSet = new Set(ordered.map((s) => s.id))

  // 1) Self-reference validation. Surface the first offender — the prompt
  //    contract says "BE-02 cannot depend on itself".
  for (const scenario of ordered) {
    if (scenario.dependsOn.includes(scenario.id)) {
      return {
        waves: [],
        error: {
          kind: "self-ref",
          details: `${scenario.id} cannot depend on itself`,
        },
      }
    }
  }

  // 2) Dangling-reference validation. A reference to an unknown id (or to
  //    a scenario dropped during sanitisation) aborts before any work is
  //    dispatched. Surface the first offender deterministically.
  for (const scenario of ordered) {
    for (const dep of scenario.dependsOn) {
      if (!idSet.has(dep)) {
        return {
          waves: [],
          error: {
            kind: "dangling",
            details: `${scenario.id} depends on ${dep} which does not exist`,
          },
        }
      }
    }
  }

  // 3) Kahn's algorithm — assign each scenario the earliest wave whose
  //    dependencies have all been emitted. Within a wave we preserve source
  //    order (the `ordered` traversal order) as the deterministic tie-breaker.
  const waveByScenario = new Map<string, number>()
  const waves: string[][] = []
  const remaining = new Set(ordered.map((s) => s.id))

  while (remaining.size > 0) {
    const wave: string[] = []
    for (const scenario of ordered) {
      if (!remaining.has(scenario.id)) continue
      const allDepsAssigned = scenario.dependsOn.every((dep) =>
        waveByScenario.has(dep),
      )
      if (allDepsAssigned) {
        wave.push(scenario.id)
      }
    }

    if (wave.length === 0) {
      // No node has zero in-degree across the remaining set → there is at
      // least one cycle. Find an actual cycle among the remaining ids and
      // surface it by name so the user sees `A → B → A`.
      const cyclePath = findCycle(ordered, remaining)
      return {
        waves: [],
        error: {
          kind: "cycle",
          details: `dependency cycle detected: ${cyclePath.join(" → ")}`,
        },
      }
    }

    const waveIndex = waves.length
    for (const id of wave) {
      waveByScenario.set(id, waveIndex)
      remaining.delete(id)
    }
    waves.push(wave)
  }

  return { waves }
}

/**
 * Find one cycle inside `remaining` by following an outgoing edge until we
 * revisit a node already on the current path. Used only when Kahn detected
 * a stall, so a cycle is guaranteed to exist among `remaining`. Traverses
 * in source order to make the named cycle deterministic across runs.
 */
function findCycle(
  ordered: Scenario[],
  remaining: Set<string>,
): string[] {
  const byId = new Map<string, Scenario>()
  for (const scenario of ordered) {
    byId.set(scenario.id, scenario)
  }

  // Pick the earliest-in-source-order remaining scenario whose deps land
  // inside `remaining` (those are the nodes participating in cycles).
  const start = ordered.find(
    (s) =>
      remaining.has(s.id) &&
      s.dependsOn.some((dep) => remaining.has(dep)),
  )
  if (!start) {
    // Defensive: should be unreachable because Kahn stalled.
    return Array.from(remaining)
  }

  const path: string[] = []
  const onPath = new Set<string>()
  let current: string | undefined = start.id

  while (current !== undefined) {
    if (onPath.has(current)) {
      const cycleStart = path.indexOf(current)
      const cycleMembers = path.slice(cycleStart)
      // Close the loop visually so `A → B → A` reads as a true cycle.
      return [...cycleMembers, current]
    }
    path.push(current)
    onPath.add(current)
    const node = byId.get(current)
    if (!node) break
    // Follow the first dep that still lives in `remaining` (i.e. part of
    // the stalled subgraph). Iterate in declared order so cycle naming is
    // deterministic across runs.
    current = node.dependsOn.find((dep) => remaining.has(dep))
  }

  // Defensive fallback — see above note about unreachability.
  return path
}
