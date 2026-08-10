"""fw_providers.py — scaffolded by ``/fireweave:initialise`` (PYTHON surface).

The DEV provider is the OpenFeature in-memory provider (flag reads return the
code default). The PROD provider — Fireweave remote via the Python
``fireweave`` SDK (``FireweaveRemoteAdapter`` → fw-server
``/v1/flags/evaluate``) — is DEFERRED for the python surface until the
published package is wired into initialise. Until then,
``make_connected_vendor_provider`` raises loudly rather than fake a prod path.

Ejecting strips this file's imports and leaves the call-sites on raw OpenFeature,
so removing FireWeave leaves no app-code lock-in. The file itself is yours to
delete once nothing imports it.
"""

from __future__ import annotations

from openfeature.provider import AbstractProvider
from openfeature.provider.in_memory_provider import InMemoryProvider


def make_dev_provider() -> AbstractProvider:
    """DEV: OpenFeature in-memory provider — reads return the code default (echo).

    Swapped for the Fireweave remote provider when python prod support ships;
    the dev branch never reaches a vendor.
    """
    return InMemoryProvider({})


def make_connected_vendor_provider() -> AbstractProvider:
    """PROD: DEFERRED.

    Wire ``fireweave.FireweaveRemoteAdapter`` + ``FireweaveProvider``
    (https://github.com/FireWeave-HQ/fireweave-sdk) with ``FW_API_URL`` +
    ``FW_PROJECT_API_KEY`` when python prod scaffolding lands. Raising here
    keeps the prod branch honestly unbindable — ``verify_prod_path`` skips
    python as a recorded gap, never a false green.
    """
    raise NotImplementedError(
        "FireWeave python prod flag provider is deferred — build and test "
        "locally with the fireweave SDK remote adapter; prod ramp support "
        "lands in a later feature."
    )


def register_fw_target(
    targeting_key: str,
    properties: dict[str, object] | None = None,
    kind: str = "user",
) -> bool:
    """Register a user or device for DURABLE targeting: DEFERRED on python.

    Rules match on two kinds of property: DURABLE ones registered once at login
    (plan, beta membership, region, device model) and PER-REQUEST ones carried
    in the evaluation context. A rule targeting a property that is never
    registered AND never sent matches nobody, silently.

    Python has no prod flag path yet (see ``make_connected_vendor_provider``),
    so this returns ``False`` — "not registered" — rather than pretending. It
    never raises: registration belongs in sign-in paths, where an analytics call
    must not break login. Wire it to ``POST /v1/targets/register`` when the
    python prod surface lands.
    """
    del targeting_key, properties, kind  # deferred: no prod transport yet
    return False
