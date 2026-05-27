/**
 * Generate a wrapper for ONE wrap point against ONE flag.
 *
 * Multi-flag rollouts (Task 20b): the caller iterates
 * `config.repos[].wrapPoints[]`, and for each wrap-point invokes this tool
 * with `flagKey = wp.flagKey` (looked up against `config.flags[]`). Every
 * wrap-point must bind explicitly to one flag in `config.flags[]` — don't
 * pass a "default" flag.
 */
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { WrapPoint, WrapStyle } from '@fireweaveai/fw-rollout-types';

export type { WrapPoint, WrapStyle };

export interface GenerateWrapperOpts {
  wrapPoint: WrapPoint;
  flagKey: string;
  providerId: string;
  distinctIdExpression: string; // e.g. "userId" or "request.user.id"
  safeDefaultLiteral: string; // e.g. "false" or "'control'"
  framework: 'sveltekit' | 'bun-serve' | 'react' | 'unknown';
}

export interface GeneratedWrapper {
  file: string;
  symbol: string;
  originalLines: { start: number; end: number };
  patch: string; // pseudo-diff description of changes to apply
  imports: string[]; // import statements to add at the top of the file
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Template helpers
// ---------------------------------------------------------------------------

const EVALUATE_IMPORT =
  "import { evaluate, startSpan, endSpan } from '@fireweaveai/fw-feature-flags';";

function buildFunctionGuardPatch(opts: GenerateWrapperOpts): string {
  const { flagKey, distinctIdExpression, safeDefaultLiteral } = opts;
  return [
    `// [fw-rollout] function-guard wrap for flag '${flagKey}'`,
    `// Insert at the start of the function body:`,
    `const __fwEnabled = await evaluate('${flagKey}', ${distinctIdExpression}, ${safeDefaultLiteral});`,
    `if (!__fwEnabled) {`,
    `  // Safe default: return early with ${safeDefaultLiteral}`,
    `  return ${safeDefaultLiteral};`,
    `}`,
    `const __fwSpan = startSpan('${flagKey}.feature');`,
    `try {`,
    `  // ... original function body ...`,
    `} finally {`,
    `  endSpan(__fwSpan);`,
    `}`,
  ].join('\n');
}

function buildRouteGuardPatch(opts: GenerateWrapperOpts): string {
  const { flagKey, distinctIdExpression, safeDefaultLiteral } = opts;
  return [
    `// [fw-rollout] route-guard wrap for flag '${flagKey}'`,
    `// Insert at the start of the route handler body:`,
    `const __fwEnabled = await evaluate('${flagKey}', ${distinctIdExpression}, ${safeDefaultLiteral});`,
    `if (!__fwEnabled) {`,
    `  return new Response(JSON.stringify({ enabled: false }), {`,
    `    status: 200,`,
    `    headers: { 'Content-Type': 'application/json' },`,
    `  });`,
    `}`,
    `const __fwSpan = startSpan('${flagKey}.route');`,
    `try {`,
    `  // ... original route handler body ...`,
    `} finally {`,
    `  endSpan(__fwSpan);`,
    `}`,
  ].join('\n');
}

function buildComponentGuardPatch(opts: GenerateWrapperOpts): string {
  const { flagKey, distinctIdExpression, safeDefaultLiteral } = opts;
  const isReact = opts.framework === 'react';
  if (isReact) {
    return [
      `// [fw-rollout] component-guard wrap for flag '${flagKey}'`,
      `// Wrap the component's JSX return with a flag check:`,
      `const __fwEnabled = useFeatureFlag('${flagKey}', ${distinctIdExpression}, ${safeDefaultLiteral});`,
      `if (!__fwEnabled) {`,
      `  return null; // safe default: render nothing when flag is off`,
      `}`,
      `// ... original JSX return ...`,
    ].join('\n');
  }
  // SvelteKit / Svelte component guard
  return [
    `<!-- [fw-rollout] component-guard wrap for flag '${flagKey}' -->`,
    `<!-- Add to the script block: -->`,
    `const __fwEnabled = await evaluate('${flagKey}', ${distinctIdExpression}, ${safeDefaultLiteral});`,
    ``,
    `<!-- Wrap the template: -->`,
    `{#if __fwEnabled}`,
    `  <!-- ... original component markup ... -->`,
    `{:else}`,
    `  <!-- safe default: render nothing (${safeDefaultLiteral}) -->`,
    `{/if}`,
  ].join('\n');
}

function buildShadowCallPatch(opts: GenerateWrapperOpts): string {
  const { flagKey, distinctIdExpression, safeDefaultLiteral } = opts;
  return [
    `// [fw-rollout] shadow-call (dark launch) wrap for flag '${flagKey}'`,
    `// Run both old and new paths; use old result but log new:`,
    `const __fwEnabled = await evaluate('${flagKey}', ${distinctIdExpression}, ${safeDefaultLiteral});`,
    `const __fwSpan = startSpan('${flagKey}.shadow');`,
    `try {`,
    `  const __oldResult = /* ... original call ... */ null;`,
    `  if (__fwEnabled) {`,
    `    // Dark-launch: run new path and compare`,
    `    const __newResult = /* ... new implementation ... */ null;`,
    `    // Log comparison (don't return new result yet)`,
    `    console.debug('[fw-shadow]', { flagKey: '${flagKey}', oldResult: __oldResult, newResult: __newResult });`,
    `  }`,
    `  return __oldResult;`,
    `} finally {`,
    `  endSpan(__fwSpan);`,
    `}`,
  ].join('\n');
}

function buildMethodGuardPatch(opts: GenerateWrapperOpts): string {
  // method-guard is functionally the same as function-guard
  return buildFunctionGuardPatch(opts);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
export async function generateWrapper(opts: GenerateWrapperOpts): Promise<GeneratedWrapper> {
  const { wrapPoint, flagKey, framework } = opts;

  const warnings: string[] = [];

  // Validate flag key format (only warn, don't throw)
  if (!/^[a-z0-9_-]+$/i.test(flagKey)) {
    warnings.push(
      `Flag key '${flagKey}' contains unusual characters. Recommended format: lowercase-kebab-case.`,
    );
  }

  let patch: string;
  const wrapStyle: WrapStyle = wrapPoint.wrapStyle;

  switch (wrapStyle) {
    case 'function-guard':
      patch = buildFunctionGuardPatch(opts);
      break;
    case 'route-guard':
      patch = buildRouteGuardPatch(opts);
      break;
    case 'component-guard':
      patch = buildComponentGuardPatch(opts);
      break;
    case 'shadow-call':
      patch = buildShadowCallPatch(opts);
      break;
    case 'method-guard':
      patch = buildMethodGuardPatch(opts);
      break;
    default: {
      const exhaustive: never = wrapStyle;
      warnings.push(`Unknown wrapStyle '${String(exhaustive)}'; defaulting to function-guard.`);
      patch = buildFunctionGuardPatch(opts);
    }
  }

  const imports: string[] = [EVALUATE_IMPORT];
  if (framework === 'react' && wrapStyle === 'component-guard') {
    imports.push(
      "import { useFeatureFlag } from '@fireweaveai/fw-feature-flags/react';",
    );
  }

  // Dedup imports
  const uniqueImports = [...new Set(imports)];

  if (!wrapPoint.lineRange) {
    warnings.push(
      `No lineRange provided for wrap-point '${wrapPoint.symbol}' in '${wrapPoint.file}'. ` +
        'The patch description is advisory — locate the symbol manually to apply it.',
    );
  }

  return {
    file: wrapPoint.file,
    symbol: wrapPoint.symbol,
    originalLines: {
      start: wrapPoint.lineRange?.[0] ?? 0,
      end: wrapPoint.lineRange?.[1] ?? 0,
    },
    patch,
    imports: uniqueImports,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// MCP tool registration
// ---------------------------------------------------------------------------
const WrapPointInputSchema = z.object({
  file: z.string().min(1),
  symbol: z.string().min(1),
  wrapStyle: z.enum([
    'function-guard',
    'route-guard',
    'component-guard',
    'method-guard',
    'shadow-call',
  ]),
  lineRange: z.tuple([z.number().int(), z.number().int()]).optional(),
});

const GenerateWrapperInputSchema = z.object({
  wrapPoint: WrapPointInputSchema.describe(
    'The wrap-point to codegen for (from analyze_codebase output or user selection)',
  ),
  flagKey: z
    .string()
    .min(1)
    .describe('Feature flag key to use (e.g. "checkout-v2-enabled")'),
  providerId: z
    .string()
    .min(1)
    .describe('Integration provider ID supplying the flag (e.g. "posthog")'),
  distinctIdExpression: z
    .string()
    .min(1)
    .describe(
      'TypeScript expression that resolves to a user/entity identifier at runtime ' +
        '(e.g. "userId", "session.user.id", "request.headers.get(\\"x-user-id\\")")',
    ),
  safeDefaultLiteral: z
    .string()
    .min(1)
    .describe(
      'TypeScript literal to use as the safe default when the flag is off ' +
        '(e.g. "false", "\'control\'", "null")',
    ),
  framework: z
    .enum(['sveltekit', 'bun-serve', 'react', 'unknown'])
    .default('unknown')
    .describe('Framework hint for the generated patch template'),
});

export const generateWrapperTool = {
  registerWith(server: McpServer) {
    server.registerTool(
      'generate_wrapper',
      {
        title: 'Generate Wrapper',
        description:
          'Generates a template-based codegen patch that wraps the given function/route/component ' +
          'with a feature-flag guard, a tracing span, and metric instrumentation. ' +
          'Returns the patch text and import statements to add.',
        inputSchema: GenerateWrapperInputSchema.shape,
      },
      async (args) => {
        try {
          const typedArgs = args as {
            wrapPoint: WrapPoint;
            flagKey: string;
            providerId: string;
            distinctIdExpression: string;
            safeDefaultLiteral: string;
            framework: 'sveltekit' | 'bun-serve' | 'react' | 'unknown';
          };
          const result = await generateWrapper(typedArgs);
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(result) }],
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({ error: message }) }],
          };
        }
      },
    );
  },
};
