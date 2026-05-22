function computeWaves(scenarios) {
  if (scenarios.length === 0) {
    return { waves: [] };
  }
  const ordered = scenarios.map((scenario, index) => ({
    scenario,
    tieBreaker: Number.isFinite(scenario.sourceOrder) ? scenario.sourceOrder : index
  })).sort((a, b) => a.tieBreaker - b.tieBreaker).map(({ scenario }) => scenario);
  const idSet = new Set(ordered.map((s) => s.id));
  for (const scenario of ordered) {
    if (scenario.dependsOn.includes(scenario.id)) {
      return {
        waves: [],
        error: {
          kind: "self-ref",
          details: `${scenario.id} cannot depend on itself`
        }
      };
    }
  }
  for (const scenario of ordered) {
    for (const dep of scenario.dependsOn) {
      if (!idSet.has(dep)) {
        return {
          waves: [],
          error: {
            kind: "dangling",
            details: `${scenario.id} depends on ${dep} which does not exist`
          }
        };
      }
    }
  }
  const waveByScenario = /* @__PURE__ */ new Map();
  const waves = [];
  const remaining = new Set(ordered.map((s) => s.id));
  while (remaining.size > 0) {
    const wave = [];
    for (const scenario of ordered) {
      if (!remaining.has(scenario.id)) continue;
      const allDepsAssigned = scenario.dependsOn.every(
        (dep) => waveByScenario.has(dep)
      );
      if (allDepsAssigned) {
        wave.push(scenario.id);
      }
    }
    if (wave.length === 0) {
      const cyclePath = findCycle(ordered, remaining);
      return {
        waves: [],
        error: {
          kind: "cycle",
          details: `dependency cycle detected: ${cyclePath.join(" \u2192 ")}`
        }
      };
    }
    const waveIndex = waves.length;
    for (const id of wave) {
      waveByScenario.set(id, waveIndex);
      remaining.delete(id);
    }
    waves.push(wave);
  }
  return { waves };
}
function findCycle(ordered, remaining) {
  const byId = /* @__PURE__ */ new Map();
  for (const scenario of ordered) {
    byId.set(scenario.id, scenario);
  }
  const start = ordered.find(
    (s) => remaining.has(s.id) && s.dependsOn.some((dep) => remaining.has(dep))
  );
  if (!start) {
    return Array.from(remaining);
  }
  const path = [];
  const onPath = /* @__PURE__ */ new Set();
  let current = start.id;
  while (current !== void 0) {
    if (onPath.has(current)) {
      const cycleStart = path.indexOf(current);
      const cycleMembers = path.slice(cycleStart);
      return [...cycleMembers, current];
    }
    path.push(current);
    onPath.add(current);
    const node = byId.get(current);
    if (!node) break;
    current = node.dependsOn.find((dep) => remaining.has(dep));
  }
  return path;
}
export {
  computeWaves
};
