/**
 * Acceptance tests for the MCP responsibility-rule predicate.
 *
 * R-IDs: R-004-1, R-004-4
 */

import { test, expect, describe, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  analyzeToolSource,
  DEPRECATION_ALLOWLIST,
} from './_responsibility-rule';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'fw-responsibility-test-'));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

async function write(name: string, body: string): Promise<string> {
  const path = join(tmpDir, name);
  await writeFile(path, body, 'utf-8');
  return path;
}

describe('R-004-1 analyzeToolSource identifies boundary violations', () => {
  test('pure-local file (node:fs only) → no violations', async () => {
    const file = await write(
      'verify-cohort-keying.ts',
      `import fs from 'node:fs';\nimport path from 'node:path';\nexport function verifyCohortKeying() { return fs.readFileSync('foo'); }\n`
    );
    const out = await analyzeToolSource(file);
    expect(out.violations).toEqual([]);
  });

  test('pure-cloud file (non-localhost fetch only) → no violations', async () => {
    const file = await write(
      'list-projects.ts',
      `export async function listProjects() {\n  return fetch('https://cloud.example.com/api/cli/projects');\n}\n`
    );
    const out = await analyzeToolSource(file);
    expect(out.violations).toEqual([]);
  });

  test('mixed file (Bun.file + non-localhost fetch) → violation reported', async () => {
    const file = await write(
      'bad-tool.ts',
      `const cfg = await Bun.file('foo.json').text();\nawait fetch('https://api.example.com/x');\n`
    );
    const out = await analyzeToolSource(file);
    expect(out.violations.length).toBe(1);
    const v = out.violations[0]!;
    expect(v.matchedLocal.length).toBeGreaterThan(0);
    expect(v.matchedCloud.length).toBeGreaterThan(0);
    expect(v.reason).toContain('local');
    expect(v.reason).toContain('cloud');
  });

  test('localhost fetch does NOT count as cloud criterion', async () => {
    const file = await write(
      'analyze-codebase.ts',
      `import fs from 'node:fs';\nawait fetch('http://localhost:3000/x');\n`
    );
    const out = await analyzeToolSource(file);
    expect(out.violations).toEqual([]);
  });

  test('simple-git import alone counts as local-only', async () => {
    const file = await write(
      'detect-baseline.ts',
      `import { simpleGit } from 'simple-git';\nexport async function detectBaseline() { return simpleGit().log(); }\n`
    );
    const out = await analyzeToolSource(file);
    expect(out.violations).toEqual([]);
  });

  test('lockfile cache path triggers local criterion (c)', async () => {
    const file = await write(
      'mixed-cache-cloud.ts',
      `// .binaryos/.cache/ path access\nconst x = '.binaryos/.cache/foo';\nawait fetch('https://example.org/');\n`
    );
    const out = await analyzeToolSource(file);
    expect(out.violations.length).toBe(1);
    expect(out.violations[0]!.matchedLocal.length).toBeGreaterThan(0);
    expect(out.violations[0]!.matchedCloud.length).toBeGreaterThan(0);
  });

  test('violation entry names the tool (file basename without .ts)', async () => {
    const file = await write(
      'something-bad.ts',
      `import fs from 'node:fs';\nawait fetch('https://example.org/');\n`
    );
    const out = await analyzeToolSource(file);
    expect(out.violations[0]!.toolName).toBe('something-bad');
  });
});

describe('R-004-4 DEPRECATION_ALLOWLIST covers exactly the 4 Wave-A cloud-conceptual tools', () => {
  test('has exactly 4 entries', () => {
    expect(DEPRECATION_ALLOWLIST.length).toBe(4);
  });

  test('contains the 4 named tools', () => {
    expect([...DEPRECATION_ALLOWLIST].sort()).toEqual([
      'extract_diff_surface',
      'list_projects',
      'propose_metrics',
      'recommend_rollout_strategy',
    ]);
  });

  test('is frozen', () => {
    expect(Object.isFrozen(DEPRECATION_ALLOWLIST)).toBe(true);
  });
});
