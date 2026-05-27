/**
 * MCP Responsibility Boundary Rule predicate.
 *
 * Per pitch 026 §MCP Responsibility Boundary Rule:
 *   - A tool belongs on `rollout-server` (local stdio) iff it satisfies any
 *     of LOCAL criteria (a-d): node:fs / node:path / Bun.file / simple-git /
 *     git spawn / `.binaryos/.cache/` access / `verify_*` registered name.
 *   - A tool belongs on `fireweave-server-proxy` (cloud) iff it satisfies
 *     any of CLOUD criteria (e-g): non-localhost fetch, upstream mutation,
 *     upstream-only query.
 *   - VIOLATION = a single tool satisfies BOTH local AND cloud — needs to
 *     be split (or migrated to one side).
 *
 * Pure-cloud tools (only e-g match) are NOT violations — they're correctly
 * classified for cloud delivery. The Wave A deprecation aliases live in
 * the `DEPRECATION_ALLOWLIST` carve-out: their source still contains the
 * cloud-side patterns (forwarding to proxy) but the alias is the migration
 * path itself, not a violation.
 *
 * R-IDs: R-004-1, R-004-4
 */

export interface Violation {
  toolName: string;
  matchedLocal: string[];
  matchedCloud: string[];
  reason: string;
}

export interface AnalyzeResult {
  violations: Violation[];
}

/**
 * Wave A deprecation aliases — the four cloud-conceptual tools that have
 * been migrated from rollout-server to fireweave-server-proxy. The alias
 * shells still register on rollout-server (so existing skill prose with
 * `mcp__rollout-server__list_projects` continues to function) but forwards
 * to the proxy with a `process.stderr` deprecation warning.
 *
 * Frozen at module init so consumers cannot mutate the set at runtime.
 */
export const DEPRECATION_ALLOWLIST: readonly string[] = Object.freeze([
  'list_projects',
  'recommend_rollout_strategy',
  'propose_metrics',
  'extract_diff_surface',
]);

const LOCAL_PATTERNS: Array<{ label: string; re: RegExp }> = [
  { label: 'import node:fs', re: /import[\s\S]*?['"]node:fs['"]/ },
  { label: 'import node:path', re: /import[\s\S]*?['"]node:path['"]/ },
  { label: 'Bun.file', re: /\bBun\.file\b/ },
  { label: 'import simple-git', re: /import[\s\S]*?['"]simple-git['"]/ },
  { label: 'spawn git', re: /spawn\([^)]*['"]git['"]/ },
  { label: '.binaryos/.cache path', re: /\.binaryos\/\.cache\// },
];

const CLOUD_PATTERNS: Array<{ label: string; re: RegExp }> = [
  {
    label: 'non-localhost fetch',
    re: /fetch\(\s*['"]https?:\/\/(?!localhost|127\.0\.0\.1)[^'"]+['"]/,
  },
];

function basenameNoExt(filePath: string): string {
  const lastSlash = Math.max(
    filePath.lastIndexOf('/'),
    filePath.lastIndexOf('\\')
  );
  const base = lastSlash >= 0 ? filePath.slice(lastSlash + 1) : filePath;
  return base.endsWith('.ts') ? base.slice(0, -3) : base;
}

function applyPatterns(
  source: string,
  patterns: Array<{ label: string; re: RegExp }>
): string[] {
  return patterns.filter((p) => p.re.test(source)).map((p) => p.label);
}

export async function analyzeToolSource(
  filePath: string
): Promise<AnalyzeResult> {
  const source = await Bun.file(filePath).text();
  const toolName = basenameNoExt(filePath);

  const matchedLocal = applyPatterns(source, LOCAL_PATTERNS);
  const matchedCloud = applyPatterns(source, CLOUD_PATTERNS);

  if (matchedLocal.length > 0 && matchedCloud.length > 0) {
    return {
      violations: [
        {
          toolName,
          matchedLocal,
          matchedCloud,
          reason:
            `Tool ${toolName} satisfies BOTH local criteria ` +
            `(${matchedLocal.join(', ')}) AND cloud criteria ` +
            `(${matchedCloud.join(', ')}). Per pitch 026 §MCP ` +
            `Responsibility Boundary Rule, this tool must be split into ` +
            `two — one per side — with the skill orchestrating.`,
        },
      ],
    };
  }
  return { violations: [] };
}
