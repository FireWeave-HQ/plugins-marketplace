"""fw_harness.py — scaffolded by ``/fireweave:initialise`` (python surface).

This file is deliberately small: it is the one FireWeave writes into your repo
that you should actually read. It answers two questions and nothing else — which
tier is this process, and how do I read a control point. The machinery it
delegates to (the environment-profile map, credential wiring) lives in
``fw_providers.py``.

The "promote, not wrap" model (D26): BOTH branches are present and the RUNNING
ENVIRONMENT — resolved by NAME in ``fw_providers.py``, not a bare boolean —
selects which one is live. Nothing is swapped at promotion; ``safe-rollout``
ramps via ``flag.control`` and never mutates this file.

``init_fw_harness()`` MUST be called FIRST in the app entrypoint, before any
read. ``verify_prod_path`` asserts that, and asserts the tier decision below
stays visible HERE rather than disappearing into a helper.

Reads go through the control-points API directly — there is no FireWeave alias
to learn, and no codemod to translate it back out (ADR-022). They never raise:
every failure resolves to the default you passed, with the reason recorded on
the ``Decision`` (spec/control-points.md "Return discipline"). Swap
``get_boolean_value`` for ``get_boolean_details`` — same arguments — to see it::

    # @fireweave-controlpoint <feature-slug>
    if fw_control_points().get_boolean_value(
        "<feature-slug>", False, EvaluationContext(targeting_key=user.id)
    ):
        ...

``context`` is a typed ``EvaluationContext``, NOT a plain dict — the SDK reads
``.targeting_key`` off it, so a dict raises ``AttributeError`` out of what
spec/control-points.md requires to be a never-throwing read path.

``default`` MUST be ``False`` at every call site (RAMP-1): the ramp turns a
feature on, the default never does. To dogfood ON locally, seed the key in
``make_dev_provider()``'s ``local["control_points"]`` — never by passing ``True``
here, because that same ``True`` is what prod serves when the key is missing.

Always pass a ``targeting_key``; a percentage ramp buckets on it. Omit it and the
evaluation reports ``InvalidContext`` and you get your default. Pass a CONSTANT
one and every caller hashes into a single bucket, which makes the ramp
meaningless while looking healthy (spec/control-points.md "Context").

Observability is NOT wired here. FireWeave does not take responsibility for
wiring an observability SDK into an app that has not chosen one.
"""

from __future__ import annotations

from .fw_providers import (
    get_fw_client,
    is_prod,
    make_connected_vendor_provider,
    make_dev_provider,
)
# ``fw_tracker.py`` stays on disk as the committed stamp record — ``reconcile``
# and the dev-checklist gates read it from the repo, so it needs no import here.

_ready = False


def init_fw_harness() -> None:
    """Idempotent boot — call FIRST in the app entrypoint, before any read."""
    global _ready
    if _ready:
        return
    _ready = True

    if is_prod():
        make_connected_vendor_provider()
    else:
        make_dev_provider()


def fw_control_points():
    """Control points. ``fw_control_points().get_boolean_value(key, False, ctx)``."""
    return get_fw_client().control_points
