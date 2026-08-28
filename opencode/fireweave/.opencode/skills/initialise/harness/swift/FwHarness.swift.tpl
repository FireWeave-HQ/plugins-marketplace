// FwHarness.swift — scaffolded by `/fireweave:initialise` (SWIFT surface).
//
// This file is deliberately small: it is the one FireWeave writes into your app
// that you should actually read. It answers one question — which tier is this
// build — and brings the SDK up. The machinery it delegates to (the
// environment-profile map, credential wiring, device identity) lives in
// `FwProviders.swift`.
//
// The "promote, not wrap" model (D26): BOTH branches are present and the
// RUNNING ENVIRONMENT — resolved by NAME in `FwProviders`, not a bare boolean —
// selects which one is live, via `FW_ENV_PROFILES`. Nothing is swapped at
// promotion; `safe-rollout` ramps via `flag.control` and never mutates this file.
//
// `initFwHarness()` MUST be awaited first in the app's bootstrap, before the
// first read. `verify_prod_path` asserts that, and asserts the tier decision
// below stays visible HERE rather than disappearing into a helper.
//
// Reads go through the control-points API directly — there is no FireWeave
// alias to learn, and no codemod to translate it back out (ADR-022). They are
// SYNCHRONOUS (the SDK prefetches a decision cache once at boot and the read is
// a pure in-memory lookup, safe on the main actor) and never throw: every
// failure resolves to the default you passed, with the reason on the `Decision`
// (spec/control-points.md "Return discipline"). Swap `getBooleanValue` for
// `getBooleanDetails` — same arguments — to see the reason:
//
//   // @fireweave-controlpoint <feature-slug>
//   if FwProviders.getFwClient().controlPoints.getBooleanValue(
//        "<feature-slug>", default: false,
//        context: EvaluationContext(targetingKey: userId)) { ... }
//
// `defaultValue` MUST be `false` at every call site (RAMP-1): the ramp turns a
// feature on, the default never does. To dogfood ON locally, seed the key in
// `FwProviders.makeDevProvider()`'s `controlPoints` — never by passing `true`
// here, because that same `true` is what prod serves when the key is missing.
//
// Always pass a `targetingKey`; a percentage ramp buckets on it. Omit it and the
// evaluation reports `InvalidContext` and you get your default. Pass a CONSTANT
// one and every caller hashes into a single bucket, which makes the ramp
// meaningless while looking healthy (spec/control-points.md "Context").
//
// TELEMETRY: the Fireweave swift SDK carries no OpenTelemetry dependency. Wire
// tracing yourself if this app exports spans — never a half-wired exporter
// (empty endpoint / placeholder creds), which looks configured and silently
// drops every span.

import Fireweave
import Foundation

public enum FwHarness {

  private static let readyLock = NSLock()
  private static var ready = false

  /// Idempotent boot — await FIRST in the app's bootstrap, before any read.
  public static func initFwHarness() async throws {
    let alreadyReady: Bool = readyLock.withLock {
      let was = ready
      ready = true
      return was
    }
    if alreadyReady { return }

    if FwProviders.isProd() {
      _ = try await FwProviders.makeConnectedVendorProvider()
    } else {
      _ = try await FwProviders.makeDevProvider()
    }
  }
}
