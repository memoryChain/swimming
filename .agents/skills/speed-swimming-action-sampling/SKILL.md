---
name: speed-swimming-action-sampling
description: Retarget, validate, and sample humanoid actions and normalize new T-pose characters for the SpeedSwimming Cocos Creator project. Use when importing or replacing a rigged swimmer, sharing one canonical action set across characters, adding Mixamo or other FBX clips, diagnosing mirrored hands, crossed arms, shoulder deformation, root-axis wobble, foot hover or bad ground contact, generating sampled curves, or validating the multi-character debug-model preview.
---

# SpeedSwimming Action Sampling

Use this skill in the current SpeedSwimming checkout whenever an external humanoid action is sampled onto the runtime swimmer.

Windows／macOS 共用此文件。项目路径、Blender 启动和同步方式见 [仓库技能说明](../../README.md)。

Read [references/speed-swimming.md](references/speed-swimming.md) completely before editing scripts or assets. Its retarget formula, validation thresholds, and current project paths are part of this workflow.

When importing or replacing a T-pose character, also read [references/tpose-character-import.md](references/tpose-character-import.md) completely. It records the canonical-rig reuse contract, rejected normalization approaches, action-sharing rules, foot-contact checks, and Cocos reimport checks learned from the MuscleMan2 replacement.

## Hard Rule

Do not generate or approve the Cocos motion curve until the Blender retarget validation gate passes. A result that merely looks plausible in one frame is not sufficient.

Do not decide that two rigs are action-compatible from bone names, hierarchy, or a visually similar T pose alone. Compare their rest matrices, local bases, bone directions, and deformation under high-risk actions.

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

## Shared T-Pose Character Import

1. Preserve the downloaded GLB and create a working copy plus an audit `.blend` under `tools/`.
2. Compare the new rig with the canonical T-pose armature numerically. Report bone-set, hierarchy, local-basis, direction, joint-position, scale, and rest-sole differences.
3. If same-named vertex groups already fit the canonical armature, prefer rebinding the new mesh to the validated canonical armature over editing every raw bone or exporting a full per-character action set.
4. Keep the new mesh, material, texture, and weights; replace only the armature target and remove the raw armature from the runtime export.
5. Validate all shared actions in Blender, including Action Slot assignment in Blender 5.x. Inspect shoulders, forearms, palms, torso crossings, and mesh-level sole contact.
6. Point canonicalized characters to the shared rig-profile action directory. Do not create a complete duplicate action JSON directory per character by default.
7. After replacing a runtime GLB, verify that Cocos Asset Database actually reimported the mesh and embedded images. Browser reload and TypeScript hot reload do not refresh stale model subassets.

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
- Treat full-rig pivot fitting, automatic symmetry edits, weight transfer, and foot-geometry fitting as experiments, not improvements. Save each candidate separately, measure it against the clean normalized source, and reject it if any high-risk action regresses.
- Keep rig-axis failures separate from geometry contact differences. A flipped palm or forearm is a hard basis failure; a small sole-height difference on an otherwise canonical rig is a mesh/contact issue that must be measured and either corrected compactly or reported explicitly.

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
- rest-pose left/right sole heights plus mesh-level sole-height skew over high-risk action frames;
- confirmation that the runtime GLB and Cocos imported subassets match the intended source revision.

Any unexplained left/right mismatch, visible keyframe silhouette mismatch, non-finite value, missing required bone, fixed-count resampling, or unstable root is a failure—not a warning.

## TypeScript Validation

After TypeScript or Cocos runtime edits, run exactly:

```powershell
npx.cmd --yes --package typescript@5.4.5 tsc --noEmit --ignoreDeprecations 5.0 --skipLibCheck
```

macOS 使用同一命令与参数，将 `npx.cmd` 改为 `npx`。

If Blender script execution reports no output, verify that `main()` ran. With Blender MCP, execute scripts with `__name__ = '__main__'`.
