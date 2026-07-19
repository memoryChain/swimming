# SpeedSwimming Action Sampling Reference

Project root: the current workspace.

This document is the acceptance contract for external humanoid actions. Do not skip its numeric checks because a short viewport preview looks acceptable.

## Current Project Paths

- Runtime target model: `assets/race/models/UserSwimmer0621_2.glb`
- Public sampled-action index and shared types: `assets/scripts/character/SampledActionMotionCurve.ts`
- Per-action sampled curves: `assets/race/sampled-actions/<action_id>.json`
- Runtime pose applier: `assets/scripts/character/FreestylePoseController.ts`
- Debug integration: `assets/scripts/app/ModelDebugFlowController.ts`
- Resource definitions: `assets/scripts/core/ResourcePaths.ts`
- Batch sampler and retargeter: project-specific scripts under `tools/` when required
- Raw actions: `tools/mixamo_raw/`
- Temporary retargeted actions: `tools/retargeted_actions/`

Keep raw FBXs, Blender sources, temporary GLBs, reports, and screenshots outside `assets/`. Only runtime assets belong under `assets/`.

## Preflight Rig Audit

Inspect both armatures before changing code:

1. Print armature object world matrix, rotation, and scale.
2. Print source FPS and each action's inclusive `frame_start`/`frame_end`.
3. Print required bone names and parent chains.
4. Inspect rest matrices in armature/world space.
5. Confirm which target side is physically left/right from rest-head world X positions; names alone are not enough.
6. Record source and target rest-ground height from both feet and toes.

The current Mixamo imports may have armature rotation X = 90 degrees and scale = 0.01. Their bone-local Y-up is not the target GLB's world orientation. This is why local quaternion copying is forbidden.

Identify armatures by bone signatures:

- target: contains `Root` and `Hip`;
- source: contains `mixamorig:Hips`.

Do not rely only on object names. Hidden remnants can reuse or suffix names.

## Scene Hygiene

`bpy.ops.object.select_all()` plus delete can miss hidden objects. Before each batch import, remove scene datablocks deterministically:

```python
for obj in list(bpy.data.objects):
    bpy.data.objects.remove(obj, do_unlink=True)
for action in list(bpy.data.actions):
    bpy.data.actions.remove(action)
for armature in list(bpy.data.armatures):
    bpy.data.armatures.remove(armature)
for mesh in list(bpy.data.meshes):
    bpy.data.meshes.remove(mesh)
```

Only remove datablocks in the dedicated temporary sampling scene. Save or confirm any user-authored `.blend` before large edits.

## Retarget Contract

Do not assume that one rest-basis matrix multiplication order works for every pair of humanoid rigs. Full orientation transfer can preserve incompatible source bone roll and turn a recognizable action into crossed arms or a twisted body even when the names map correctly.

For the current swimmer/Mixamo pair, retarget mapped bones hierarchically from parent to child using world-space bone directions:

```text
sourceDirection = normalize(sourcePoseTailWorld - sourcePoseHeadWorld)
targetDirection = normalize(targetPoseTailWorld - targetPoseHeadWorld)
swing = rotationFromTo(targetDirection, sourceDirection)
desiredTargetWorldRotation = swing * currentTargetWorldRotation
```

Convert the desired world rotation back to the target armature/parent space before assignment. This transfers the visible bone swing while preserving the target rig's own roll basis. Transfer twist separately only when the action visibly needs it and the twist has been validated against the source.

Do not automatically align Mixamo shoulder bones to the target clavicles. For this swimmer, preserve `L_Clavicle` and `R_Clavicle` at their target base rotations and begin visible arm-direction transfer at `L_Upperarm` / `R_Upperarm`. This keeps the normal shoulder width, slope, and armpit silhouette. Only animate clavicles after a separate shoulder-line comparison proves that the source motion requires it.

After each frame, recompute direction error for every mapped bone. The current Waving acceptance target is a maximum mapped direction error effectively equal to 0 degrees.

Expected humanoid mapping currently contains 22 bones. Treat a lower mapped count as failure unless the action intentionally uses a documented reduced rig.

### Root and Hip

