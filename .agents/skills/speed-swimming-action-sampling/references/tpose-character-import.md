# T-Pose Character Import and Shared-Action Contract

Use this reference when adding or replacing a T-pose humanoid in SpeedSwimming. It converts the MuscleMan2 import findings into a repeatable process for future characters.

## Objective

Normalize each compatible character onto one validated canonical T-pose armature, then reuse one shared set of base-relative action curves. Do not solve a bind-pose mismatch with per-action offsets or a complete action-data copy for every character.

The accepted MuscleMan2 source was preserved as `tools/MuscleMan2_Normalized.blend`. Treat accepted normalized sources as immutable baselines and save experiments as separate `.blend` variants.

The current shipped roster intentionally contains only `assets/race/models/MuscleMan.glb`. Player, AI, preparation preview, pose preview, and Debug Model all resolve to the `muscleMan` variant. The only shipped external action data lives under `assets/race/model-actions/tPose`; the legacy `assets/race/sampled-actions`, per-character action directories, old swimmers, Woman, Diver, Gundam, and their color masks were removed. When adding a character, normalize it to the canonical T-pose contract first and point it at this shared profile. Do not restore a legacy model or create a private full action directory merely to make an incompatible raw rig appear functional.

## Preserve and Audit the Source

1. Never overwrite the only downloaded GLB. Copy it under `tools/`, record its hash, and save an audit `.blend` before large edits.
2. Keep `.blend`, validation reports, preview renders, and temporary exports under `tools/`. Put only final runtime assets under the project's runtime asset directory.
3. Record:
   - skinned mesh, material, texture, vertex, face, and bone counts;
   - armature and mesh object transforms;
   - bone names, parent chains, rest heads/tails, local rest matrices, and bone directions;
   - body dimensions and joint-position deltas against the canonical model;
   - mesh-level left/right sole minimum height in rest pose.
4. Verify copied and exported files by hash or by reopening them. Preserve the runtime asset's top-level Cocos UUID when replacing it.

The MuscleMan2 audit had one skinned mesh, one material, an embedded 512x512 base-color texture, 2080 vertices, 3006 faces, and 41 bones. Its names and hierarchy matched the old MuscleMan, but its maximum local-basis mismatch was about 49.52 degrees and its maximum bone-direction mismatch was about 19.02 degrees. `L_Foot`, `R_Foot`, `L_Forearm`, and `L_Hand` were among the critical mismatches. Those differences recreated the flipped forearm, palm, and foot failures when shared curves were applied to the raw rig.

Names and hierarchy prove correspondence, not animation compatibility.

## Compatibility Decision

Compare every corresponding bone in armature space:

- rest head and tail;
- normalized direction;
- local basis or rest rotation matrix;
- parent-relative transform;
- deform flag and vertex-group coverage.

Use a shared action profile only after the character's effective runtime bases match the canonical profile. A visible T pose is insufficient: two T poses can have different bone roll and parent-relative axes.

Distinguish these failure classes:

- **Basis failure:** palm, forearm, foot, or an entire limb flips or folds. Fix the rig normalization.
- **Retarget failure:** source and target silhouettes or left/right ordering disagree. Fix retargeting or sampling.
- **Geometry/contact difference:** bones behave correctly, but different sole shapes produce small ground offsets. Measure the mesh and use a compact contact correction if required.
- **Source asymmetry:** the raw mesh or weights are already asymmetric. Prove this in rest pose before editing the skeleton.

## Preferred Normalization

When the new mesh already has compatible same-named vertex groups and its proportions are close to the canonical body:

1. Import the new GLB and the already validated canonical armature into a clean Blender scene.
2. Preserve the new mesh, material, texture, UVs, vertex groups, and weights.
3. Point the new mesh's Armature modifier to the canonical armature.
4. Parent the mesh to the canonical armature while preserving the intended world transform.
5. Normalize object transforms deliberately and verify that mesh and armature remain aligned.
6. Remove the new raw armature from the runtime export.
7. Export only the canonical armature, rebound mesh, required material, and embedded or linked textures.

This was more reliable for MuscleMan2 than modifying all raw bones. The new and old bodies differed by roughly 1.6% in dimensions and had only small joint-position offsets, so canonical-armature reuse preserved the new appearance while restoring compatible arm and foot axes.

When proportions or approved joint centers differ enough that canonical-armature
reuse would move deformation pivots, use the canonical-axis normalization tool:

`tools/normalize-character-to-canonical-rig.py`

