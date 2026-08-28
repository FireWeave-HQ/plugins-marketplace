// Package fireweave — fw_tracker.go: active rollout change stamps for the GO
// surface.
//
// `/fireweave:initialise` scaffolds this empty. Per the dev loop, each feature
// change appends its `stmp_<ULID>` id here (the same id written to the manifest
// `change.stampId`) so `reconcile` and the dev-checklist gates can see the stamp
// in the committed tree.
//
// This is a DISK artifact, not a runtime import: nothing in the harness reads
// it. `reconcile` and `assert_dev_checklist` read it out of the repo.
package fireweave

// FW_STAMPS is the committed stamp record. Append one id per feature change.
var FW_STAMPS = []string{}
