#!/usr/bin/env node
/**
 * Rollout-ready build gate — manifest ⇄ anchor under the scan scope this repo
 * declares. Shipped in the installed plugin at `hooks/rollout-build-gate.mjs`;
 * `/fireweave:initialise` copies it to `.fireweave/hooks/rollout-build-gate.mjs`
 * in the customer repo.
 *
 * ## The one behaviour to read before changing anything (ADR-019, D-C)
 *
 * This gate used to answer "no manifests found" with `pass: true`. That was
 * correct for exactly as long as manifests lived in git: an empty
 * `.fireweave/rollout-ready/` really did mean nobody had authored one. Manifests
 * live on fw-server now, so an empty answer stopped being evidence of anything —
 * and a fresh clone has no manifest files at all, by construction. Left as it
 * was, every repo would look exactly like a clean one, be permanently un-gated,
 * and nothing would say so.
 *
 * So absence is never green:
 *
 * | State                                   | Source | Verdict |
 * |---|---|---|
 * | No `.fireweave/project.json` at all     | — | **pass** — not a FireWeave repo; failing here would break every unrelated build. |
 * | `project.json` unreadable / not JSON    | — | **block** — an initialised repo whose pointer cannot be read is not a repo this gate can clear. |
 * | **No usable** `.cache/`                 | none | **block, `fw sync`.** An empty answer here means *this gate cannot see the contract*, not *there is no contract*. |
 * | **Stale** cache (branch ≠ HEAD)         | `.cache/rollout-ready/` | **scan, with a warning** naming both branches and `fetchedAt`. A stale answer beats no answer — never a silent one. |
 * | **Fresh** cache                         | `.cache/rollout-ready/` | **scan normally**, fully offline. |
 * | Cache + non-empty `.queue/`             | cache **∪** queue | **scan the union**, with every queued contribution TAGGED. The queue is the author's newest intent; excluding it would fail an author's own gate on their own offline work. |
 *
 * ## There is one manifest source (ADR-019 Phase 6)
 *
 * There used to be two, chosen by a `serverOwnedEvidence` discriminant: a repo
 * that had not migrated read `.fireweave/rollout-ready/` directly, and only a
 * server-owned one required the projection. Phase 6 removed the tracked leg
 * everywhere, so the discriminant had nothing left to discriminate — every repo
 * takes the projection path, and a repo without one is blocked rather than
 * silently scanned against a store that is no longer read.
 *
 * That is a REAL cost and it is deliberate: a repo that has never run `fw sync`
 * cannot build until it does. The block names `fw sync` as its fix, which is
 * reachable for every repo the gate now applies to — unlike the old
 * `cache-required` block, which used to fire on bound-only repos where `fw sync`
 * could not project what had never been put on a server.
 *
 * **Field presence, never the version number** (catalog PROJ-3) remains the rule
 * wherever shape is still read. `ProjectBindingSchema` accepts `version: 1 | 2`
 * only; server-owned never means `version: 3`.
 *
 * A cache whose checksums do not match, or whose `schemaVersion` this build does
 * not speak, is **absent, not data**: it falls through to the block row. Never
 * treat a corrupt projection as an empty one.
 *
 * ## Offline and dependency-free, by construction
 *
 * This file is committed into customer repos and run by a stop hook on every
 * agent turn. It imports node builtins only — no package import, no network
 * call, no `git` subprocess. The cache and queue layouts it reads are contracts
 * (`@fireweaveai/contracts/rollout/repo-state-cache.zod.ts` and
 * `manifest-queue.ts`); the minimum needed to decide "may I trust this?" is
 * re-implemented here rather than imported, and the constants below are marked
 * as the mirrors they are. `node:crypto` is the one addition to the import set:
 * a checksum is what separates a projection from a hand-edited file, and there
 * is no way to compute one without a hash primitive.
 */
import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname, extname, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '../..');
const projPath = join(root, '.fireweave', 'project.json');
// There is deliberately no `.fireweave/rollout-ready/` path here. Phase 6 gave
// this gate ONE manifest source — the projection (cache ∪ queue) — for every
// repo, whatever shape its pointer is. The dead const that used to sit here was
// the last thing suggesting otherwise, and the skill's own spec table had copied
// that suggestion into an instruction.
const cacheDir = join(root, '.fireweave', '.cache');
const queueDir = join(root, '.fireweave', '.queue');