It preserves every target joint head, mesh vertex, vertex group, and weight,
disconnects edit-bone display tails, and replaces only the armature-space rest
orientation of each same-named bone with the accepted canonical orientation.
The exported glTF local rotations must then match the canonical profile within
0.1 degrees. Reject the candidate unless joint-head movement, mesh-vertex
movement, and changed vertex-weight rows are all exactly zero. This pattern was
validated on LowPolyHuman2: all 41 bones were present, exported local-basis
error was about 0.00018 degrees, and mesh, weights, joint heads, UVs, materials,
and the user-approved elbow pivots were unchanged.

Different thigh/calf proportions can still produce support-foot height drift
even after the axes are canonical. Do not solve that by duplicating a complete
action directory. Shared samples carry a `groundedFeet` choreography mask
measured from the original source FBX. A grounded foot targets zero height on
the loaded character's own rest contact plane; do not reconstruct source
support by replaying the retargeted base-relative curve on a reference rig,
because axis/translation interpretation errors can falsely classify planted
frames as airborne. The runtime applies one generic Hip alignment and two-bone
leg IK using the loaded character's own rest contact plane and segment lengths.
Differently proportioned characters therefore converge to the same contact
intent without inheriting reference-character foot heights.

## Rejected or High-Risk Approaches

Do not apply these globally without an A/B validation report:

- copying or rotating every raw bone to resemble one action;
- moving canonical pivots to all new raw joint heads while preserving old axes;
- forcing joint centers to be symmetric;
- transferring old lower-body weights with Data Transfer;
- fitting new foot geometry to the old foot's local bounding box;
- adding per-action shoulder, forearm, wrist, or foot offsets;
- changing shared runtime pose code to compensate for one model.

The canonical-axis tool above is not the rejected "move canonical pivots"
experiment: it never moves the target pivots and never preserves incompatible
raw axes. The generic contact solver is also not a one-model runtime
compensation: it consumes shared action metadata and contains no model IDs or
per-character curves.

These experiments can make one pose look better while mutating shoulders, introducing body asymmetry, or worsening dance-foot skew. Keep each experiment in a separate file, compare it against the accepted clean normalized source, and revert the whole candidate when it regresses.

Do not reshape shoulders to make an action pass. Normalize the rig once, then keep source choreography in the action.

## Shared Action Architecture

The canonical T-pose profile currently lives under `assets/race/model-actions/tPose` and contains the shared emote set plus the breaststroke/tread-water curve. Canonicalized characters should reference this directory instead of owning a complete `model-actions/<character>` copy.

The shared curves use:

- base-relative local bone rotations;
- base-relative normalized hip translation.

This only works when every participating character uses the same effective local bone bases. If a raw rig is incompatible, do not silently fall back to generic curves while its profile is loading; that previously exposed flipped hands in preview.

Audit static and programmatic poses separately from the emote roster. `DivePrepPoseCurve`, flip-turn key poses, showcase transitions, and procedural race poses may use a different data meaning even when the 19 shared emotes are correct. A static pose captured relative to the old arms-down swimmer base must not be multiplied onto a canonical T-pose base. Retarget it once into a compact rig-profile pose and let all basis-compatible characters share that pose.

While a required rig-profile pose is loading, hold the captured base pose instead of falling back to an incompatible default. Keep the original default for legacy characters that do not select the T-pose profile.

Do not duplicate all curves for small geometry-specific foot differences. Prefer, in order:

1. accept a measured difference that is below the documented visual/contact tolerance;
2. add compact per-character contact or root-height metadata;
3. use a targeted per-action contact correction only when the source choreography requires it;
4. create a separate complete action profile only when the skeleton genuinely cannot be normalized to the canonical bases.

For canonicalized SpeedSwimming humanoids, the default path is now shared
contact metadata plus the generic runtime two-bone solver. A per-character
action profile is a last-resort exception and requires proof that
canonical-axis normalization cannot preserve the model.

Removing a redundant MuscleMan action directory saved roughly 4.3 MB. This matters for the WeChat Mini Game target.

## Blender Action Validation

Load every shared action onto the candidate canonical armature and evaluate all integer samples or keyframes. Blender 5.x Actions can use slots: assigning `animation_data.action` alone may leave the rig static. Also assign the compatible slot, for example:

```python
armature.animation_data_create()
armature.animation_data.action = action
if action.slots:
    armature.animation_data.action_slot = action.slots[0]
```

For every action, report:

- finite rotation and translation samples;
- expected sample count;
- local-basis difference from the canonical armature;
- root and hip behavior;
- left/right hand ordering;
- upper-arm, forearm, hand, thigh, shin, and foot direction;
- shoulder height, width, and silhouette;
- mesh-level left/right sole minimum Z and support-foot classification.

