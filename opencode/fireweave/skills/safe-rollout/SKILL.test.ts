/**
 * SKILL.md parsability + manifest-coverage tests (R-005-10).
 *
 * Reads SKILL.md from disk, extracts the embedded
 * SKILL_EXPECTED_TOOL_MANIFEST JSON block, parses it, and asserts that
 * every `mcp__<server>__<tool>` reference in the skill prose appears in
 * the manifest. Catches manifest/prose drift mechanically.
 */

import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';

const SKILL_PATH = resolve(import.meta.dir, 'SKILL.md');

interface ManifestEntry {
  name: string;
  server: string;
  aliasOf?: string;
}

async function loadSkillText(): Promise<string> {
  return await Bun.file(SKILL_PATH).text();
}

function extractManifest(text: string): ManifestEntry[] {
  // Match the inline JSON code-block that declares the manifest.
  // The block is keyed by the literal "SKILL_EXPECTED_TOOL_MANIFEST".
  const match = text.match(
    /"SKILL_EXPECTED_TOOL_MANIFEST"\s*:\s*(\[[\s\S]*?\n\s*\])/
  );
  if (!match || !match[1]) {
    throw new Error(
      'SKILL_EXPECTED_TOOL_MANIFEST JSON block not found in SKILL.md'
    );
  }
  const parsed = JSON.parse(match[1]);
  if (!Array.isArray(parsed)) {
    throw new Error('SKILL_EXPECTED_TOOL_MANIFEST is not a JSON array');
  }
  return parsed as ManifestEntry[];
}

function extractToolReferences(
  text: string
): { server: string; name: string }[] {
  const refs: { server: string; name: string }[] = [];
  const pattern = /mcp__([a-z-]+)__([a-z][a-z0-9_]+)([*]?)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const server = match[1];
    const name = match[2];
    const wildcard = match[3];
    // Skip wildcard prose references like `mcp__rollout-server__verify_*`.
    if (wildcard === '*') continue;
    if (server && name) {
      refs.push({ server, name });
    }
  }
  return refs;
}

describe('R-005-10 SKILL.md parsability + manifest coverage', () => {
  test('SKILL.md exists and is non-empty', async () => {
    const text = await loadSkillText();
    expect(text.length).toBeGreaterThan(0);
  });

  test('manifest JSON block parses cleanly', async () => {
    const text = await loadSkillText();
    const manifest = extractManifest(text);
    expect(Array.isArray(manifest)).toBe(true);
    expect(manifest.length).toBeGreaterThanOrEqual(20);
  });

  test('every manifest entry has { name, server } shape', async () => {
    const text = await loadSkillText();
    const manifest = extractManifest(text);
    for (const entry of manifest) {
      expect(typeof entry.name).toBe('string');
      expect(entry.name.length).toBeGreaterThan(0);
      expect(typeof entry.server).toBe('string');
      expect(entry.server.length).toBeGreaterThan(0);
    }
  });

  test('every mcp__<server>__<tool> reference in prose appears in the manifest', async () => {
    const text = await loadSkillText();
    const manifest = extractManifest(text);
    const manifestNames = new Set(manifest.map((e) => e.name));

    // Servers that aren't tool-bearing in the manifest (they're documented
    // as the upstream targets the proxy forwards to).
    const docOnlyServers = new Set(['fireweave-cloud', 'fireweave-local']);

    const refs = extractToolReferences(text);
    const callSiteRefs = refs.filter((r) => !docOnlyServers.has(r.server));

    // At least some tool call sites must exist.
    expect(callSiteRefs.length).toBeGreaterThan(0);

    for (const ref of callSiteRefs) {
      expect(manifestNames.has(ref.name)).toBe(true);
    }
  });

  test('manifest covers each canonical gate ID block in the skill', async () => {
    const text = await loadSkillText();
    // The 11 canonical gate IDs that R-005-1 asserts (one block per id).
    const requiredGates = [
      'GATE-1-FEATURE-SURFACE',
      'GATE-2-TYPE',
      'GATE-2-NAME',
      'GATE-2-DESCRIPTION',
      'GATE-3-ROLLOUT-STYLE',
      'GATE-4-PROVIDER-BINDING',
      'GATE-5-WRAP-SELECT',
      'GATE-6-ACCEPT-METRIC',
      'GATE-8-VERIFY-OVERRIDE',
      'GATE-8.5-REGISTER-OR-EDIT',
      'GATE-9-SHA-READY',
    ];
    for (const gate of requiredGates) {
      expect(text.includes(gate)).toBe(true);
    }
  });

  test('Step 0.1b manifest check section is present', async () => {
    const text = await loadSkillText();
    expect(text.includes('## Step 0.1b — MCP manifest check')).toBe(true);
  });

  test('universal-rules hard-abort entry is present (CONFIG_TOOL_FAILURE)', async () => {
    const text = await loadSkillText();
    expect(text.includes('CONFIG_TOOL_FAILURE')).toBe(true);
    expect(text.includes('CONFIRMATION_MISSING')).toBe(true);
    expect(text.includes('MANIFEST_MISMATCH')).toBe(true);
  });

  test('guarded_call routing path is present in skill prose', async () => {
    const text = await loadSkillText();
    expect(text.includes('mcp__rollout-server__guarded_call')).toBe(true);
  });

  test('no stale mcp__fireweave-server__<tool> placeholder remains', async () => {
    const text = await loadSkillText();
    const stale = text.match(/mcp__fireweave-server__[a-z_]+/g);
    expect(stale).toBeNull();
  });
});