// ── Mirrors of the contracts, not second sources of truth ────────────────────
/**
 * `REPO_STATE_CACHE_SCHEMA_VERSION`. A different version reads as ABSENT.
 *
 * MIRRORED, not imported — this file ships standalone into customer repos and
 * cannot resolve `@fireweaveai/contracts`. `rollout-build-gate.test.ts` pins the
 * two together, which is the only thing stopping this from silently rejecting
 * every projection the current CLI writes.
 */
const CACHE_SCHEMA_VERSION = 2;
/** `MANIFEST_QUEUE_SCHEMA_VERSION`. A different version is UNREPLAYABLE, never skipped. */
const QUEUE_SCHEMA_VERSION = 1;
/**
 * `REPO_STATE_SERVER_OWNED`. The ONE `project.json.repoState` value that asserts
 * server-owned rollout state; any other value is an unrecognised claim, which is
 * not a claim. The repo-state migration writes it, this gate reads it.
 */
const REPO_STATE_SERVER_OWNED = 'server';
const CACHE_META_FILENAME = 'meta.json';
const CACHE_REPO_STATE_FILENAME = 'repo-state.json';
const CACHE_README_FILENAME = 'README.md';
const CACHE_ROLLOUT_READY_DIRNAME = 'rollout-ready';
const CACHE_CHANGELOG_DIRNAME = 'changelog';
/** `<ULID>.json` and nothing else — a README or an editor swapfile is not an entry. */
const QUEUE_ENTRY_FILENAME_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}\.json$/;
/**
 * Cached rows whose flags no longer demand an anchor. `archived` replaces the
 * old `rollout-ready/_archive/` directory (which the tracked scan never read,
 * because a directory name does not end in `.json`); `retiring` is a
 * branch-scoped tombstone whose dead code cleanup already removed.
 */
const RETIRED_MANIFEST_STATUS = new Set(['archived', 'retiring']);
const SYNC_FIX =
  'run `fw sync` — a projection is how this gate sees server-owned manifests offline';

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
/**
 * Scan vocabulary, keyed on SURFACE TYPE — mirror of
 * `@fireweaveai/contracts/rollout/surface-scan-vocabulary.ts` (FIR-322), pinned
 * by a regex over that source in `rollout-build-gate.test.ts`.
 *
 * This used to be a flat `SOURCE_EXTS` set with no `.svelte`, so the two
 * SvelteKit surfaces in FireWeave's own repo were never walked — and a missing
 * extension yields NO finding, which reads identically to a clean repo. The
 * flat list was the bug: every surface language re-opened the same silent hole.
 * `reconcile(build)` reported an orphan flag on a `.svelte` file while this gate
 * answered `{"pass":true,"findings":[]}` on the same tree.
 *
 * `anchorSyntaxes` declares what a valid anchor LOOKS like per language; it
 * deliberately does NOT narrow `ANCHOR_RE`, which stays comment-leader agnostic
 * (a matcher restricted to `//` would report success on a `.py` file it could
 * not read — worse than not scanning it, because the surface looks covered).
 */
const SURFACE_SCAN_VOCABULARY = {
  'ts-server': {
    extensions: ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'],
    anchorSyntaxes: ['slash'],
  },
  web: {
    extensions: [
      '.ts',
      '.tsx',
      '.js',
      '.jsx',
      '.mjs',
      '.cjs',
      '.svelte',
      '.vue',
      '.html',
    ],
    anchorSyntaxes: ['slash', 'html'],
  },
  go: { extensions: ['.go'], anchorSyntaxes: ['slash'] },
  rust: { extensions: ['.rs'], anchorSyntaxes: ['slash'] },
  python: { extensions: ['.py', '.pyi'], anchorSyntaxes: ['hash'] },
  dart: { extensions: ['.dart'], anchorSyntaxes: ['slash'] },
  java: { extensions: ['.java'], anchorSyntaxes: ['slash'] },
};
const SCAN_SURFACES = Object.keys(SURFACE_SCAN_VOCABULARY);
/** Extensions with no surface type yet — they ride along with every scan. */
const UNGOVERNED_SCAN_EXTENSIONS = [
  '.rb',
  '.kt',
  '.kts',
  '.swift',
  '.php',
  '.cs',
];
/**
 * What the ORPHAN scan opens — every extension any surface can contribute, plus
 * the ungoverned bridge. Constant, and mirrored from `ALL_SCAN_EXTENSIONS`.
 */
