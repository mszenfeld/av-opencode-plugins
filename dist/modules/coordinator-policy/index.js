import {
  buildViolationError,
  classifyCoordinatorBash,
  isCoordinatorSession
} from "@appverk/opencode-skill-utils";
import { readCoordinatorBashAllowlist } from "./read-allowlist.js";
function makeBashGate(client, allowed) {
  return async (input, output) => {
    if (input.tool !== "bash") return;
    if (!await isCoordinatorSession(input.sessionID, client)) return;
    const command = String(output.args?.command ?? "");
    const verdict = classifyCoordinatorBash(command, allowed);
    if (!verdict.allowed) throw buildViolationError({ tool: "bash", command, reason: "not-allowlisted" });
  };
}
const AppVerkCoordinatorPolicyPlugin = async ({ client }) => {
  const allowed = readCoordinatorBashAllowlist();
  const gate = makeBashGate(client, allowed);
  return {
    "tool.execute.before": gate
  };
};
export {
  AppVerkCoordinatorPolicyPlugin,
  makeBashGate
};
