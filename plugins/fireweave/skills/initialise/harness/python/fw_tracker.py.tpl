"""fw_tracker.py — active rollout change stamps for the PYTHON surface.

``/fireweave:initialise`` scaffolds this empty. Per the dev loop, each feature
change appends its ``stmp_<ULID>`` id here (the same id written to the manifest
``change.stampId``) so the boot beacon and ``reconcile`` can see the stamp. The
python deploy SDK (Phase 1b) sends ``FW_STAMPS`` on boot; until then it is
tracked but not transmitted.
"""

from __future__ import annotations

FW_STAMPS: list[str] = []
