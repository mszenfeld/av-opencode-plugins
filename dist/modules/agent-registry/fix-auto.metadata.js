const fixAutoSpecialistInfo = {
  name: "fix-auto",
  mode: "subagent",
  description: "Auto-fix code issues from reports. Used when the user accepts a fix proposal after a QA run.",
  metadata: {
    category: "utility",
    cost: "CHEAP",
    triggers: []
  }
};
export {
  fixAutoSpecialistInfo
};
