---
name: speed-swimming-action-sampling
description: Retarget, validate, and sample imported FBX humanoid actions for the SpeedSwimming Cocos Creator project. Use when adding Mixamo or other FBX motion clips, diagnosing mirrored or crossed arms, root-axis wobble, foot sliding or bad ground contact, generating sampled TypeScript curves, or assembling the multi-character debug-model preview.
---

# SpeedSwimming Action Sampling

Use this skill for `F:\myworkspace\cocosProjects\SpeedSwimming` whenever an external humanoid action is sampled onto the runtime swimmer.

Read [references/speed-swimming.md](references/speed-swimming.md) completely before editing scripts or assets. Its retarget formula, validation thresholds, and current project paths are part of this workflow.

## Hard Rule

Do not generate or approve the Cocos motion curve until the Blender retarget validation gate passes. A result that merely looks plausible in one frame is not sufficient.

## Core Workflow

1. Archive source FBXs under `tools/mixamo_raw/`. Keep raw FBX, `.blend`, previews, and temporary GLBs outside `assets/`.
2. Audit source and target armatures before retargeting: object transforms, up axis, rest matrices, bone hierarchy, actual left/right sides, source FPS, and inclusive frame ranges.
3. Retarget with `tools/retarget-mixamo-swimming.py`. Identify rigs by required bone sets, not fragile object-name prefixes.
4. Run the complete Blender validation gate: mapping coverage, root stability, hip translation, foot contact, quaternion continuity, left/right preservation, finite values, and frame counts.
5. Sample every integer source frame, inclusive, with `tools/sample-debug-actions.py`. Never compress every action to a fixed sample count.
6. Generate the public index and shared types in `assets/scripts/character/SampledActionMotionCurve.ts`, and write each action's samples to its own `assets/scripts/character/sampled-actions/<action_id>.ts` file. Include one hip-translation sample for every rotation sample.
7. Run the pinned TypeScript check from this skill and fix failures.
8. Put every action on its own character in the debug model. Arrange the characters horizontally with generous spacing; action selection moves the camera to face the selected character instead of switching one shared character.
9. Verify in Cocos from useful front/side/three-quarter views: stable body axis, correct left/right limbs, intentional versus accidental hand crossing, elbows and wrists, grounded feet, and preserved source asymmetry.
10. Keep new actions debug-only until the user approves them. Clean intermediate retargeted GLBs and source-only preview artifacts after verification.

## Non-Negotiable Defaults

- Never copy source local quaternions directly onto a differently oriented target rig. When source and target bone roll differ, prefer hierarchical world-space swing/direction retargeting and preserve the target rig's own roll basis.
- Do not direction-retarget clavicles blindly. Preserve the target clavicle/shoulder base pose unless source shoulder motion is essential and separately validated against a normal-model shoulder reference.
- For ordinary standing/dance clips, map source hips to target `Hip`, not target `Root`. Keep `Root` rotation stable unless full root motion is explicitly required.
- Preserve scaled hip translation and contact-aware vertical grounding. Do not flatten genuinely airborne frames.
- Preserve source left/right asymmetry. Validate source-to-target left/right ordering per frame; raw hand crossing alone is not proof of an error.
- Require generated sample count to equal the sum of every inclusive source frame range.
- Never concatenate all action sample arrays into `SampledActionMotionCurve.ts`. Re-sampling one existing action should rewrite only that action's data file; rewrite the public index only when the action roster or shared API changes.
- Use Blender MCP first for rig inspection, baking, and Blender scene changes. Use command-line Blender only when MCP is unavailable or unsuitable.
- Do not replace the main freestyle race pipeline unless explicitly requested.
- Keep debug-only sampled actions isolated from race pose semantics. Absolute local rotations and base-relative pose offsets must use separate types and application functions.

## Required Checks

The validation report must include, per action:

- inclusive frame range and sample count;
- mapped-bone count and missing bones;
- maximum target `Root` rotation;
- grounded/airborne frame agreement and maximum ground correction;
- maximum adjacent quaternion angular change;
- maximum source/target mapped bone-direction error;
- maximum extra rotation on bones deliberately preserved for shoulder shape;
- source/target left-right hand-order mismatches;
- non-finite value count;
- generated rotation and hip-translation sample counts.
- regression status for showcase standing, dive-ready crouch, dive flight, and freestyle race poses.

Any unexplained left/right mismatch, visible keyframe silhouette mismatch, non-finite value, missing required bone, fixed-count resampling, or unstable root is a failure—not a warning.

## TypeScript Validation

After TypeScript or Cocos runtime edits, run exactly:

```powershell
npx.cmd --yes --package typescript@5.4.5 tsc --noEmit --ignoreDeprecations 5.0 --skipLibCheck
```

If Blender script execution reports no output, verify that `main()` ran. With Blender MCP, execute scripts with `__name__ = '__main__'`.
