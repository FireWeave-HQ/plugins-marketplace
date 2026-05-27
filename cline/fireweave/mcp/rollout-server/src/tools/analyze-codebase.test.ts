import { test, expect } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { analyzeCodebase } from './analyze-codebase';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'analyze-codebase-test-'));
  try {
    await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Exported function declaration — high confidence
// ---------------------------------------------------------------------------
test('analyzeCodebase detects exported function declarations with confidence 1.0', async () => {
  await withTempDir(async (dir) => {
    const src = `
export function processOrder(orderId: string, userId: string): Promise<void> {
  return Promise.resolve();
}

function internalHelper(x: number): number {
  return x * 2;
}
`;
    await fs.writeFile(path.join(dir, 'order.ts'), src);

    const result = await analyzeCodebase({ repoRoot: dir, files: ['order.ts'] });
    const exported = result.candidates.find((c) => c.symbol === 'processOrder');

    expect(exported).toBeDefined();
    expect(exported!.kind).toBe('function');
    expect(exported!.confidence).toBe(1.0);
    expect(exported!.framework).toBe('unknown');
    expect(exported!.lineStart).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Non-exported nested function — lower confidence (0.5) — only if top-level
// ---------------------------------------------------------------------------
test('analyzeCodebase assigns 0.5 confidence to non-exported top-level functions', async () => {
  await withTempDir(async (dir) => {
    const src = `
function helperAtModuleLevel(): void {}
`;
    await fs.writeFile(path.join(dir, 'helper.ts'), src);

    const result = await analyzeCodebase({ repoRoot: dir, files: ['helper.ts'] });
    const helper = result.candidates.find((c) => c.symbol === 'helperAtModuleLevel');

    expect(helper).toBeDefined();
    expect(helper!.confidence).toBe(0.5);
  });
});

// ---------------------------------------------------------------------------
// Exported arrow function — high confidence
// ---------------------------------------------------------------------------
test('analyzeCodebase detects exported arrow-function constants', async () => {
  await withTempDir(async (dir) => {
    const src = `
export const handleCheckout = async (req: Request): Promise<Response> => {
  return new Response('ok');
};
`;
    await fs.writeFile(path.join(dir, 'checkout.ts'), src);

    const result = await analyzeCodebase({ repoRoot: dir, files: ['checkout.ts'] });
    const arrow = result.candidates.find((c) => c.symbol === 'handleCheckout');

    expect(arrow).toBeDefined();
    expect(arrow!.kind).toBe('arrow-function');
    expect(arrow!.confidence).toBe(1.0);
  });
});

// ---------------------------------------------------------------------------
// SvelteKit framework detection via filename heuristic
// ---------------------------------------------------------------------------
test('analyzeCodebase detects SvelteKit framework for +page.svelte file', async () => {
  await withTempDir(async (dir) => {
    // Svelte files are parsed as TS — simplified script block
    const src = `
export function load() {
  return { title: 'Home' };
}
`;
    await fs.writeFile(path.join(dir, '+page.svelte'), src);

    const result = await analyzeCodebase({ repoRoot: dir, files: ['+page.svelte'] });

    expect(result.candidates.length).toBeGreaterThan(0);
    expect(result.candidates.every((c) => c.framework === 'sveltekit')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// SvelteKit route handler — GET/POST exported from +server.ts
// ---------------------------------------------------------------------------
test('analyzeCodebase marks HTTP-method exports in +server.ts as route-handler', async () => {
  await withTempDir(async (dir) => {
    const src = `
export const GET = async (event: RequestEvent): Promise<Response> => {
  return new Response('hello');
};

export const POST = async (event: RequestEvent): Promise<Response> => {
  return new Response('created');
};
`;
    await fs.writeFile(path.join(dir, '+server.ts'), src);

    const result = await analyzeCodebase({ repoRoot: dir, files: ['+server.ts'] });
    const get = result.candidates.find((c) => c.symbol === 'GET');
    const post = result.candidates.find((c) => c.symbol === 'POST');

    expect(get?.kind).toBe('route-handler');
    expect(post?.kind).toBe('route-handler');
    expect(get?.framework).toBe('sveltekit');
  });
});

// ---------------------------------------------------------------------------
// Class method detection
// ---------------------------------------------------------------------------
test('analyzeCodebase detects class methods with 0.8 confidence', async () => {
  await withTempDir(async (dir) => {
    const src = `
export class UserService {
  async createUser(email: string): Promise<void> {}
  async deleteUser(id: string): Promise<void> {}
  constructor(private db: unknown) {}
}
`;
    await fs.writeFile(path.join(dir, 'user.service.ts'), src);

    const result = await analyzeCodebase({ repoRoot: dir, files: ['user.service.ts'] });
    const create = result.candidates.find((c) => c.symbol === 'UserService.createUser');
    const del = result.candidates.find((c) => c.symbol === 'UserService.deleteUser');
    // constructor should NOT appear
    const ctor = result.candidates.find((c) => c.symbol?.includes('constructor'));

    expect(create).toBeDefined();
    expect(create!.kind).toBe('class-method');
    expect(create!.confidence).toBe(0.8);
    expect(del).toBeDefined();
    expect(ctor).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// React framework detection via .tsx extension
// ---------------------------------------------------------------------------
test('analyzeCodebase detects React framework for .tsx files', async () => {
  await withTempDir(async (dir) => {
    const src = `
import React from 'react';

export function Button({ label }: { label: string }) {
  return React.createElement('button', null, label);
}
`;
    await fs.writeFile(path.join(dir, 'Button.tsx'), src);

    const result = await analyzeCodebase({ repoRoot: dir, files: ['Button.tsx'] });
    const btn = result.candidates.find((c) => c.symbol === 'Button');

    expect(btn).toBeDefined();
    expect(btn!.framework).toBe('react');
  });
});

// ---------------------------------------------------------------------------
// Missing file is skipped gracefully (no throw)
// ---------------------------------------------------------------------------
test('analyzeCodebase skips missing files without throwing', async () => {
  await withTempDir(async (dir) => {
    const result = await analyzeCodebase({
      repoRoot: dir,
      files: ['does-not-exist.ts'],
    });
    expect(result.candidates).toEqual([]);
  });
});
