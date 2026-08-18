package fireweave; // REPLACED at init: `<app base package>.fireweave` — must match FwHarness.

/*
 * FwTracker.java — active rollout change stamps for the JAVA surface.
 *
 * `/fireweave:initialise` scaffolds this empty. Per the dev loop, each feature
 * change appends its `stmp_<ULID>` id here (the same id written to the manifest
 * `change.stampId`) so `reconcile` and the dev-checklist gates can see the
 * stamp in the committed tree.
 */

import java.util.Collections;
import java.util.List;

public final class FwTracker {

    public static final List<String> FW_STAMPS = Collections.emptyList();

    private FwTracker() {
    }
}
