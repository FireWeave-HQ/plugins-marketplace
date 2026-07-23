"""fw_providers.py — scaffolded by ``/fireweave:initialise`` (PYTHON surface).

The DEV provider is the OpenFeature in-memory provider (flag reads return the
code default). The PROD provider — the connected PostHog OpenFeature provider —
is DEFERRED for the python surface (Phase 1c): per ADR-017 FireWeave authors it
over the official ``posthog`` SDK; until it ships,
``make_connected_vendor_provider`` raises loudly rather than fake a prod path.

``fw eject`` deletes this file — call-sites read raw OpenFeature, so removing
FireWeave leaves no app-code lock-in.
"""

from __future__ import annotations

from openfeature.provider import AbstractProvider
from openfeature.provider.in_memory_provider import InMemoryProvider


def make_dev_provider() -> AbstractProvider:
    """DEV: OpenFeature in-memory provider — reads return the code default (echo).

    Swapped for the connected PostHog provider when python prod support ships
    (Phase 1c); the dev branch never reaches a vendor.
    """
    return InMemoryProvider({})


def make_connected_vendor_provider() -> AbstractProvider:
    """PROD: DEFERRED (Phase 1c).

    The connected PostHog OpenFeature provider for python is not built yet
    (ADR-017: FireWeave authors it over the official ``posthog`` SDK). Raising
    here keeps the prod branch honestly unbindable — ``verify_prod_path`` skips
    python as a recorded gap, never a false green.
    """
    raise NotImplementedError(
        "FireWeave python prod flag provider is deferred — build and test "
        "locally; prod ramp support lands in a later feature."
    )
