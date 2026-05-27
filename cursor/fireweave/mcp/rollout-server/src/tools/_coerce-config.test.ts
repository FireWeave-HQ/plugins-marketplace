import { test, expect } from 'bun:test';
import { coerceConfigArg } from './_coerce-config';

test('coerceConfigArg passes through plain objects', () => {
  const obj = { version: 1, project: { id: 'p_a' } };
  expect(coerceConfigArg(obj)).toBe(obj);
});

test('coerceConfigArg parses JSON strings into objects', () => {
  const json = JSON.stringify({ version: 1, project: { id: 'p_a' } });
  const result = coerceConfigArg(json);
  expect(result).toEqual({ version: 1, project: { id: 'p_a' } });
});

test('coerceConfigArg throws helpful error on malformed JSON string', () => {
  expect(() => coerceConfigArg('{not valid json')).toThrow(/not valid JSON/);
});

test('coerceConfigArg throws when JSON parses to a non-object (number)', () => {
  expect(() => coerceConfigArg('42')).toThrow(/non-object/);
});

test('coerceConfigArg throws when JSON parses to an array', () => {
  expect(() => coerceConfigArg('[1, 2, 3]')).toThrow(/non-object/);
});

test('coerceConfigArg throws on unsupported types', () => {
  expect(() => coerceConfigArg(42)).toThrow(/unexpected type/);
  expect(() => coerceConfigArg(null)).toThrow(/unexpected type/);
  expect(() => coerceConfigArg(undefined)).toThrow(/unexpected type/);
  expect(() => coerceConfigArg(true)).toThrow(/unexpected type/);
});

test('coerceConfigArg rejects bare arrays (caught at object check)', () => {
  expect(() => coerceConfigArg([1, 2])).toThrow();
});
