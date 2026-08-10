# Feedback categories

The skill proposes one of these from the session and the user's remarks, then
confirms. This file is data: adding, splitting or renaming a category here
changes the proposal set without touching the skill's flow.

| Key              | Use when                                                                                   |
| ---------------- | ------------------------------------------------------------------------------------------ |
| `rollout-stuck`  | A rollout registered but never ramped, sat at 0%, or stalled mid-ramp.                     |
| `wrong-park`     | A skill PARKed for a reason that does not match the repo's actual state.                   |
| `manifest-drift` | Manifest, code anchors and stamps disagree; `reconcile` contradicts what is on disk.       |
| `auth-bind`      | Login, profile, org match, or repo binding failed or bound the wrong thing.                |
| `flag-provider`  | Flags evaluate to the wrong value, the provider is unreachable, or a ramp has no effect.   |
| `telemetry-gap`  | Metrics, traces or beacons that should have arrived did not.                               |
| `cli-ux`         | The CLI's output, prompts or errors misled the user.                                       |
| `skill-ux`       | The agent asked the wrong thing, over-asked, or was hard to follow.                        |
| `docs-mismatch`  | Documented behaviour differs from actual behaviour.                                        |
| `performance`    | Something worked but was unacceptably slow.                                                |
| `uncategorised`  | Nothing above fits. Preferred over forcing a bad match — a wrong label is worse than none. |

Severity is the user's own read, not the agent's: `low`, `medium`, `high`, `critical`.
