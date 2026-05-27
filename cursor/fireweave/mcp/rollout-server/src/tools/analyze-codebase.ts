import { z } from 'zod';
import path from 'node:path';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import ts from 'typescript';

export type WrapKind = 'function' | 'arrow-function' | 'class-method' | 'route-handler';
export type Framework = 'sveltekit' | 'bun-serve' | 'react' | 'unknown';

export interface WrapCandidate {
  file: string;
  symbol: string;
  kind: WrapKind;
  confidence: number; // 0-1
  framework: Framework;
  lineStart: number;
  lineEnd: number;
}

export interface AnalyzeCodebaseOpts {
  repoRoot: string;
  files: string[];
}

// ---------------------------------------------------------------------------
// Framework detection — pure filename heuristic
// ---------------------------------------------------------------------------
function detectFramework(filePath: string): Framework {
  const basename = path.basename(filePath);
  const ext = path.extname(filePath).toLowerCase();

  // SvelteKit route conventions
  if (
    basename === '+page.svelte' ||
    basename === '+page.ts' ||
    basename === '+page.js' ||
    basename === '+page.server.ts' ||
    basename === '+page.server.js' ||
    basename === '+server.ts' ||
    basename === '+server.js' ||
    basename === '+layout.svelte' ||
    basename === '+layout.ts' ||
    basename === '+layout.js' ||
    basename === '+layout.server.ts' ||
    basename === '+layout.server.js' ||
    ext === '.svelte'
  ) {
    return 'sveltekit';
  }

  // React: .tsx or .jsx (before .ts to avoid false match on `.ts`)
  if (ext === '.tsx' || ext === '.jsx') {
    return 'react';
  }

  // Bun serve: look for files with "serve" or "server" in name that aren't route files
  if (/\bserver\b/.test(basename) && !basename.startsWith('+')) {
    return 'bun-serve';
  }

  return 'unknown';
}

// ---------------------------------------------------------------------------
// ts.ScriptKind from file extension
// ---------------------------------------------------------------------------
function scriptKindFor(filePath: string): ts.ScriptKind {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.tsx':
      return ts.ScriptKind.TSX;
    case '.jsx':
      return ts.ScriptKind.JSX;
    case '.js':
    case '.mjs':
      return ts.ScriptKind.JS;
    case '.svelte':
      // Svelte files contain script blocks — treat as TS for AST purposes
      return ts.ScriptKind.TS;
    default:
      return ts.ScriptKind.TS;
  }
}

// ---------------------------------------------------------------------------
// Get line number from a TS node position
// ---------------------------------------------------------------------------
function getLineNumber(sf: ts.SourceFile, pos: number): number {
  return sf.getLineAndCharacterOfPosition(pos).line + 1; // 1-indexed
}

