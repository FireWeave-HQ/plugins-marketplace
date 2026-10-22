import { join } from "node:path";

// FireWeave's shell-command gate (hooks/fw-shell-gate.sh): a plain `fw tool`
// command runs after the sign-in check, any other way of running `fw tool` is
// refused, and so are `gh pr merge --admin` and `gh api … rulesets` in a cloud
// agent or CI.
export const fwShellGate = async ({ $ }) => ({
  "tool.execute.before": async (input, output) => {
    if (input?.tool !== "bash") return;
    const command = output?.args?.command;
    if (typeof command !== "string" || !/fw(\.exe)?\s+tool|gh\s/.test(command)) return;
    const gate = join(import.meta.dir, "..", "hooks", "fw-shell-gate.sh");
    const input_ = new Response(JSON.stringify({ command }));
    const r = await $`bash ${gate} exit < ${input_}`.quiet().nothrow();
    if (r.exitCode !== 0) {
      throw new Error(r.stderr.toString().trim() || "FireWeave refused this command");
    }
  },
});
