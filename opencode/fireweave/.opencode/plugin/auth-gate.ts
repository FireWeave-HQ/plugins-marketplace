import { join } from "node:path";

// Auth gate: block the first Fireweave rollout MCP tool until `fw` auth is ready.
export const fwAuthGate = async ({ $ }) => ({
  "tool.execute.before": async (input) => {
    const gated = ["rollout-server_", "fireweave-cloud-bridge_"];
    if (!gated.some((p) => typeof input?.tool === "string" && input.tool.startsWith(p))) return;
    const gate = join(import.meta.dir, "..", "hooks", "fw-auth-gate-core.sh");
    const r = await $`bash ${gate}`.quiet().nothrow();
    if (r.exitCode !== 0) {
      throw new Error("Fireweave auth gate failed — run: fw login");
    }
  },
});
