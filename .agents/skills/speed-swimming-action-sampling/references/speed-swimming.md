# SpeedSwimming Action Sampling Reference

Project root: the current SpeedSwimming checkout; all paths below are relative to that root.

This document is the acceptance contract for external humanoid actions. Do not skip its numeric checks because a short viewport preview looks acceptable.

## Current Project Paths

- Runtime target model: `assets/race/models/MuscleMan.glb`
- Canonical runtime action profile: `assets/race/model-actions/tPose`
- Public sampled-action index and shared types: `assets/scripts/character/SampledActionMotionCurve.ts`
- Runtime action JSON: `assets/race/model-actions/tPose/Tpose_<action_id>.json`
- Runtime pose applier: `assets/scripts/character/FreestylePoseController.ts`
- Debug integration: `assets/scripts/app/ModelDebugFlowController.ts`
- Resource definitions: `assets/scripts/core/ResourcePaths.ts`
- Batch sampler: `tools/sample-debug-actions.py`
- Retargeter: `tools/retarget-mixamo-swimming.py`
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

Keep generated action data split by action. `SampledActionMotionCurve.ts` is the stable public index/type module and must not contain the large sample arrays. Store each action in `sampled-actions/<action_id>.ts`; re-sampling an existing action should change only its own file unless the action roster or shared API also changes.

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

Use Blender MCP first. Ensure scripts execute their entry point:

```python
import runpy
from pathlib import Path
project_root = Path(r'<当前任务的项目根目录>')
runpy.run_path(str(project_root / 'tools' / 'retarget-mixamo-swimming.py'), run_name='__main__')
```

执行前用当前 Codex 任务的实际工作目录替换示例路径，不能假定 Blender 的进程工作目录就是项目。`runpy` 会设置正确的 `__file__`，供脚本定位项目根目录。历史脚本的默认目标仍可能是早期角色，运行前核对输入模型与输出位置。

Repeat with `tools/sample-debug-actions.py` for batch sampling. If execution produces no logs or refreshed output, verify `main()` actually ran before diagnosing animation data.

## TypeScript Gate

Run exactly from the project root:

```powershell
npx.cmd --yes --package typescript@5.4.5 tsc --noEmit --ignoreDeprecations 5.0 --skipLibCheck
```

macOS 将 `npx.cmd` 改为 `npx`，保留其余版本和参数。

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

## 领奖台运行时接地

