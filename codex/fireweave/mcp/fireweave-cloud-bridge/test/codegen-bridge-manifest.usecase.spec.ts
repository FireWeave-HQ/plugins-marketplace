/**
 * Acceptance test for T2 — OpenAPI -> Zod codegen for the fireweave-cloud-bridge
 * manifest.
 *
 * R-IDs: R-003-3, R-003-8
 *   - R-003-3 (NON-NEG) @usecase codegen-bridge-manifest against a fixture
 *     OpenAPI document -> emits manifest.ts with one entry per operationId,
 *     each entry carrying { verb, path, inputSchema (Zod schema),
 *     responseShape }.
 *   - R-003-8 (NON-NEG) @usecase codegen toolchain spike -> produces working
 *     manifest for register_rollout, seal_rollout, and whoami; toolchain
 *     choice documented in scope completion notes; CI drift-check operates
 *     on the chosen toolchain's output. SPIKE pre-resolved by the
 *     orchestrator: custom Bun script (no `openapi-zod-client` dep).
 *
 * Reconciliation note for R-003-8 vs R-003-9:
 *   R-003-8 requires the toolchain to PROCESS whoami's OpenAPI entry without
 *   error. R-003-9 (carry-through, asserted on the emitted manifest) forbids
 *   whoami from appearing in the manifest. The split-contract interpretation
 *   below holds: the codegen function MUST NOT throw on whoami's input
 *   schema, but its emitted manifest MUST NOT contain a `whoami` key.
 *
 * Builder contract (made explicit here so T2's implementer sees it):
 *   - Export a pure function `generateManifestFromOpenApi(openApiDoc) =>
 *     Record<operationId, BridgeManifestEntry>` from
 *     `packages/fw-plugins/scripts/codegen-bridge-manifest.ts`.
 *   - BridgeManifestEntry shape: { verb: string; path: string;
 *     inputSchema: ZodTypeAny; responseShape: ZodTypeAny }.
 *   - The script's CLI mode (writing manifest.ts to disk) wraps that pure
 *     function. This split keeps the function unit-testable.
 *   - Header comment in the script MUST document the SPIKE outcome
 *     (custom Bun script, no openapi-zod-client dep) so the toolchain
 *     choice is auditable.
 *
 * Red Gate expectation:
 *   This file's first import resolves to a not-yet-created script. All four
 *   `it()` blocks fail with MODULE_NOT_FOUND on `../../../../../../scripts/
 *   codegen-bridge-manifest` until the T2 builder lands the script.
 */
import { describe, it, expect } from 'bun:test';
// Imported from the codegen script T2 ships.
import { generateManifestFromOpenApi } from '../../../../../../scripts/codegen-bridge-manifest';

/**
 * Fixture OpenAPI doc — minimal but covers the three operations the SPIKE
 * outcome must process: register_rollout (POST + body), seal_rollout
 * (POST + path param), whoami (GET, no body). The shape is a subset of
 * what `apps/fw-server/scripts/emit-openapi.ts` produces; the codegen
 * script must accept this shape.
 */
