"""fw_tracker.py — active rollout change stamps for the PYTHON surface.

``/fireweave:initialise`` scaffolds this empty. Per the dev loop, each feature
change appends its ``stmp_<ULID>`` id here (the same id written to the manifest
``change.stampId``) so ``reconcile`` and the dev-checklist gates can see the
stamp in the committed tree.
"""

from __future__ import annotations

FW_STAMPS: list[str] = []