Always inspect high-risk actions including:

- Waving;
- Arm Stretching;
- Chicken Dance;
- Twist Dance;
- Dancing Twerk;
- Angry;
- YMCA;
- Clapping;
- breaststroke or tread-water.
- Dive Prep, including the transition from showcase standing and into dive flight.

Check front, side, and three-quarter views. In particular:

- verify torso rotation when choreography crosses the chest;
- verify that palms do not invert at the forearm-to-hand transition;
- verify that the clavicle and shoulder mass do not become asymmetric;
- verify both support feet against the ground plane using mesh vertices, not only foot-bone nodes.

The accepted MuscleMan2 candidate reached 0-degree canonical basis mismatch and finite data for all 19 shared emotes. Some dance frames still differed from the old mesh by about 7.79 mm in contact height and about 9.34 mm in two-foot skew because its sole geometry differed. Treat values above the main action workflow's 0.001-unit grounding tolerance as an explicit QA failure or documented debt; never label the feet perfect from rest-pose symmetry alone.

The later Dive Prep audit exposed the remaining old-base dependency: applying the legacy arms-down offset directly to the canonical T-pose rig produced about 59-62 degrees of upper-arm direction error, 70-82 degrees of forearm error, and 54-58 degrees of hand error. Direction-retarget the complete static pose in Blender, then validate the actual palm surface and thumb side from front, side, and three-quarter views. A 0-degree hand-bone direction error or matching source hand-bone X axis does not prove that the visible palm faces correctly because source and target hand geometry can have different bind-space roll. When a palm must flip from outward to inward, remember that the halfway state faces the character forward; do not accept that intermediate orientation. Preserve the shoulder, elbow, wrist, and hand-direction targets, and distribute the required axial roll between `Forearm` and `Hand` rather than forcing the full correction onto one bone. The corrected shared T-pose Dive Prep keeps 0-degree hand-direction error while splitting the inward-palm flip across forearm pronation and hand roll; it can be shared by MuscleMan and Woman because their 41 effective base rotations match the canonical profile at 0 degrees.

For a user-approved one-sided correction, mirror the edited `Forearm` and `Hand` with Blender's Pose Copy/Paste Flipped, then measure the visible mesh rather than assuming the result is world-space symmetric. Mirrored local rotations can still produce different hand heights when clavicle rest positions, upper-arm lengths, weights, or shoulder geometry are asymmetric. Do not move disconnected bone heads, edit the rest pose, or scale bones merely to level the hands because the runtime sample stores rotations only. Correct any excessive residual height with the smallest acceptable parent-chain rotation and recheck the shoulder silhouette. In the accepted MuscleMan Dive Prep, mirroring the right forearm and hand left about 31 mm of visible hand-center skew; an 8.73-degree left-clavicle swing reduced the center skew to about 10 mm and the mesh-minimum skew to about 13 mm while keeping wrist-chain gaps below 0.01 mm. Treat these measurements as an example of the validation method, not a universal symmetry target.

## Cocos Asset Database Reimport Gate

Overwriting a GLB on disk does not prove Cocos imported the new subassets. In the MuscleMan2 replacement, TypeScript hot reload and shared-action logs were current while the preview still rendered the old blue outfit and old mesh. The source GLB had 3006 faces, but the stale imported metadata still described the prior 3032-face mesh.

After replacing a GLB:

1. Keep the existing top-level `.meta` and UUID unless a deliberate migration is required.
2. Trigger an explicit reimport in Cocos Creator when the file watcher does not refresh it.
3. Compare imported mesh name and face count with the audited source.
4. Compare embedded image names, dimensions, and material texture bindings.
5. Reopen the debug model and preparation screen after reimport.
6. Do not claim visual validation from a browser reload alone.

Useful runtime logs should state the selected character variant, action-profile path, and loaded action counts. A canonicalized MuscleMan should load the shared T-pose profile rather than a `model-actions/muscleMan` folder.

## Final Acceptance Checklist

- Downloaded source and accepted normalized `.blend` are preserved.
- Runtime export contains the intended mesh and canonical armature only.
- Bone names, hierarchy, local bases, and deformation are canonical-compatible.
- Rest-pose soles and all high-risk actions were measured.
- No flipped palm, forearm, foot, shoulder mutation, or unexplained left/right asymmetry remains.
- Shared action profile loads without a full per-character action copy.
- Geometry-specific contact differences are within tolerance or have an explicit compact correction.
- Cocos Asset Database imported the current GLB and texture subassets.
- Debug model, preparation screen, tread-water, and race transitions were visually checked.
- TypeScript validation passes after any runtime-code change.