// ---------------------------------------------------------------------------
// Walk a parsed TS source file and collect WrapCandidates
// ---------------------------------------------------------------------------
function collectCandidates(
  relativePath: string,
  source: string,
  framework: Framework,
): WrapCandidate[] {
  const candidates: WrapCandidate[] = [];
  const scriptKind = scriptKindFor(relativePath);

  const sf = ts.createSourceFile(
    relativePath,
    source,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    scriptKind,
  );

  function isExported(node: ts.Node): boolean {
    return (
      ts.getCombinedModifierFlags(node as ts.Declaration) &
      ts.ModifierFlags.Export
    ) !== 0;
  }

  function getNodeName(node: ts.Node): string | null {
    if (ts.isFunctionDeclaration(node) && node.name) {
      return node.name.text;
    }
    if (ts.isMethodDeclaration(node) && node.name) {
      return node.name.getText(sf);
    }
    return null;
  }

  function visit(node: ts.Node): void {
    // 1. Exported function declarations: export function foo() {}
    if (ts.isFunctionDeclaration(node)) {
      const name = getNodeName(node);
      if (name && isExported(node)) {
        candidates.push({
          file: relativePath,
          symbol: name,
          kind: 'function',
          confidence: 1.0,
          framework,
          lineStart: getLineNumber(sf, node.getStart(sf)),
          lineEnd: getLineNumber(sf, node.getEnd()),
        });
      }
    }

    // 2. Exported arrow-function variable declarations: export const foo = () => {}
    if (ts.isVariableStatement(node) && isExported(node)) {
      for (const decl of node.declarationList.declarations) {
        if (
          decl.initializer &&
          (ts.isArrowFunction(decl.initializer) ||
            ts.isFunctionExpression(decl.initializer))
        ) {
          const name = ts.isIdentifier(decl.name) ? decl.name.text : null;
          if (name) {
            // Route handlers: route file + exported handler for HTTP methods
            const httpMethodNames = /^(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)$/;
            const isRouteHandler =
              (framework === 'sveltekit' || framework === 'bun-serve') &&
              httpMethodNames.test(name);

            candidates.push({
              file: relativePath,
              symbol: name,
              kind: isRouteHandler ? 'route-handler' : 'arrow-function',
              confidence: 1.0,
              framework,
              lineStart: getLineNumber(sf, node.getStart(sf)),
              lineEnd: getLineNumber(sf, node.getEnd()),
            });
          }
        }
      }
    }

    // 3. Class methods — exported class methods (instance + static)
    if (ts.isClassDeclaration(node) && isExported(node)) {
      for (const member of node.members) {
        if (ts.isMethodDeclaration(member)) {
          const name = member.name?.getText(sf);
          if (name && name !== 'constructor') {
            candidates.push({
              file: relativePath,
              symbol: `${node.name?.text ?? 'AnonymousClass'}.${name}`,
              kind: 'class-method',
              confidence: 0.8,
              framework,
              lineStart: getLineNumber(sf, member.getStart(sf)),
              lineEnd: getLineNumber(sf, member.getEnd()),
            });
          }
        }
      }
    }

    // 4. Non-exported nested functions get lower confidence (still included for context)
    if (ts.isFunctionDeclaration(node) && !isExported(node)) {
      const name = getNodeName(node);
      // Only include if it's at module level (parent is SourceFile), not deeply nested
      if (name && node.parent && ts.isSourceFile(node.parent)) {
        candidates.push({
          file: relativePath,
          symbol: name,
          kind: 'function',
          confidence: 0.5,
          framework,
          lineStart: getLineNumber(sf, node.getStart(sf)),
          lineEnd: getLineNumber(sf, node.getEnd()),
        });
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sf);
  return candidates;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
export async function analyzeCodebase(
  opts: AnalyzeCodebaseOpts,
): Promise<{ candidates: WrapCandidate[] }> {
  const allCandidates: WrapCandidate[] = [];

  for (const relativePath of opts.files) {
    const absPath = path.isAbsolute(relativePath)
      ? relativePath
      : path.join(opts.repoRoot, relativePath);

    const source = await Bun.file(absPath)
      .text()
      .catch(() => null);

    if (!source) {
      // File not readable; skip silently
      continue;
    }

    const framework = detectFramework(relativePath);
    const candidates = collectCandidates(relativePath, source, framework);
    allCandidates.push(...candidates);
  }

  return { candidates: allCandidates };
}

const AnalyzeCodebaseInputSchema = z.object({
  repoRoot: z
    .string()
    .min(1)
    .describe('Absolute path to the repository root'),
  files: z
    .array(z.string().min(1))
    .describe(
      'List of file paths (relative to repoRoot) to analyse. ' +
        'Typically sourced from extract_diff_surface.files.',
    ),
});

export const analyzeCodebaseTool = {
  registerWith(server: McpServer) {
    server.registerTool(
      'analyze_codebase',
      {
        title: 'Analyze Codebase',
        description:
          'Walks the given files with the TypeScript Compiler API AST and identifies ' +
          'wrap candidates: exported functions, arrow-function exports, class methods, and route handlers. ' +
          'Each candidate carries a confidence score (0–1) and a framework label detected by filename heuristic.',
        inputSchema: AnalyzeCodebaseInputSchema.shape,
      },
      async (args) => {
        try {
          const { repoRoot, files } = args as { repoRoot: string; files: string[] };
          const result = await analyzeCodebase({ repoRoot, files });
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
