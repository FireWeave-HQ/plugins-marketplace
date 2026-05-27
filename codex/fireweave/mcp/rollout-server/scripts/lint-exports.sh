#!/usr/bin/env bash
# Pitch 028: ensure dist/types.d.ts symbol surface matches src/index.ts.
#
# Two extractors:
#  1) src/index.ts  — handles re-export forms `export { a, b, type C } from '...'`
#     and direct forms `export function foo`, `export const foo`, `export class foo`,
#     `export type Foo`, `export interface Foo`.
#  2) dist/types.d.ts — handles `export declare function|const|class` plus
#     `export type|interface`.
#
# Symbol names from BOTH sides are compared (sort -u + diff). Exit non-zero on drift.

set -euo pipefail

PKG_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PKG_DIR"

extract_src() {
  # Re-export blocks: `export { a, b, type C } from '...';` (may span multiple lines).
  # First flatten to one line, then peel inner names.
  awk '
    /^export[[:space:]]*\{/ { inblock=1 }
    inblock {
      printf("%s ", $0);
      if (match($0, /\}/)) { print ""; inblock=0 }
      next
    }
    { print }
  ' src/index.ts \
    | grep -oE '^export[[:space:]]+\{[^}]*\}' \
    | sed -E 's/^export[[:space:]]+\{//; s/\}.*$//' \
    | tr ',' '\n' \
    | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//; s/^type[[:space:]]+//' \
    | grep -v '^$' \
    > /tmp/lint-exports-src-$$.txt

  # Direct declarations.
  grep -oE '^export[[:space:]]+(function|const|class|type|interface)[[:space:]]+[A-Za-z_][A-Za-z0-9_]*' src/index.ts \
    | awk '{ print $NF }' \
    >> /tmp/lint-exports-src-$$.txt

  sort -u /tmp/lint-exports-src-$$.txt
  rm -f /tmp/lint-exports-src-$$.txt
}

extract_types() {
  # `export declare function|const|class` and `export type|interface`.
  grep -oE '^export[[:space:]]+(declare[[:space:]]+(function|const|class)|type|interface)[[:space:]]+[A-Za-z_][A-Za-z0-9_]*' dist/types.d.ts \
    | awk '{ print $NF }' \
    | sort -u
}

SRC_EXPORTS="$(extract_src)"
TYPES_EXPORTS="$(extract_types)"

if [ "$SRC_EXPORTS" != "$TYPES_EXPORTS" ]; then
  echo "lint:exports DRIFT — src/index.ts and dist/types.d.ts symbol surfaces disagree:" >&2
  diff <(echo "$SRC_EXPORTS") <(echo "$TYPES_EXPORTS") >&2 || true
  exit 1
fi

exit 0
