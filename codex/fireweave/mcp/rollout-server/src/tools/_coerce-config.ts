/**
 * Helper for the 7 verify_* tools.
 *
 * The MCP wire serializes complex object args differently across clients —
 * Claude Code's LLM sometimes JSON-stringifies a `config` argument before
 * sending, depending on schema constraints. The verify_* tools declare
 * `config: z.unknown()`, which accepts both shapes but doesn't normalise
 * them. Without this helper, `verify_*` tools that cast `args.config` as
 * `RolloutConfig` blow up at the first property access when the arg is a
 * string.
 *
 * Behavior:
 * - Object passes through unchanged.
 * - String → JSON.parse; throw a useful error if the parse fails.
 * - Anything else (number, boolean, null) → throw with the actual type.
 *
 * The caller is still expected to validate the parsed shape against
 * `RolloutConfigSchema` before using it as `RolloutConfig` — coercion is
 * about getting from "MCP arg" to "object", not "object" to "valid config".
 */

export function coerceConfigArg(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  if (typeof raw === 'string') {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`config arg was a string but not valid JSON: ${message}`);
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error(`config arg parsed to non-object: ${typeof parsed}`);
    }
    return parsed as Record<string, unknown>;
  }
  throw new Error(`config arg has unexpected type: ${raw === null ? 'null' : typeof raw}`);
}
