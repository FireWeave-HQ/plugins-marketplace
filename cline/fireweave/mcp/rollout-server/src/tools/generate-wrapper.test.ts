import { test, expect } from 'bun:test';
import { generateWrapper } from './generate-wrapper';
import type { WrapPoint } from './generate-wrapper';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeWrapPoint(
  overrides: Partial<WrapPoint> = {},
): WrapPoint {
  return {
    file: 'src/lib/checkout.ts',
    symbol: 'processCheckout',
    wrapStyle: 'function-guard',
    lineRange: [10, 25],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// function-guard patch
// ---------------------------------------------------------------------------
test('generateWrapper produces function-guard patch with evaluate call', async () => {
  const result = await generateWrapper({
    wrapPoint: makeWrapPoint({ wrapStyle: 'function-guard' }),
    flagKey: 'checkout-v2',
    providerId: 'posthog',
    distinctIdExpression: 'userId',
    safeDefaultLiteral: 'false',
    framework: 'unknown',
  });

  expect(result.file).toBe('src/lib/checkout.ts');
  expect(result.symbol).toBe('processCheckout');
  expect(result.patch).toContain("evaluate('checkout-v2', userId, false)");
  expect(result.patch).toContain('startSpan');
  expect(result.patch).toContain('endSpan');
  expect(result.patch).toContain('return false'); // safe default
  expect(result.imports).toContain(
    "import { evaluate, startSpan, endSpan } from '@fireweaveai/fw-feature-flags';",
  );
  expect(result.warnings).toHaveLength(0);
});

// ---------------------------------------------------------------------------
// route-guard patch
// ---------------------------------------------------------------------------
test('generateWrapper produces route-guard patch with Response return for disabled path', async () => {
  const result = await generateWrapper({
    wrapPoint: makeWrapPoint({
      wrapStyle: 'route-guard',
      file: 'src/routes/api/checkout/+server.ts',
      symbol: 'POST',
    }),
    flagKey: 'new-checkout-flow',
    providerId: 'posthog',
    distinctIdExpression: 'event.locals.user.id',
    safeDefaultLiteral: 'false',
    framework: 'sveltekit',
  });

  expect(result.patch).toContain("evaluate('new-checkout-flow', event.locals.user.id, false)");
  expect(result.patch).toContain('new Response');
  expect(result.patch).toContain("'Content-Type': 'application/json'");
  expect(result.originalLines.start).toBe(10);
  expect(result.originalLines.end).toBe(25);
});

// ---------------------------------------------------------------------------
// component-guard — React uses useFeatureFlag hook
// ---------------------------------------------------------------------------
test('generateWrapper produces React component-guard patch with useFeatureFlag', async () => {
  const result = await generateWrapper({
    wrapPoint: makeWrapPoint({
      wrapStyle: 'component-guard',
      file: 'src/components/CheckoutButton.tsx',
      symbol: 'CheckoutButton',
    }),
    flagKey: 'new-checkout-button',
    providerId: 'posthog',
    distinctIdExpression: 'userId',
    safeDefaultLiteral: 'false',
    framework: 'react',
  });

  expect(result.patch).toContain("useFeatureFlag('new-checkout-button', userId, false)");
  expect(result.patch).toContain('return null'); // safe default for React
  expect(result.imports).toContain(
    "import { useFeatureFlag } from '@fireweaveai/fw-feature-flags/react';",
  );
});

// ---------------------------------------------------------------------------
// component-guard — SvelteKit uses #if block
// ---------------------------------------------------------------------------
test('generateWrapper produces Svelte component-guard patch with {#if} block', async () => {
  const result = await generateWrapper({
    wrapPoint: makeWrapPoint({
      wrapStyle: 'component-guard',
      file: 'src/routes/(app)/+page.svelte',
      symbol: 'default',
    }),
    flagKey: 'new-dashboard',
    providerId: 'posthog',
    distinctIdExpression: 'data.user.id',
    safeDefaultLiteral: 'false',
    framework: 'sveltekit',
  });

  expect(result.patch).toContain('{#if __fwEnabled}');
  expect(result.patch).toContain('{/if}');
  expect(result.patch).toContain("evaluate('new-dashboard', data.user.id, false)");
});

// ---------------------------------------------------------------------------
// shadow-call patch
// ---------------------------------------------------------------------------
test('generateWrapper produces shadow-call patch with dark-launch structure', async () => {
  const result = await generateWrapper({
    wrapPoint: makeWrapPoint({ wrapStyle: 'shadow-call' }),
    flagKey: 'payment-provider-migration',
    providerId: 'posthog',
    distinctIdExpression: 'customerId',
    safeDefaultLiteral: 'false',
    framework: 'unknown',
  });

  expect(result.patch).toContain('shadow-call');
  expect(result.patch).toContain('__oldResult');
  expect(result.patch).toContain('__newResult');
  expect(result.patch).toContain("'payment-provider-migration'");
});

// ---------------------------------------------------------------------------
// Warning emitted when no lineRange supplied
// ---------------------------------------------------------------------------
test('generateWrapper emits warning when wrapPoint has no lineRange', async () => {
  const wpNoRange: WrapPoint = {
    file: 'src/lib/auth.ts',
    symbol: 'login',
    wrapStyle: 'function-guard',
    // lineRange intentionally omitted
  };

  const result = await generateWrapper({
    wrapPoint: wpNoRange,
    flagKey: 'new-auth',
    providerId: 'posthog',
    distinctIdExpression: 'userId',
    safeDefaultLiteral: 'false',
    framework: 'unknown',
  });

  expect(result.warnings.length).toBeGreaterThan(0);
  expect(result.warnings[0]).toContain('lineRange');
  expect(result.originalLines.start).toBe(0);
  expect(result.originalLines.end).toBe(0);
});

// ---------------------------------------------------------------------------
// Flag key with unusual characters emits warning
// ---------------------------------------------------------------------------
test('generateWrapper warns when flagKey contains unusual characters', async () => {
  const result = await generateWrapper({
    wrapPoint: makeWrapPoint(),
    flagKey: 'flag key with spaces!',
    providerId: 'posthog',
    distinctIdExpression: 'userId',
    safeDefaultLiteral: 'false',
    framework: 'unknown',
  });

  expect(result.warnings.some((w) => w.toLowerCase().includes('unusual'))).toBe(true);
});

// ---------------------------------------------------------------------------
// Imports are deduplicated
// ---------------------------------------------------------------------------
test('generateWrapper deduplicates import statements', async () => {
  const result = await generateWrapper({
    wrapPoint: makeWrapPoint({ wrapStyle: 'function-guard' }),
    flagKey: 'feature-a',
    providerId: 'posthog',
    distinctIdExpression: 'userId',
    safeDefaultLiteral: 'false',
    framework: 'unknown',
  });

  const uniqueImports = new Set(result.imports);
  expect(result.imports.length).toBe(uniqueImports.size);
});