const fixtureOpenApi = {
  openapi: '3.0.0',
  info: { title: 'fireweave-cloud-fixture', version: '0.0.0' },
  paths: {
    '/v1/rollouts': {
      post: {
        operationId: 'register_rollout',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name'],
                properties: {
                  name: { type: 'string' },
                  description: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'ok',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['rolloutId'],
                  properties: {
                    rolloutId: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/v1/rollouts/{id}/seal': {
      post: {
        operationId: 'seal_rollout',
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
        ],
        responses: {
          '200': {
            description: 'ok',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['sealed'],
                  properties: { sealed: { type: 'boolean' } },
                },
              },
            },
          },
        },
      },
    },
    '/v1/whoami': {
      get: {
        operationId: 'whoami',
        responses: {
          '200': {
            description: 'ok',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['userId', 'email'],
                  properties: {
                    userId: { type: 'string' },
                    email: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
};

describe('R-003-3 R-003-8 @usecase: codegen-bridge-manifest produces correct manifest entries', () => {
  it('emits one manifest entry per non-whoami operationId (R-003-3 emit shape, R-003-9 whoami exclusion)', () => {
    const manifest = generateManifestFromOpenApi(fixtureOpenApi);
    // R-003-9 carry-through: whoami MUST be excluded from the emitted manifest.
    expect(manifest['whoami']).toBeUndefined();
    // R-003-3: exactly the non-whoami operationIds are present.
    expect(Object.keys(manifest).sort()).toEqual([
      'register_rollout',
      'seal_rollout',
    ]);
  });

  it('each entry carries { verb, path, inputSchema, responseShape } with Zod-shaped schemas (R-003-3)', () => {
    const manifest = generateManifestFromOpenApi(fixtureOpenApi);
    const register = manifest['register_rollout'];
    // Strict-mode narrowing guard — Record<string, T> index returns T | undefined.
    if (!register) {
      throw new Error('expected register_rollout entry in manifest');
    }
    expect(register.verb).toBe('POST');
    expect(register.path).toBe('/v1/rollouts');
    // inputSchema + responseShape must be Zod schemas. We probe via the
    // public `parse` method rather than internal `_def` to keep the
    // contract Zod-version-agnostic. A non-Zod value would not have a
    // callable `parse`.
    expect(typeof register.inputSchema?.parse).toBe('function');
    expect(typeof register.responseShape?.parse).toBe('function');
    // Sanity: the inputSchema accepts a well-formed fixture body.
    expect(() =>
      register.inputSchema.parse({ name: 'rollout-A', description: 'd' })
    ).not.toThrow();
  });

  it('seal_rollout path template preserved verbatim from OpenAPI (R-003-3)', () => {
    const manifest = generateManifestFromOpenApi(fixtureOpenApi);
    const seal = manifest['seal_rollout'];
    if (!seal) {
      throw new Error('expected seal_rollout entry in manifest');
    }
    expect(seal.verb).toBe('POST');
    // Path template `{id}` must survive intact — the bridge needs it to
    // substitute the path parameter at call time. Encoding it (e.g., to
    // `/v1/rollouts/:id` or URL-encoded braces) would break T3's REST
    // proxy logic.
    expect(seal.path).toBe('/v1/rollouts/{id}/seal');
  });

  it('toolchain choice documented in codegen script header; openapi-zod-client NOT imported (R-003-8)', () => {
    // SPIKE outcome assertion: read the codegen script as source text and
    // verify (a) the header documents the chosen toolchain and (b) the
    // forbidden dep is not imported. This is the CI drift-check anchor
    // R-003-8 calls out: a future contributor who silently swaps in
    // openapi-zod-client without updating the header breaks this assertion.
    //
    // Using dynamic require to read the script from disk (the static import
    // at the top of this file imports the module's runtime exports; we
    // need the raw source for header inspection).
    const { readFileSync } = require('node:fs') as typeof import('node:fs');
    const { resolve } = require('node:path') as typeof import('node:path');
    // 6 levels up from the test/ directory reaches the fw-plugins package
    // root (verified during scaffold). Then scripts/codegen-bridge-manifest.ts.
    const scriptPath = resolve(
      __dirname,
      '../../../../../../scripts/codegen-bridge-manifest.ts'
    );
    const source: string = readFileSync(scriptPath, 'utf8');
    // (a) Header must reference the SPIKE outcome / toolchain choice.
    expect(source).toMatch(/SPIKE|custom Bun script|toolchain choice/i);
    // (b) Forbidden dependency import must not appear.
    expect(source).not.toMatch(/from\s+['"]openapi-zod-client['"]/);
    expect(source).not.toMatch(/require\(\s*['"]openapi-zod-client['"]\s*\)/);
  });
});