const ALL_SCAN_EXTENSIONS = new Set([
  ...SCAN_SURFACES.flatMap((s) => SURFACE_SCAN_VOCABULARY[s].extensions),
  ...UNGOVERNED_SCAN_EXTENSIONS,
]);
const ANCHOR_RE = /@fireweave-flag\s+([A-Za-z0-9][A-Za-z0-9._-]*)/g;

/**
 * The union of the surfaces a repo actually declares — with the SAME three
 * cases as the contract: declared-and-known ⇒ exactly those; declared nothing
 * ⇒ every surface; declared something unknown ⇒ every surface AND the unknown
 * named, so the caller can block on it.
 *
 * Those three cases shape `extensions` / `surfaces` — which are DESCRIPTIVE.
 * `anchorScanExtensions` is CONSTANT and is what `collectAnchorFlags` walks:
 * the declared set is read out of the manifests this repo has already authored,
 * and the orphan check exists to find an anchor with no manifest, so scoping it
 * by that set makes the first anchor on a not-yet-manifested surface invisible
 * by construction. Widening can only ADD findings; narrowing on missing
 * information is the failure this whole file exists to remove — and a repo that
 * has declared SOME surfaces is still missing information about the rest.
 */
function resolveScanVocabulary(declaredSurfaces) {
  const known = [];
  const unknown = [];
  for (const s of declaredSurfaces) {
    if (Object.prototype.hasOwnProperty.call(SURFACE_SCAN_VOCABULARY, s)) {
      if (!known.includes(s)) known.push(s);
    } else if (!unknown.includes(s)) {
      unknown.push(s);
    }
  }
  const widened = unknown.length > 0 || known.length === 0;
  const surfaces = widened ? [...SCAN_SURFACES] : known;
  const extensions = new Set(UNGOVERNED_SCAN_EXTENSIONS);
  for (const s of surfaces) {
    for (const ext of SURFACE_SCAN_VOCABULARY[s].extensions)
      extensions.add(ext);
  }
  return {
    extensions,
    // Not `surfaces`. Not `declaredSurfaces`. Constant, on purpose.
    anchorScanExtensions: ALL_SCAN_EXTENSIONS,
    surfaces: [...surfaces].sort(),
    unknownSurfaces: unknown.sort(),
    widened,
  };
}

/**
 * Every `harness.surface` a manifest names — schema 1 carries one at the top
 * level, schema 2 one per `surfaces[]` entry. Both are read: a v2 manifest read
 * as v1 would declare no surface at all and quietly widen the scan.
 */
function collectManifestSurfaces(manifest, into) {
  const add = (v) => {
    if (typeof v === 'string' && v.length > 0) into.add(v);
  };
  add(manifest?.harness?.surface);
  for (const entry of Array.isArray(manifest?.surfaces)
    ? manifest.surfaces
    : []) {
    add(entry?.harness?.surface);
  }
}

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
        return part
          .replace(/[.+^${}()|[\]\\]/g, '\\$&')
          .replace(/\*/g, '[^/]*');
      })
      .join('/')}$`
  );
  return re.test(path);
}

function isScanExcluded(relPath, excludeSegments, excludeGlobs) {
  if (excludeSegments.some((seg) => relPath.split('/').includes(seg)))
    return true;
  return excludeGlobs.some((g) => matchesGlob(relPath, g));
}

function isUnderSourceRoot(relPath, sourceRoots) {
  if (sourceRoots.length === 0) return true;
  return sourceRoots.some((r) => relPath === r || relPath.startsWith(`${r}/`));
}

function splitExcludes(patterns) {
  const segments = [];
  const globs = [];
  const segmentOnly = new Set([
    'node_modules',
    'dist',
    'build',
    'coverage',
    'vendor',
  ]);
  for (const p of patterns) {
    if (segmentOnly.has(p) || (!p.includes('*') && !p.includes('?')))
      segments.push(p);
    else globs.push(p);
  }
  return { segments, globs };
}

async function readTextOrNull(path) {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return null;
  }
}

function fileChecksum(text) {
  return `sha256:${createHash('sha256').update(text).digest('hex')}`;
}

/**
 * Scan scope, from the cached `repo_state` row and nowhere else.
 *
 * This function MIRRORS `resolveRolloutScanOptions` in
 * `@fireweaveai/deploy-sdk/flags` rather than importing it — this file ships
 * standalone into a customer repo and cannot resolve `@fireweaveai/*`. The two
 * must therefore be changed together: if the gate and the SDK disagree about
 * which tree gets scanned, the gate is checking a different repo than the
 * scanner reports on.
 *
 * Both used to read `rolloutReady` out of the committed `.fireweave/project.json`
 * as well. They no longer do — scan scope is a `repo_state` field, and the
 * projection is where this worktree sees it. A repo with no projection falls
 * through to the generic excludes and an empty `sourceRoots`, i.e. scans the
 * WHOLE repo: too wide reports extra orphan anchors, which somebody sees; too
 * narrow reports nothing, which is indistinguishable from a clean repo.
 */