- Map `mixamorig:Hips` to target `Hip`, not target `Root`.
- For ordinary standing/dance actions, target `Root` remains at identity/stable rotation.
- Transfer source hips displacement in world space to target `Hip.location`.
- Scale translation by a target/source body or leg-length ratio.
- Transfer full root orientation only for a separately reviewed action that truly requires it.

A character whose complete body axis rocks because source hips orientation was assigned to target `Root` fails validation.

### Foot Contact and Grounding

For each source frame, measure minimum world Z across:

- `LeftFoot`, `LeftToeBase`;
- `RightFoot`, `RightToeBase`.

Compare against the source rest-ground height. If either source foot is in ground contact, vertically correct target `Hip` so the corresponding target foot/toe minimum matches target rest ground. Preserve horizontal hip motion. Do not ground frames whose source feet are genuinely airborne.

Report:

- source grounded-frame count;
- target grounded-frame count;
- grounded/airborne classification mismatches;
- maximum vertical correction;
- worst penetration and worst unintended hover.

Use 0.001 target units as the default grounded tolerance unless model scale clearly requires a documented alternative.

## Sampling Contract

Sample every integer source frame at the source rate, normally 30 fps:

```text
sampleCount = frame_end - frame_start + 1
```

For a batch:

```text
totalSampleCount = sum(each inclusive action frame count)
```

Never force unrelated actions to 25 frames or another universal sample count. Runtime duration must derive from source FPS and sample count. Rotation samples and `hipTranslation` samples must have identical counts.

Generated arrays must contain only finite values. Reject NaN and Infinity before writing TypeScript.

Keep generated action data split by action. `SampledActionMotionCurve.ts` is the stable public index/type module and must not contain the large sample arrays. Store each action in `assets/race/sampled-actions/<action_id>.json`; re-sampling an existing action should change only its own file unless the action roster or shared API also changes. Update `SAMPLED_ACTION_IDS` and let `SampledActionLoader` load the JSON through the race bundle.

### Runtime Pose Semantics

Do not reuse one pose application helper for different data meanings:

- `DivePrepPoseCurve` stores rotations relative to the captured base pose and must apply `baseRotation * sampledOffset`.
- `SampledActionMotionCurve` stores absolute local rotations from the exported GLB and must interpolate `baseRotation -> sampledAbsolute`.

Use separate TypeScript methods and document the meaning beside each method. Adding a debug action must not change the implementation of an existing race pose helper or state transition.

### Promoting an Approved Action

When the user approves a sampled action for a production presentation state:

- update only the owning pose state, such as `ShowcaseStanding`;
- advance the action phase only while that state is active;
- on transition to `DiveReady`, capture the current presentation pose, build a clean Dive Prep target from the base pose, and blend the two snapshots;
- stop presentation-action updates immediately after leaving the presentation state;
- verify every player/AI entry point that selects that state, plus the following Dive Ready and Dive Flight states.

## Rotation Continuity Check

Normalize adjacent quaternions and compare them with the absolute dot product so `q` and `-q` are treated as the same orientation:

```text
angle = 2 * acos(clamp(abs(dot(q0, q1)), 0, 1))
```

Report the maximum adjacent-frame angle per mapped bone and investigate abrupt outliers. Do not automatically smooth them away: first determine whether they exist in the source or were introduced during basis conversion/Euler conversion.

## Left/Right and Hand-Crossing Check

Hand crossing by itself is not a failure; some source choreography intentionally crosses arms. Compare source and retargeted ordering frame by frame.

After putting both measurements into a consistent character-facing coordinate basis:

```text
sourceOrder = sourceLeftHandX > sourceRightHandX
targetOrder = targetLeftHandX > targetRightHandX
mismatch = sourceOrder != targetOrder
```

Count mismatches and list their frame ranges. Any unexplained mismatch is a hard failure.

Also compare hand, forearm, and upper-arm direction vectors from front and three-quarter views. This catches a bad rest-basis multiplication even when the hands have not yet crossed.

Known interpretation examples from the current action batch:

- `Waving`: 143/143 ordering mismatches indicated the old formula was wrong; the correct formula produced 0/143.
- `Twist Dance`: approximately 10 crossing frames occur in both source and target and are intentional.
- `Arm Stretching`: the source itself contains extensive crossing; preserve it rather than forcibly separating the hands.

