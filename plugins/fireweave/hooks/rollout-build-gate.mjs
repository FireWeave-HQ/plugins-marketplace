#!/usr/bin/env node
/**
 * Rollout-ready build gate — manifest ⇄ anchor under scan scope from
 * `.fireweave/project.json` only. Shipped in the installed plugin at
 * `hooks/rollout-build-gate.mjs`; `/fireweave:initialise` copies it to
 * `.fireweave/hooks/rollout-build-gate.mjs` in the customer repo.
 */
import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '../..');
const projPath = join(root, '.fireweave', 'project.json');
const manifestDir = join(root, '.fireweave', 'rollout-ready');

const GENERIC_SCAN_EXCLUDE = [
  'node_modules',
  'dist',
  'build',
  'coverage',
  'vendor',
  '**/*.test.ts',
  '**/*.spec.ts',
  '**/__tests__/**',
];
const SOURCE_EXTS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts',
  '.go', '.rs', '.dart', '.py', '.rb', '.java', '.kt', '.kts', '.swift', '.php', '.cs',
]);
const ANCHOR_RE = /@fireweave-flag\s+([A-Za-z0-9][A-Za-z0-9._-]*)/g;

function matchesGlob(path, pattern) {
  if (pattern.endsWith('/**')) {
    const prefix = pattern.slice(0, -3);
    return path === prefix || path.startsWith(`${prefix}/`);
  }
  const re = new RegExp(
    `^${pattern
      .split('/')
      .map((part) => {
        if (part === '**') return '.*';
        return part.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*');
      })
      .join('/')}$`
  );
  return re.test(path);
}

function isScanExcluded(relPath, excludeSegments, excludeGlobs) {
  if (excludeSegments.some((seg) => relPath.split('/').includes(seg))) return true;
  return excludeGlobs.some((g) => matchesGlob(relPath, g));
}

function isUnderSourceRoot(relPath, sourceRoots) {
  if (sourceRoots.length === 0) return true;
  return sourceRoots.some((r) => relPath === r || relPath.startsWith(`${r}/`));
}

function splitExcludes(patterns) {
  const segments = [];
  const globs = [];
  const segmentOnly = new Set(['node_modules', 'dist', 'build', 'coverage', 'vendor']);
  for (const p of patterns) {
    if (segmentOnly.has(p) || (!p.includes('*') && !p.includes('?'))) segments.push(p);
    else globs.push(p);
  }
  return { segments, globs };
}

async function loadScanConfig() {
  let rolloutReady = null;
  if (existsSync(projPath)) {
    try {
      const raw = JSON.parse(await readFile(projPath, 'utf8'));
      rolloutReady = raw.rolloutReady ?? null;
    } catch {
      /* fall through */
    }
  }
  const sourceRoots = Array.isArray(rolloutReady?.sourceRoots)
    ? rolloutReady.sourceRoots
    : [];
  const scanExclude = Array.isArray(rolloutReady?.scanExclude)
    ? rolloutReady.scanExclude
    : GENERIC_SCAN_EXCLUDE;
  const { segments, globs } = splitExcludes(scanExclude);
  return { sourceRoots, excludeSegments: segments, excludeGlobs: globs };
}

function parseAnchors(text) {
  const keys = [];
  let m;
  ANCHOR_RE.lastIndex = 0;
  while ((m = ANCHOR_RE.exec(text)) !== null) keys.push(m[1]);
  return keys;
}

async function collectManifestFlags() {
  const flags = new Set();
  const findings = [];
  let files = [];
  try {
    files = (await readdir(manifestDir)).filter((f) => f.endsWith('.json'));
  } catch {
    return { flags, findings };
  }
  for (const file of files.sort()) {
    try {
      const raw = JSON.parse(await readFile(join(manifestDir, file), 'utf8'));
      for (const f of raw.flags ?? []) {
        if (f?.key) flags.add(f.key);
      }
    } catch {
      findings.push({
        severity: 'block',
        message: `manifest ${file} is invalid JSON`,
      });
    }
  }
  return { flags, findings };
}

async function walkSourceFiles(dir, relBase, out) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const relPath = relBase ? `${relBase}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      await walkSourceFiles(join(dir, entry.name), relPath, out);
    } else if (entry.isFile() && SOURCE_EXTS.has(extname(entry.name))) {
      out.push(relPath);
    }
  }
}

async function collectAnchorFlags(scan) {
  const files = [];
  await walkSourceFiles(root, '', files);
  const byKey = new Map();
  for (const relPath of files) {
    if (!isUnderSourceRoot(relPath, scan.sourceRoots)) continue;
    if (isScanExcluded(relPath, scan.excludeSegments, scan.excludeGlobs)) continue;
    let text;
    try {
      text = await readFile(join(root, relPath), 'utf8');
    } catch {
      continue;
    }
    for (const key of parseAnchors(text)) {
      if (!byKey.has(key)) byKey.set(key, relPath);
    }
  }
  return byKey;
}

async function main() {
  const findings = [];
  const scan = await loadScanConfig();
  const { flags: manifestFlags, findings: manifestFindings } = await collectManifestFlags();
  findings.push(...manifestFindings);

  const anchorMap = await collectAnchorFlags(scan);
  const anchorFlags = new Set(anchorMap.keys());

  for (const coded of anchorFlags) {
    if (!manifestFlags.has(coded)) {
      findings.push({
        severity: 'block',
        message: `coded flag '${coded}' has no manifest entry (orphan flag) — ${anchorMap.get(coded)}`,
      });
    }
  }
  for (const declared of manifestFlags) {
    if (!anchorFlags.has(declared)) {
      findings.push({
        severity: 'block',
        message: `manifest flag '${declared}' has no code anchor`,
      });
    }
  }

  const pass = !findings.some((f) => f.severity === 'block');
  process.stdout.write(JSON.stringify({ pass, findings }) + '\n');
  process.exit(pass ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