function scanConfigFrom(source) {
  const sourceRoots = Array.isArray(source?.sourceRoots)
    ? source.sourceRoots
    : [];
  const scanExclude = Array.isArray(source?.scanExclude)
    ? source.scanExclude
    : GENERIC_SCAN_EXCLUDE;
  const { segments, globs } = splitExcludes(scanExclude);
  return { sourceRoots, excludeSegments: segments, excludeGlobs: globs };
}

// ── The pointer ──────────────────────────────────────────────────────────────

/**
 * `absent` is a pass (row 1); every other non-`ok` outcome is a block. An
 * initialised repo whose pointer will not parse is precisely the state a
 * `catch {}` used to launder into a green build.
 */
async function readProject() {
  if (!existsSync(projPath)) return { status: 'absent' };
  const text = await readTextOrNull(projPath);
  if (text === null) return { status: 'unreadable', reason: 'cannot be read' };
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    return {
      status: 'invalid',
      reason: `is not valid JSON (${String(err?.message ?? err)})`,
    };
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { status: 'invalid', reason: 'is not a JSON object' };
  }
  return { status: 'ok', raw };
}

// ── Leg B: the projection (`.fireweave/.cache/`) ─────────────────────────────

async function readCacheFiles() {
  const out = new Map();
  for (const rel of [
    CACHE_META_FILENAME,
    CACHE_REPO_STATE_FILENAME,
    CACHE_README_FILENAME,
  ]) {
    const text = await readTextOrNull(join(cacheDir, rel));
    if (text !== null) out.set(rel, text);
  }
  for (const sub of [CACHE_ROLLOUT_READY_DIRNAME, CACHE_CHANGELOG_DIRNAME]) {
    let names;
    try {
      names = await readdir(join(cacheDir, sub));
    } catch {
      continue;
    }
    for (const name of names.sort()) {
      if (!name.endsWith('.json')) continue;
      const text = await readTextOrNull(join(cacheDir, sub, name));
      if (text !== null) out.set(`${sub}/${name}`, text);
    }
  }
  return out;
}

/**
 * The minimum of `validateRepoStateCache` this gate needs: schema version,
 * branch, and the checksum map in BOTH directions. An unlisted file matters as
 * much as a missing one — a stale manifest left behind by an earlier sync would
 * otherwise read as part of this branch's view, which is how an abandoned draft
 * greens a branch it was never on.
 */
function validateCache(files) {
  const metaText = files.get(CACHE_META_FILENAME);
  if (metaText === undefined) {
    return {
      status: 'absent',
      reason: `no .fireweave/.cache/${CACHE_META_FILENAME}: this worktree has never been synced, or a sync did not reach its final step`,
    };
  }
  let meta;
  try {
    meta = JSON.parse(metaText);
  } catch {
    return {
      status: 'invalid',
      reason: `.fireweave/.cache/${CACHE_META_FILENAME} is not JSON`,
    };
  }
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) {
    return {
      status: 'invalid',
      reason: `.fireweave/.cache/${CACHE_META_FILENAME} is not a JSON object`,
    };
  }
  if (meta.schemaVersion !== CACHE_SCHEMA_VERSION) {
    return {
      status: 'invalid',
      reason: `cache schemaVersion ${JSON.stringify(meta.schemaVersion)} ≠ ${CACHE_SCHEMA_VERSION} — this gate reads a different layout, and guessing which half of an older one is still true costs more than re-fetching`,
    };
  }
  if (typeof meta.branch !== 'string' || meta.branch.length === 0) {
    return {
      status: 'invalid',
      reason: `.fireweave/.cache/${CACHE_META_FILENAME} names no branch — the reader's view is branch-keyed and cannot be placed without one`,
    };
  }
  const checksums = meta.checksums;
  if (!checksums || typeof checksums !== 'object' || Array.isArray(checksums)) {
    return {
      status: 'invalid',
      reason: `.fireweave/.cache/${CACHE_META_FILENAME} carries no checksum map — integrity is what makes a partial write indistinguishable from no write`,
    };
  }
  const detail = [];
  for (const [rel, expected] of Object.entries(checksums)) {
    const text = files.get(rel);
    if (text === undefined) {
      detail.push(`${rel}: listed in meta.checksums but missing on disk`);
      continue;
    }
    if (fileChecksum(text) !== expected) {
      detail.push(
        `${rel}: checksum mismatch (hand-edited or partially written)`
      );
    }
  }
  for (const rel of files.keys()) {
    if (rel === CACHE_META_FILENAME) continue;
    if (!Object.prototype.hasOwnProperty.call(checksums, rel)) {
      detail.push(`${rel}: present on disk but not listed in meta.checksums`);
    }
  }
  if (detail.length > 0) {
    return {
      status: 'invalid',
      reason:
        'the cache does not match its own manifest — treating it as ABSENT rather than as data',
      detail: detail.sort(),
    };
  }
  return { status: 'ok', meta };
}