- 领奖台高度取 `AwardsPodiumSurface.ts` 读取的本体网格世界坐标，不混入描边子节点、节点原点或渲染器上一帧包围盒。
- 不再叠加统一的跳台抬高和鞋底补偿。`AwardsPresentation` 把本轮台面高度传入 `Swimmer.presentStanding`；`reset()` 清除领奖接地状态。
- `StandingSoleContact` 在模型绑定姿态下读取原始位置、关节和蒙皮权重，保留每脚 4×4 格最低点，并补充 16 个倾斜方向的鞋边极点，每脚最多 32 点。补充点用于避免踮脚、侧翻时漏掉实际最低鞋边；运行时不遍历全网格，不增加逐帧采样点分配。
- 领奖足部不能直接保留重定向曲线中未经校准的脚踝/脚趾世界旋转：源足骨和目标足骨静止轴向不同，会把平脚拍手变成全程踮脚。源 FBX 逐帧求 `posedWorld * inverse(restWorld)`，换算到模型 Y 向上空间，写入 `footOrientationDeltas`（左足、左趾、右足、右趾）。运行时按 `rootWorld * sourceDelta * targetRestInRoot` 应用在当前角色自己的静止足姿上；源动作的转脚、抬跟和脚趾运动仍保留。四元数插值使用复用临时量，不逐帧复制四组源数组。实际鞋底最低点负责接触，原鞋型的鞋跟/翘头不强制压平。
- `scripts/sample-source-foot-lifts.py`（本技能目录下）从原始 Mixamo FBX 逐整数帧提取足/趾端相对静止面的离地高度，以源髋部静止高度归一化，写入共享 JSON 的 `footLiftHeights`，同时提取上述足部运动增量。先检查全部源文件、帧区间、骨架、有限值以及三个轴的换基误差，再批量写入；输出各动作最大足部倾角和相邻帧转角；既有旋转、髋位移和原 `groundedFeet` 逐值不变。通过 `python scripts/run-blender.py -- --factory-startup --python .agents/skills/speed-swimming-action-sampling/scripts/sample-source-foot-lifts.py -- --write` 生成；省略 `--write` 只校验和输出报告。
- 归一化离地高度 0.003 到 0.012 之间连续释放支撑权重；校正目标包含源动作的正离地高度，而非一律高度零。完全释放的腿保留原姿势，只有实际穿台时向上避障，不能向下吸附。双脚腾空只做必要的向上防穿透，保留跳跃。`dancing_twerk` 原动作确有抬脚，领奖不再全程强制双脚着地。跳台斜面展示仍使用其原接触标记与已确认的斜面朝向策略。
- `tests/standing-sole-contact.test.cjs` 使用实际 GLB、共享动作和本机 Cocos 数学实现，覆盖所有当前角色、14 种领奖动作、三种台高、不同朝向、默认站姿以及重开。测试用完整足部顶点独立复核有限采样点；这是运行时接地近似检查，不替代修改动作采样时的 Blender 重定向验收。
- 必须独立检查脚掌法线跟随源运动增量，不能只断言与未经校准的目标曲线相同。拍手源动作脚掌水平，所有角色应维持各自静止鞋型的脚跟/前掌高度差并落台；另测自由腿不被拉回、抬脚高度保留、不穿台，以及接触阈值两侧骨盆和踝部连续。用实际蒙皮侧视对比确认多余的踮脚消失，不能把“鞋跟高于前掌”的错误结果直接当成保留原动作的证据。
- 运行检查：`npx.cmd --yes --package typescript@5.4.5 -c "node --test tests/standing-sole-contact.test.cjs"`（macOS 使用 `npx`）。显著更换鞋型后还需确认足部顶点识别和采样误差，不能只检查脚踝高度。

## 起跳台斜面适配

- `StartBlockSurface.ts` 在实例合批前提取最大朝上共面踏面，保留世界平面和踏面边界；不要用整台最高点或装饰凸起作为支撑面。`RaceCourseLayout.startBlockSurface()` 按泳道选取对应踏面，缺失时回退原展示逻辑，不跨泳道吸附。
- 展示阶段上身保留原舞蹈姿态，支撑脚掌/脚趾倾斜贴台，用实际鞋底和腿部 IK 匹配高度及边界；不要把“身体直立”理解成“脚掌水平”。只调整 `groundedFeet` 标记的支撑脚，保留抬脚、跳跃。斜面上必须先水平居中再求接触，贴台后平移会产生新的高度误差。调整在骨骼层完成，不改 `platformY`、角色根节点、起跳弹道、成绩或联机数据。
- 展示到准备的快照必须保存和插值 `hipPosition`，只混合旋转会丢失接地后的骨盆偏移。中间帧必须重新求解双脚接触；只抬高骨盆防穿透会让另一只脚悬空。两个阶段共用台面法线，骨盆仅平移、腿部用 IK 衔接，不给上身叠加坡度旋转。
- 脚掌的斜面旋转应从当前模型上方向对齐世界台面法线，不能假定模型始终与世界竖直方向一致，否则外层倾角会被重复叠加。保留原起跳前倾和轨迹；离台保存最后贴台姿势，立即解除外部平面追踪，再向流线型混合，不能把飞行中的脚重新拉回台面。
- `tests/start-block-contact.test.cjs` 使用实际起跳台 GLB（当前主踏面约 11.2°）、全角色完整足部顶点、14 种展示动作与共享准备姿势，检查展示支撑脚接触与腾空动作保留、过渡每帧双脚接触、脚跟与前掌间隙、上身旋转不变、踏面边界、双向站位、外层倾角、离台释放和根轨迹不变性。

### 起跳准备手臂自然下垂

