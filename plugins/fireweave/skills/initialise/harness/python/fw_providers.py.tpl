"""fw_providers.py — scaffolded by ``/fireweave:initialise`` (PYTHON surface).

``make_connected_vendor_provider()`` is the prod flag provider with a CONCRETE
body: it binds the ``fireweave`` SDK's remote adapter (fw-server
``POST /v1/flags/evaluate``). The adapter reads ``FW_API_URL`` +
``FW_PROJECT_API_KEY`` from ``os.environ`` itself, so there is nothing to plumb
here. Apps do NOT embed PostHog keys — Seal provisions flags on
FireWeave-managed PostHog server-side.

``make_dev_provider()`` is the FireWeave LOCAL provider from the SAME SDK, served
through the same OpenFeature surface as prod. Both tiers therefore share
lifecycle gating and context canonicalization, so the harness cannot skew between
them. Never substitute a stock OpenFeature ``InMemoryProvider`` here: it answers
from a different code path than the one prod uses, which is how a flag behaves
one way on a laptop and another way in production.

``register_fw_target()`` is the OTHER half of targeting. Rules match on two kinds
of property and you need both:

  - DURABLE — registered here, once per login / device provisioning: plan, beta
    membership, region, device model. Stored server-side, so rules keep matching
    without the app resending anything, and backend systems can set facts the
    client never knows.
  - PER-REQUEST — the OpenFeature evaluation context: page, session, experiment
    context. Overrides the registered value for that one call.

A rule targeting a property that is never registered AND never sent matches
nobody, silently. Register the durable facts at sign-in.

Requires the ``openfeature`` extra: ``pip install 'fireweave[openfeature]'``.
The extra is what pulls ``openfeature-sdk``; ``fireweave`` core is
dependency-free by design, so without the bracket these imports fail.

Ejecting strips this file's imports and leaves the call-sites on raw OpenFeature,
so removing FireWeave leaves no app-code lock-in. The file itself is yours to
delete once nothing imports it.
"""

from __future__ import annotations

from typing import Any, Optional

from openfeature.provider import AbstractProvider

from fireweave import (
    FireweaveRemoteAdapter,
    FireweaveRuntime,
    RegisterTargetOptions,
)
from fireweave.openfeature import FireweaveProvider, make_fireweave_local_provider

# Retained so ``register_fw_target`` reaches the same runtime the provider uses.
_fw_runtime: Optional[FireweaveRuntime] = None


def make_connected_vendor_provider() -> AbstractProvider:
    """PROD: Fireweave remote provider → fw-server /v1/flags/evaluate.

    The adapter resolves ``FW_API_URL`` + ``FW_PROJECT_API_KEY`` from the
    environment and raises ``ConfigurationError`` at initialize() when either is
    missing — a loud prod misconfiguration rather than a silent all-defaults
    evaluation.
    """
    global _fw_runtime
    _fw_runtime = FireweaveRuntime(FireweaveRemoteAdapter())
    return FireweaveProvider(_fw_runtime)


def make_dev_provider() -> AbstractProvider:
    """DEV: FireWeave local provider (echo + dev_flags), same SDK as prod.

    Call-site / manifest defaults stay ``False`` (RAMP-1). To dogfood a flag ON
    locally, list it here — never ``fw_flag(key, True)`` (that same ``True`` is
    the prod fallback when the provider flag is missing)::

        return make_fireweave_local_provider(
            echo=True,
            dev_flags={"<feature-slug>": True},
        )
    """
    return make_fireweave_local_provider(echo=True)


def register_fw_target(
    targeting_key: str,
    properties: Optional[dict[str, Any]] = None,
    kind: str = "user",
) -> bool:
    """Register a user or device for DURABLE targeting.

    Call once from your auth middleware / sign-in handler, then pass the SAME id
    as ``targeting_key`` in the OpenFeature evaluation context::

        register_fw_target(user.id, properties={"plan": user.plan})

    Never raises — an analytics call must not break sign-in. On the dev tier
    there is no remote runtime, so this reports ``False`` rather than pretending
    to have registered anything.
    """
    if _fw_runtime is None:
        return False
    result = _fw_runtime.register_target(
        targeting_key,
        RegisterTargetOptions(kind=kind, properties=properties or {}),
    )
    return result.ok