/** The cached `repo_state` row — where `sourceRoots` / `scanExclude` live post-migration. */
function repoStateFromCache(files) {
  const text = files.get(CACHE_REPO_STATE_FILENAME);
  if (text === undefined) return null;
  try {
    return JSON.parse(text)?.repoState ?? null;
  } catch {
    return null;
  }
}

/** One row per `.cache/rollout-ready/<feature>.json`. */
function cachedManifestRows(files, findings) {
  const rows = [];
  const prefix = `${CACHE_ROLLOUT_READY_DIRNAME}/`;
  for (const [rel, text] of files) {
    if (!rel.startsWith(prefix) || !rel.endsWith('.json')) continue;
    let raw;
    try {
      raw = JSON.parse(text);
    } catch {
      findings.push({
        rule: 'manifest-invalid',
        severity: 'block',
        message: `cached manifest .fireweave/.cache/${rel} is invalid JSON`,
        fix: SYNC_FIX,
      });
      continue;
    }
    rows.push({
      feature: rel.slice(prefix.length, -'.json'.length),
      shadowed: raw?._shadowed === true,
      status: raw?.row?.status,
      flags: raw?.row?.manifest?.flags ?? [],
      manifest: raw?.row?.manifest ?? null,
    });
  }
  return rows;
}

// ── Leg C: the author's own unsynced queue (`.fireweave/.queue/`) ────────────

/**
 * Entries in REPLAY order (ascending ULID = ascending authoring time), plus
 * whatever could not be read. Unreadable entries are REPORTED, never skipped: a
 * skipped entry is a manifest edit that vanished.
 */
async function readQueue() {
  let names;
  try {
    names = await readdir(queueDir);
  } catch {
    return { entries: [], unreplayable: [] };
  }
  const entries = [];
  const unreplayable = [];
  for (const file of names
    .filter((n) => QUEUE_ENTRY_FILENAME_PATTERN.test(n))
    .sort()) {
    const text = await readTextOrNull(join(queueDir, file));
    if (text === null) {
      unreplayable.push({ file, reason: 'cannot be read' });
      continue;
    }
    let raw;
    try {
      raw = JSON.parse(text);
    } catch {
      unreplayable.push({ file, reason: 'not valid JSON' });
      continue;
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      unreplayable.push({ file, reason: 'not a JSON object' });
      continue;
    }
    if (raw._schemaVersion !== QUEUE_SCHEMA_VERSION) {
      unreplayable.push({
        file,
        reason: `queue entry schema v${JSON.stringify(raw._schemaVersion)} — this gate speaks v${QUEUE_SCHEMA_VERSION}`,
      });
      continue;
    }
    if (
      raw.kind !== 'upsert-manifest' ||
      typeof raw.feature !== 'string' ||
      typeof raw.branch !== 'string' ||
      !Array.isArray(raw.manifest?.flags)
    ) {
      unreplayable.push({ file, reason: 'not a replayable manifest upsert' });
      continue;
    }
    entries.push({
      id: typeof raw.id === 'string' ? raw.id : file.slice(0, -'.json'.length),
      feature: raw.feature,
      branch: raw.branch,
      queuedAt: typeof raw._queuedAt === 'string' ? raw._queuedAt : null,
      flags: raw.manifest.flags,
      manifest: raw.manifest,
    });
  }
  return { entries, unreplayable };
}

// ── The branch, without shelling out to git ──────────────────────────────────

/**
 * `null` on a detached HEAD or outside a checkout — a branch this gate cannot
 * name is a staleness check it does not make, never a staleness check it fails.
 */
