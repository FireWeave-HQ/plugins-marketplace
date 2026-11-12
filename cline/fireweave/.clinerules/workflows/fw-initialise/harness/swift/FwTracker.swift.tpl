// FwTracker.swift — active rollout change stamps for the SWIFT surface.
//
// `/fireweave:initialise` scaffolds this empty. Per the dev loop, each feature
// change appends its `stmp_<ULID>` id here (the same id written to the manifest
// `change.stampId`) so `reconcile` and the dev-checklist gates can see the stamp
// in the committed tree.

public enum FwTracker {
  public static let FW_STAMPS: [String] = []
}