The acceptance metric is source/target mismatch, not raw crossing-frame count.

## Mandatory Blender Validation Gate

Emit a machine-readable or clearly tabulated row per action containing:

| Check | Pass condition |
| --- | --- |
| Frame count | Equals `frame_end - frame_start + 1` |
| Bone mapping | 22 expected mapped bones, no unexplained required bone missing |
| Root stability | Maximum target `Root` rotation is 0 degrees for ordinary standing/dance actions, or explicitly justified |
| Hip samples | One finite translation sample per rotation frame |
| Ground contact | Source/target contact classifications agree within 0.001-unit tolerance |
| Continuity | No unexplained adjacent quaternion jump |
| Bone directions | No unexplained source/target mapped direction error |
| Shoulder preservation | Preserved clavicle extra rotation is 0 degrees; shoulder width and slope match the normal-model reference |
| Left/right | Zero unexplained source/target ordering mismatches |
| Numeric safety | Zero NaN/Infinity values |
| Race regression | Showcase standing, dive-ready crouch, dive flight, and freestyle remain correct |

Do not proceed to Cocos if a row fails. In addition, render at least five evenly distributed keyframes with the source skeleton and target character shown in the same facing convention. The action silhouette must agree at every checked frame. Fix the retarget or sampling stage and rerun before generating Cocos data.

## Blender MCP Execution

Use Blender MCP first. When a project-specific script is required, resolve it from the current workspace's `tools/` directory and ensure its entry point executes. If it produces no logs or refreshed output, verify `main()` actually ran before diagnosing animation data.

## TypeScript Gate

Run exactly from the project root:

```powershell
npx.cmd --yes --package typescript@5.4.5 tsc --noEmit --ignoreDeprecations 5.0 --skipLibCheck
```

The version is pinned because the project uses `moduleResolution=node10`.

## Debug Model Acceptance

Create one character per action; do not reuse one character and switch its action. Arrange all action characters in a horizontal row with enough spacing that limbs do not visually overlap.

When the selected action changes:

1. keep all characters present;
2. move/aim the camera at the character performing that action;
3. frame the whole body with sufficient margin for hands and feet;
4. preserve a consistent facing direction for comparison.

Inspect at least front, side, and three-quarter views where practical. Verify:

- whole-body axis is stable;
- feet contact the ground when the source does;
- airborne phases remain airborne;
- shoulders, elbows, wrists, and hands are on the correct sides;
- source-intended crossings remain, while retarget-introduced crossings do not;
- source asymmetry is preserved;
- duration and playback speed match the source clip.

Only after the numeric gate and this visual gate pass should the action be presented for user approval.

## Common Failure Modes

- **Every action has the same number of frames**: fixed-count resampling is still active. Sample inclusive source frames.
- **The public sampled-action file becomes huge**: the generator has regressed to concatenating every clip. Keep only the public API/index there and restore one generated data file per action.
- **Entire character axis wobbles**: source hips orientation was probably mapped to target `Root` or object-space conversion is wrong.
- **Feet slide, penetrate, or float**: hip translation was discarded, scale ratio is wrong, or contact-aware grounding was not applied.
- **Hands look reversed/cross constantly**: check multiplication order and source/target left-right ordering before adding offsets.
- **Matrix formulas alternately create horizontal arms or crossed arms**: source and target roll bases are incompatible; use hierarchical swing/direction retargeting and validate multiple keyframes.
- **Only some clips cross hands**: measure the source; the crossing may be intentional choreography.
- **Results change between batch runs**: hidden objects/actions survived scene cleanup, or rigs were selected by unstable names.
- **Cocos pose differs from Blender**: verify quaternion component/order conversion, parent basis, and that `hipTranslation` is applied by `FreestylePoseController`.
- **Normal race and debug poses collapse together**: a shared base-relative pose helper was probably changed to absolute-rotation semantics. Restore `base * offset` and isolate imported debug actions in a separate method.
- **Action is sideways/upside down**: fix armature/object orientation and retarget basis; avoid collections of per-bone compensating hacks.