async function currentBranch() {
  const dotGit = join(root, '.git');
  if (!existsSync(dotGit)) return null;
  let headPath = join(dotGit, 'HEAD');
  // A FILE at `.git` means a linked worktree or a submodule: it points elsewhere.
  const pointer = await readTextOrNull(dotGit);
  if (pointer !== null) {
    const m = /^gitdir:\s*(.+?)\s*$/m.exec(pointer);
    if (!m) return null;
    const gitdir = m[1];
    headPath = join(isAbsolute(gitdir) ? gitdir : join(root, gitdir), 'HEAD');
  }
  const head = await readTextOrNull(headPath);
  if (head === null) return null;
  const ref = /^ref:\s*refs\/heads\/(.+?)\s*$/m.exec(head);
  return ref ? ref[1] : null;
}

// ── Anchors ──────────────────────────────────────────────────────────────────

function parseAnchors(text) {
  const keys = [];
  let m;
  ANCHOR_RE.lastIndex = 0;
  while ((m = ANCHOR_RE.exec(text)) !== null) keys.push(m[1]);
  return keys;
}

async function walkSourceFiles(dir, relBase, out, extensions) {
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
      await walkSourceFiles(join(dir, entry.name), relPath, out, extensions);
    } else if (
      entry.isFile() &&
      extensions.has(extname(entry.name).toLowerCase())
    ) {
      out.push(relPath);
    }
  }
}

async function collectAnchorFlags(scan, vocabulary) {
  const files = [];
  // `anchorScanExtensions`, never `extensions` — see `resolveScanVocabulary`.
  await walkSourceFiles(root, '', files, vocabulary.anchorScanExtensions);
  const byKey = new Map();
  for (const relPath of files) {
    if (!isUnderSourceRoot(relPath, scan.sourceRoots)) continue;
    if (isScanExcluded(relPath, scan.excludeSegments, scan.excludeGlobs))
      continue;
    const text = await readTextOrNull(join(root, relPath));
    if (text === null) continue;
    for (const key of parseAnchors(text)) {
      if (!byKey.has(key)) byKey.set(key, relPath);
    }
  }
  return byKey;
}

// ── Verdict ──────────────────────────────────────────────────────────────────

function emit(findings) {
  const pass = !findings.some((f) => f.severity === 'block');
  process.stdout.write(JSON.stringify({ pass, findings }) + '\n');
  process.exit(pass ? 0 : 1);
}

