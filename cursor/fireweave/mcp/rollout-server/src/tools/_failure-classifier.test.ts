/**
 * Acceptance tests for the pure `classifyResponse` failure-classifier.
 *
 * R-IDs: R-003-2, R-003-3, R-003-4, R-003-6
 */

import { test, expect, describe } from 'bun:test';
import { classifyResponse, type ClassifierInput } from './_failure-classifier';

describe('R-003-6 classifyResponse is a deterministic pure function', () => {
  test('returns the same class for identical input across 100 calls', () => {
    const input: ClassifierInput = { httpStatus: 503, result: 'unused' };
    const first = classifyResponse(input);
    for (let i = 0; i < 100; i++) {
      expect(classifyResponse(input)).toBe(first);
    }
  });

  test('does not mutate its input', () => {
    const input: ClassifierInput = {
      httpStatus: 503,
      schemaValid: false,
      error: new Error('boom'),
      timedOut: false,
      toolFound: true,
      result: { x: 1 },
    };
    const snapshot = JSON.stringify({
      httpStatus: input.httpStatus,
      schemaValid: input.schemaValid,
      errorMessage: input.error?.message,
      timedOut: input.timedOut,
      toolFound: input.toolFound,
      result: input.result,
    });
    classifyResponse(input);
    const after = JSON.stringify({
      httpStatus: input.httpStatus,
      schemaValid: input.schemaValid,
      errorMessage: input.error?.message,
      timedOut: input.timedOut,
      toolFound: input.toolFound,
      result: input.result,
    });
    expect(after).toBe(snapshot);
  });
});

describe('R-003-4 / classifier precedence — tool_not_found wins', () => {
  test('toolFound:false outranks everything else', () => {
    expect(
      classifyResponse({
        toolFound: false,
        timedOut: true,
        httpStatus: 503,
        schemaValid: false,
        error: new Error('fetch failed'),
      })
    ).toBe('tool_not_found');
  });
});

describe('classifier precedence — timeout wins over network / http / schema', () => {
  test('timedOut:true outranks http + schema', () => {
    expect(
      classifyResponse({
        timedOut: true,
        httpStatus: 503,
        schemaValid: false,
      })
    ).toBe('timeout');
  });
});

describe('classifier — network error patterns', () => {
  test('matches "fetch failed"', () => {
    expect(classifyResponse({ error: new Error('fetch failed') })).toBe(
      'network'
    );
  });

  test('matches "getaddrinfo ENOTFOUND example.com"', () => {
    expect(
      classifyResponse({
        error: new Error('getaddrinfo ENOTFOUND example.com'),
      })
    ).toBe('network');
  });

  test('matches "ECONNREFUSED"', () => {
    expect(classifyResponse({ error: new Error('ECONNREFUSED') })).toBe(
      'network'
    );
  });

  test('matches "ECONNRESET"', () => {
    expect(classifyResponse({ error: new Error('ECONNRESET 1.2.3.4') })).toBe(
      'network'
    );
  });

  test('matches "ETIMEDOUT"', () => {
    expect(classifyResponse({ error: new Error('ETIMEDOUT') })).toBe('network');
  });

  test('matches case-insensitive "Network unreachable"', () => {
    expect(classifyResponse({ error: new Error('Network unreachable') })).toBe(
      'network'
    );
  });

  test('non-network error does NOT classify as network', () => {
    expect(classifyResponse({ error: new Error('some other error') })).toBe(
      'ok'
    );
  });
});

describe('R-003-2 classifier — HTTP 5xx', () => {
  test('500 → server_5xx', () => {
    expect(classifyResponse({ httpStatus: 500 })).toBe('server_5xx');
  });

  test('503 → server_5xx', () => {
    expect(classifyResponse({ httpStatus: 503 })).toBe('server_5xx');
  });

  test('599 → server_5xx', () => {
    expect(classifyResponse({ httpStatus: 599 })).toBe('server_5xx');
  });
});

describe('classifier — HTTP 4xx', () => {
  test('400 → client_4xx', () => {
    expect(classifyResponse({ httpStatus: 400 })).toBe('client_4xx');
  });

  test('401 → client_4xx', () => {
    expect(classifyResponse({ httpStatus: 401 })).toBe('client_4xx');
  });

  test('499 → client_4xx', () => {
    expect(classifyResponse({ httpStatus: 499 })).toBe('client_4xx');
  });
});

describe('R-003-3 classifier — schema_drift', () => {
  test('schemaValid:false alone → schema_drift', () => {
    expect(classifyResponse({ schemaValid: false })).toBe('schema_drift');
  });

  test('schemaValid:false but httpStatus 200 → schema_drift', () => {
    expect(classifyResponse({ httpStatus: 200, schemaValid: false })).toBe(
      'schema_drift'
    );
  });

  test('http 4xx beats schemaValid:false (precedence)', () => {
    expect(classifyResponse({ httpStatus: 401, schemaValid: false })).toBe(
      'client_4xx'
    );
  });
});

describe('classifier — ok', () => {
  test('empty input → ok', () => {
    expect(classifyResponse({})).toBe('ok');
  });

  test('httpStatus 200 → ok', () => {
    expect(classifyResponse({ httpStatus: 200 })).toBe('ok');
  });

  test('schemaValid:true + 200 → ok', () => {
    expect(classifyResponse({ httpStatus: 200, schemaValid: true })).toBe('ok');
  });

  test('toolFound:true + nothing else → ok', () => {
    expect(classifyResponse({ toolFound: true })).toBe('ok');
  });
});
