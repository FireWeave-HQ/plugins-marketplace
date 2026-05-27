// Hand-written declaration surface for @fireweaveai/rollout-server.
//
// Purpose: decouple fw-cli's tsc type-resolution path from rollout-server's
// implementation source. fw-cli's compilation context cannot see rollout-server's
// nested node_modules, so the implementation's transitive `zod` / `simple-git` /
// `@modelcontextprotocol/sdk` / `@fireweaveai/fw-rollout-types` imports surface
// as TS2307 errors. This file MUST stay self-contained — no external imports —
// and use loose `any` / `unknown` signatures. The lint:exports script keeps the
// symbol list in parity with src/index.ts; runtime resolution continues through
// the `default` exports condition (-> src/index.ts) in package.json.
//
// Pitch 028: fw-cli ↔ rollout-server type decouple.

// Verifier return shape — lifted verbatim from
// packages/fw-cli/src/commands/verify.ts:19-23 (VerifierReturn). Not exported
// (src/index.ts does not export it) — local to this declaration file so
// lint:exports stays in symbol parity.
interface VerifierReturn {
  error?: { code: string; message: string };
  pass?: boolean;
  findings?: unknown[];
}

// Verifier functions (7) — loose `any` input matches fw-cli/src/commands/verify.ts:29-44.
export declare function verifyCohortKeying(input: any): Promise<VerifierReturn>;
export declare function verifyNoOrphanFlags(input: any): Promise<VerifierReturn>;
export declare function verifySafeDefaults(input: any): Promise<VerifierReturn>;
export declare function verifyNoMixedProviderCalls(input: any): Promise<VerifierReturn>;
export declare function verifyTelemetryCompleteness(input: any): Promise<VerifierReturn>;
export declare function verifyRolloutConfigSchema(input: any): Promise<VerifierReturn>;
export declare function verifyProviderHealth(input: any): Promise<VerifierReturn>;

// Verifier tool descriptors (MCP tool definitions; opaque to fw-cli).
export declare const verifyCohortKeyingTool: unknown;
export declare const verifyNoOrphanFlagsTool: unknown;
export declare const verifySafeDefaultsTool: unknown;
export declare const verifyNoMixedProviderCallsTool: unknown;
export declare const verifyTelemetryCompletenessTool: unknown;
export declare const verifyRolloutConfigSchemaTool: unknown;
export declare const verifyProviderHealthTool: unknown;

// Auth + project tools.
export declare function ensureAuth(input: any): Promise<unknown>;
export declare const ensureAuthTool: unknown;
export declare function listProjects(input: any): Promise<unknown>;
export declare const listProjectsTool: unknown;
export declare function selectProject(input: any): Promise<unknown>;
export declare const selectProjectTool: unknown;

// Baseline + diff tools.
export declare function detectBaseline(input: any): Promise<unknown>;
export declare const detectBaselineTool: unknown;
export declare function extractDiffSurface(input: any): Promise<unknown>;
export declare const extractDiffSurfaceTool: unknown;
export declare function tagBaselineCommit(input: any): Promise<unknown>;
export declare const tagBaselineCommitTool: unknown;

// Analysis + recommendation tools.
export declare function analyzeCodebase(input: any): Promise<unknown>;
export declare const analyzeCodebaseTool: unknown;
export declare function recommendRolloutStrategy(input: any): Promise<unknown>;
export declare const recommendRolloutStrategyTool: unknown;
export declare function proposeMetrics(input: any): Promise<unknown>;
export declare const proposeMetricsTool: unknown;
export declare function generateWrapper(input: any): Promise<unknown>;
export declare const generateWrapperTool: unknown;

// Preference tools.
export declare function readPreferences(input: any): Promise<unknown>;
export declare const readPreferencesTool: unknown;
export declare function writePreferences(input: any): Promise<unknown>;
export declare const writePreferencesTool: unknown;

// Lockfile tools.
export interface LockfileState {
  [key: string]: unknown;
}
export declare function readLockfile(input: any): Promise<unknown>;
export declare const readLockfileTool: unknown;
export declare function writeLockfile(input: any): Promise<unknown>;
export declare const writeLockfileTool: unknown;
export declare function clearLockfile(input: any): Promise<unknown>;
export declare const clearLockfileTool: unknown;

// Confirmation-receipt tools (pitch 026 surface).
export interface WriteConfirmationReceiptInput {
  [key: string]: unknown;
}
export interface WriteConfirmationReceiptResult {
  [key: string]: unknown;
}
export declare function writeConfirmationReceipt(input: any): Promise<unknown>;
export declare const writeConfirmationReceiptTool: unknown;
export declare const DYNAMIC_GATE_PREFIXES: unknown;

export interface AnnotatedReceipt {
  [key: string]: unknown;
}
export interface ReadConfirmationReceiptsResult {
  [key: string]: unknown;
}
export declare function readConfirmationReceipts(input: any): Promise<unknown>;
export declare const readConfirmationReceiptsTool: unknown;

// Receipt-guard surface.
export interface ConfirmationMissingError {
  [key: string]: unknown;
}
export declare const RECEIPT_REQUIREMENTS: unknown;
export declare const REGISTER_TIME_REQUIRED_GATES: unknown;
export declare function requireReceipts(input: any): unknown;
export declare function requireFullInventory(input: any): unknown;

// Failure classifier.
export interface ClassifierInput {
  [key: string]: unknown;
}
export interface ClassifierResult {
  [key: string]: unknown;
}
export declare function classifyResponse(input: any): unknown;

// Remediation table.
export interface PolicyClass {
  [key: string]: unknown;
}
export interface PolicyCell {
  [key: string]: unknown;
}
export declare const POLICY_TABLE: unknown;
export declare function getRemediation(input: any): unknown;

// Guarded-call surface.
export interface GuardedCallInput {
  [key: string]: unknown;
}
export interface GuardedCallResult {
  [key: string]: unknown;
}
export interface GuardedCallError {
  [key: string]: unknown;
}
export type GuardedCallErrorCode = string;
export interface DispatchTable {
  [key: string]: unknown;
}
export type ServerPrefix = string;
export declare function createGuardedCall(input: any): unknown;
export declare const guardedCallTool: unknown;

// Responsibility-rule analyzer.
export interface Violation {
  [key: string]: unknown;
}
export interface AnalyzeResult {
  [key: string]: unknown;
}
export declare function analyzeToolSource(input: any): unknown;
export declare const DEPRECATION_ALLOWLIST: unknown;