async function main() {
  const findings = [];
  const proj = await readProject();

  // ROW 1 — no pointer at all. Not a FireWeave repo; nothing to gate.
  if (proj.status === 'absent') return emit(findings);

  if (proj.status !== 'ok') {
    findings.push({
      rule: 'project-json-unreadable',
      severity: 'block',
      message: `.fireweave/project.json ${proj.reason} — an initialised repo whose pointer cannot be read is not a repo this gate can clear`,
    });
    return emit(findings);
  }

  /** Scan scope. Set from the projection once the cache validates — see ROW 3. */
  let scan;
  /** flag key → `{ origin: 'cache' | 'queue', feature, entryId?, queuedAt? }`. */
  const manifestFlags = new Map();
  /** `harness.surface` values the repo's own manifests declare — the scan vocabulary's input. */
  const declaredSurfaces = new Set();
  /** Pushed only once the vocabulary is known, so the info line can name it. */
  let manifestSource = null;

  {
    const cacheFiles = await readCacheFiles();
    const cache = validateCache(cacheFiles);
    const queue = await readQueue();

    // Reported in EVERY pointer row, including the block below: an entry that
    // cannot be read is an authored manifest nobody can check.
    for (const u of queue.unreplayable) {
      findings.push({
        rule: 'queue-unreplayable',
        severity: 'block',
        unsynced: true,
        message: `.fireweave/.queue/${u.file} is an unsynced manifest edit this gate cannot read (${u.reason}) — a queued edit that cannot be read is a contract that cannot be checked, and skipping it silently is how an author's own work disappears`,
        fix: 'drain the queue with the CLI that wrote it, or re-author the manifest — do NOT delete the entry blind',
      });
    }

    // ROW 3 — server-owned, no usable projection. Never green on absent evidence.
    if (cache.status !== 'ok') {
      findings.push({
        rule: 'cache-required',
        severity: 'block',
        message: `manifests for this repo are server-owned and there is no usable .fireweave/.cache/: ${cache.reason}. An absent manifest set is NOT evidence that no manifest exists, so this gate refuses to pass on it.`,
        fix: SYNC_FIX,
        ...(cache.detail ? { detail: cache.detail } : {}),
      });
      // No anchor scan: without a manifest source every anchor would report as
      // an orphan, burying the one finding that is actually true.
      return emit(findings);
    }

    const branch = await currentBranch();

    // ROW 4 — stale. Manifests are branch-keyed, so a different branch is a
    // different ANSWER, not merely an older one. Scan anyway; say so loudly.
    if (branch !== null && branch !== cache.meta.branch) {
      findings.push({
        rule: 'cache-stale',
        severity: 'warn',
        message: `.fireweave/.cache/ was composed for branch '${cache.meta.branch}' (fetched ${cache.meta.fetchedAt ?? 'unknown'}) but HEAD is '${branch}' — manifests are branch-keyed, so this is a different answer, not an older one. Scanning against it anyway; do not read a green result as agreement.`,
        fix: SYNC_FIX,
      });
    }

    // ROWS 5 + 6 — scan the cache, unioned with the author's own queued edits.
    // The queue is matched on the branch the reader is actually on; with no
    // branch to read (detached HEAD, no checkout) the projection's own branch is
    // the only coherent reference.
    const referenceBranch = branch ?? cache.meta.branch;
    const latestQueuedByFeature = new Map();
    for (const e of queue.entries) {
      if (e.branch === referenceBranch) latestQueuedByFeature.set(e.feature, e);
    }

    scan = scanConfigFrom(repoStateFromCache(cacheFiles));
    const rows = cachedManifestRows(cacheFiles, findings);
    let usedRows = 0;
    for (const row of rows) {
      // A shipped row the branch's own draft shadows is not this branch's answer.
      if (row.shadowed) continue;
      if (RETIRED_MANIFEST_STATUS.has(row.status)) continue;
      // The author's unsynced edit is newer than the projection it displaces.
      if (latestQueuedByFeature.has(row.feature)) continue;
      usedRows++;
      collectManifestSurfaces(row.manifest, declaredSurfaces);
      for (const f of row.flags) {
        if (f?.key)
          manifestFlags.set(f.key, {
            origin: 'cache',
            feature: row.feature,
            flag: f,
          });
      }
    }
    for (const e of latestQueuedByFeature.values()) {
      collectManifestSurfaces(e.manifest, declaredSurfaces);
      for (const f of e.flags) {
        if (f?.key) {
          manifestFlags.set(f.key, {
            origin: 'queue',
            feature: e.feature,
            entryId: e.id,
            queuedAt: e.queuedAt,
            flag: f,
          });
        }
      }
    }

    const queuedFeatures = [...latestQueuedByFeature.keys()].sort();
    manifestSource = {
      rule: 'manifest-source',
      severity: 'info',
      ...(queuedFeatures.length > 0 ? { unsynced: true } : {}),
      message:
        `manifest source: .fireweave/.cache/rollout-ready (${usedRows} row(s), branch '${cache.meta.branch}', fetched ${cache.meta.fetchedAt ?? 'unknown'})` +
        (queuedFeatures.length > 0
          ? ` ∪ .fireweave/.queue (${latestQueuedByFeature.size} UNSYNCED edit(s): ${queuedFeatures.join(', ')}) — teammates cannot see queued entries until the queue drains`
          : ''),
    };
  }

  // The scan VOCABULARY (which files are even opened) is derived from the
  // surface types this repo's own manifests declare — never a flat list.
  const vocabulary = resolveScanVocabulary([...declaredSurfaces]);
  if (manifestSource !== null) {
    // Deferred to here so the one INFO line a pointer-shaped repo always emits
    // also says which surfaces were scanned. "Which files did you even open?"
    // is not separable from "what did you find".
    manifestSource.message +=
      ` — scan vocabulary: ${vocabulary.surfaces.join(', ')}` +
      (vocabulary.widened && declaredSurfaces.size === 0
        ? ' (no manifest declares a surface; widened to every known surface rather than scanning nothing)'
        : '') +
      ' — orphan scan opens every known extension regardless, since an anchor on a' +
      ' surface no manifest declares is exactly what it exists to find';
    findings.push(manifestSource);
  }
  if (vocabulary.unknownSurfaces.length > 0) {
    findings.push({
      rule: 'scan-vocabulary-unknown-surface',
      severity: 'block',
      message:
        `surface type(s) ${vocabulary.unknownSurfaces.map((s) => `'${s}'`).join(', ')} have no scan vocabulary in this gate — ` +
        `it cannot say which files that surface lives in, so it cannot say the surface is clean. ` +
        `Scanning the union of every KNOWN surface (${vocabulary.surfaces.join(', ')}) meanwhile; ` +
        `a surface nobody can scan contributing zero findings is exactly the silence this gate exists to remove.`,
      fix: 'this gate copy predates the surface type — re-copy .fireweave/hooks/rollout-build-gate.mjs from the installed plugin, or add the surface to SURFACE_SCAN_VOCABULARY in packages/contracts/src/rollout/surface-scan-vocabulary.ts and every mirror',
    });
  }

  const anchorMap = await collectAnchorFlags(scan, vocabulary);
  const anchorFlags = new Set(anchorMap.keys());

  for (const coded of anchorFlags) {
    if (!manifestFlags.has(coded)) {
      findings.push({
        rule: 'orphan-anchor',
        severity: 'block',
        message: `coded flag '${coded}' has no manifest entry (orphan flag) — ${anchorMap.get(coded)}`,
        fix: `if you authored this manifest it is not in this worktree's view — ${SYNC_FIX}, or drain .fireweave/.queue/`,
      });
    }
  }
  for (const [declared, origin] of manifestFlags) {
    if (!anchorFlags.has(declared)) {
      findings.push({
        rule: 'manifest-flag-no-anchor',
        severity: 'block',
        ...(origin.origin === 'queue' ? { unsynced: true } : {}),
        message:
          `manifest flag '${declared}' has no code anchor` +
          (origin.origin === 'queue'
            ? ` — declared by the UNSYNCED queued edit ${origin.entryId} ('${origin.feature}'), which teammates cannot see`
            : ''),
      });
    }
  }

  // RAMP-1 — the feature stays OFF until the ramp turns it on.
  //
  // This rule lives in `assert_dev_checklist` too, and it has to live here as
  // well: `assert_dev_checklist` is an MCP tool an agent chooses to call, while
  // this gate is what the Cursor and Claude stop hooks actually run on every
  // stop. A flag that ships `default: true` past a green stop hook is on at 100%
  // before ramp step 1, and nothing in the hook path had ever looked.
  //
  // Scope, stated so the gap is not mistaken for coverage: this checks the
  // DECLARED default only. The value actually served outside the ramp cohort is
  // the second argument at the evaluation site, and resolving that needs the TS
  // compiler API (`_verify-eval-site-safe-defaults.ts`) which this standalone
  // `.mjs` cannot import. `assert_dev_checklist` remains the only gate that
  // checks the eval site.
  for (const [declared, origin] of manifestFlags) {
    const flag = origin.flag;
    if (!flag) continue;
    // Non-false / non-null / non-string default ships the feature on before the
    // first ramp step (`default: 1` is as bad as `true`; string defaults are
    // multivariate variant keys and stay out). Mirrors assert_dev_checklist.
    const onByDefault =
      flag.default === true ||
      (typeof flag.default === 'number' && flag.default !== 0);
    if (!onByDefault) continue;
    // A recorded exception is only legal with `default === true` (the manifest
    // schema enforces it) and downgrades block → warn for an honest kill-switch.
    const ex = flag.default === true ? flag.ramp1Exception : undefined;
    findings.push(
      ex
        ? {
            rule: 'ramp1-default',
            severity: 'warn',
            ...(origin.origin === 'queue' ? { unsynced: true } : {}),
            message: `manifest flag '${declared}' ('${origin.feature}') has default true — recorded RAMP-1 exception (${ex.trackedBy}: ${ex.reason})`,
            fix: `Remediate under ${ex.trackedBy} (owner ${ex.owner}): create the provider flag at 100% ON → verify serving → set eval-site + flags[].default to false, move local ON to makeDevProvider() devFlags, remove ramp1Exception. Never flip code first.`,
          }
        : {
            rule: 'ramp1-default',
            severity: 'block',
            ...(origin.origin === 'queue' ? { unsynced: true } : {}),
            message: `manifest flag '${declared}' ('${origin.feature}') has default ${JSON.stringify(flag.default)} — RAMP-1 requires the feature to stay off until ramp`,
            fix: `Set flags[].default to false for '${declared}' via upsert_rollout_manifest. Local dogfood ON → that surface's makeDevProvider() devFlags: { '${declared}': true } — never fw.flag(key, true). Prod ON is the ramp.`,
          }
    );
  }

  return emit(findings);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