- 用户要求整条手臂明显斜向身体下方、台前沿，掌心朝人物自身。12°/6° 在游戏视角中仍显得竖直，现为上臂相对竖直线向内 28°、前臂 22°，保留轻微屈肘；按比赛前进方向判断内侧，不能把双臂横向交叉。
- 仅校正肩肘腕连线不能确定掌心朝向，直接恢复中性手腕也不能保证掌心朝内。`CharacterHandContact` 在规范 T 姿势绑定时把模型下方换算成左右手的局部掌心轴；求解整臂后绕前臂长轴转动，使掌心朝身体，手腕保持中性随前臂运动。不要单独折手腕、把手指强制世界竖直或锁定手腕高度。Blender MCP 已检查现有骨架与手部网格，规范左右手掌心轴分别约为局部 +X/-X；不规则握拳网格不能单靠 PCA 猜掌心朝向。
- `CharacterHandContact` 同时测量左右上臂、前臂、手部的实际网格范围。起跳台加载时把真实三角形裁到 16 个高度段，缓存 `obstacleBands`。逐段裁剪手臂盒并检查间隙，不能用整座台的 `obstacleMinX/obstacleMaxX` 代替所有高度的台沿，否则地面外突底座会将人物推得过远；旧平面数据没有分段时才回退到全台边界。每次姿势校正只转换一次手臂盒世界顶点，各高度段复用，不做逐帧网格遍历或分配。
- 已确认的整臂角度和掌心朝向保持不变。站位支持向前避障和向后收近，以两只手臂更靠台的一侧为限，包围盒目标留 8mm；实际网格间隙还包含保守包围盒余量，不承诺可见网格精确 8mm。后收随准备过渡渐入，不能留下只前推、不后收的单向校正。
- 防穿透不等于手已伸出台沿。逐浪少女（`CartonSwimmer5`）在无外层前倾时，手部较高，按高度段避障仍可能把手留在台面上方和鞋旁。必须另行测量两只完整手部的世界范围，不裁高度，并要求靠身体的一侧越过主踏面前沿；与台身避障取更严格的站位约束。伸手所需的前移随准备动作渐入，实际防穿透仍立即生效。不能只检查腕骨、手尖或一只手，也不能为了伸出去改变已确认的整臂角度、手腕或骨长。
- 回归要分别断言“完整双手伸出台前沿”和“各高度段手臂不穿台”。短臂手指略高于低侧台沿时，收近程度取到台前沿的距离，不能以其后方更高台面造成的空中距离误判为需要继续后收。包含该角色无外层前倾、双向站位、85%/100%/125% 缩放，并对比实际蒙皮侧视姿势。
- 需要避台时做最小的身体前移，保留上身旋转并优先保留原脚位。前移后按真实腿长检查可达范围，必要时先在踏面边界内微调脚位，再降低骨盆；不能将短腿角色的双脚锁在过远后方、导致腿拉直或身体过度降低。不能拉伸四肢、挪动比赛根节点或破坏脚掌/脚趾贴台。
- 展示舞蹈不受手臂约束；进入准备时渐变上臂、前臂与中性手腕，检查整个过程是否穿台。离台保存最终姿势再过渡到流线型。
- 回归检查整臂倾角、屈肘、无交叉、掌心朝内、中性手腕、逐帧无翻转，以及完整手臂蒙皮顶点防穿透和脚底接触，覆盖全部角色、双向、前倾、85%/100%/125% 尺寸与阶段过渡。掌心检查要用独立核验的骨架轴，不能复用求解器自证。还需检查真实蒙皮侧视姿势，不能只靠方向数值或“手掌方向正确”替代整臂验收。

## 领奖头顶标记

- `Head` 骨心不等于可见头顶。`CharacterHeadBounds` 在加载时从头骨权重至少一半的网格顶点测量头部局部包围盒，涵盖头发、帽子；换模型时清空重建。不要使用全身包围盒，否则举手会把标记推高。
- 结算逐帧投影头部盒八角，取屏幕上沿和水平中心；三角下尖端与上沿保留屏幕间距，不复用隐藏速度文字的布局偏移。保持 `lateUpdate` 逐帧跟随，不能把主角标记降到 30Hz。
- `tests/character-head-bounds.test.cjs` 用现有全部 GLB 的完整头部蒙皮顶点独立核对不同动作、缩放和朝向下的锚点。新增角色需沿用规范骨架和正确头部蒙皮；特殊独立头饰或特殊骨架需要重新验证识别范围。

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
