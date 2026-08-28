// Package fireweave — fw_harness.go, scaffolded by `/fireweave:initialise`
// (GO surface).
//
// This file is deliberately small: it is the one FireWeave writes into your
// repo that you should actually read. It answers one question — which tier is
// this process — and brings the SDK up. The machinery it delegates to (the
// environment-profile map, credential wiring) lives in fw_providers.go.
//
// The "promote, not wrap" model (D26): BOTH branches are present and the
// RUNNING ENVIRONMENT — resolved by NAME in fw_providers.go, not a bare
// boolean — selects which one is live. Nothing is swapped at promotion;
// `safe-rollout` ramps via `flag.control` and never mutates this file.
//
// InitFwHarness() MUST be called FIRST in main(), before any read.
// `verify_prod_path` asserts that, and asserts the tier decision below stays
// visible HERE rather than disappearing into a helper.
//
// Reads go through the control-points API directly — there is no FireWeave
// alias to learn, and no codemod to translate it back out (ADR-022). They never
// panic: every failure resolves to the default you passed, with the reason
// recorded on the Decision (spec/control-points.md "Return discipline"). Swap
// GetBooleanValue for GetBooleanDetails — same arguments — to see the reason:
//
//	// @fireweave-controlpoint <feature-slug>
//	if GetFwClient().ControlPoints().GetBooleanValue(
//	    "<feature-slug>", false, fireweave.NewEvaluationContext(userID, nil)) {
//	    ...
//	}
//
// defaultValue MUST be false at every call site (RAMP-1): the ramp turns a
// feature on, the default never does. To dogfood ON locally, seed the key in
// MakeDevProvider()'s LocalOptions.ControlPoints — never by passing true here,
// because that same true is what prod serves when the key is missing.
//
// Always pass a targeting key; a percentage ramp buckets on it. Omit it and the
// evaluation reports InvalidContext and you get your default. Pass a CONSTANT
// one and every caller hashes into a single bucket, which makes the ramp
// meaningless while looking healthy (spec/control-points.md "Context").
//
// TELEMETRY: the Go SDK carries no OpenTelemetry dependency. Wire
// go.opentelemetry.io yourself if this service exports spans — never a
// half-wired exporter (empty endpoint / placeholder creds), which looks
// configured and silently drops every span.
package fireweave

// InitFwHarness brings the SDK up for THIS environment. Call it first in
// main() and fail the process on error — a prod boot must fail loudly rather
// than degrade to serving every default (spec/modes.md).
func InitFwHarness() error {
	if IsProd() {
		return MakeConnectedVendorProvider()
	}
	return MakeDevProvider()
}
