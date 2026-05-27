/**
 * @behaviour
 * @r-id R-003-6
 */
import { describe, it, expect } from 'bun:test';
import { resolve } from 'node:path';
import { execSync } from 'node:child_process';

const REPO_ROOT = execSync('git rev-parse --show-toplevel').toString().trim();
const SCRIPT = resolve(
  REPO_ROOT,
  'packages/fw-plugins/scripts/check-bridge-manifest-drift.sh'
);

describe('R-003-6 @structure-substitute: manifest drift gate', () => {
  it('check-bridge-manifest-drift.sh exits 0 when manifest.ts matches the codegen output', () => {
    let exitCode = 0;
    try {
      execSync(`bash ${SCRIPT}`, {
        encoding: 'utf8',
        stdio: 'pipe',
        cwd: REPO_ROOT,
      });
    } catch (err: unknown) {
      const status = (err as { status?: number }).status;
      exitCode = typeof status === 'number' ? status : 1;
    }
    expect(exitCode).toBe(0);
  });
});
