//! fw_tracker.rs — active rollout change stamps for the RUST surface.
//!
//! `/fireweave:initialise` scaffolds this empty. Per the dev loop, each feature
//! change appends its `stmp_<ULID>` id here (the same id written to the manifest
//! `change.stampId`) so `reconcile` and the dev-checklist gates can see the
//! stamp in the committed tree.
//!
//! This is a DISK artifact, not a runtime import: nothing in the harness reads
//! it. `reconcile` and `assert_dev_checklist` read it out of the repo.

/// The committed stamp record. Append one id per feature change.
pub const FW_STAMPS: &[&str] = &[];
