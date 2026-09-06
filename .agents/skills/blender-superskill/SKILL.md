---
name: blender-superskill
description: Guide Blender MCP asset modeling through disciplined reference-first construction, viewport inspection, critique, iteration, reusable modeling patterns, and optional scripted orchestration. Use when Codex is asked to create, modify, critique, or learn Blender assets, including buildings, props, hard-surface objects, low-poly objects, industrial assets, roofs, pylons, cables, panels, modular kits, scene cleanup, collection organization, reference-image modeling, or Blender workflow notes.
---

# Blender SuperSkill

Windows／macOS 共用此文件。项目路径、Blender 启动和同步方式见 [仓库技能说明](../../README.md)。以下命令从项目根目录运行，macOS 将 `python` 改为 `python3`。

## Prime Directive

If any part is supposed to touch, seat, clamp, bridge, or align to another part, define the exact contact faces/edges/planes first and verify them numerically after the build. A screenshot can help critique silhouette and proportion, but it is not proof that the interface is correct.

When modeling from reference:

0. If the source is a busy scene or the target object is small, first create or extract a focused reference image of the exact asset. Do not model fine details from a tiny object buried in a full-scene image.
1. Inspect the focused reference before every visible modeling step.
2. Before creating geometry, list the asset anatomy and estimate the major proportions as ratios. Do not build from memory.
3. Use Solid viewport shading while modeling and inspecting. Material/color read comes later.
4. State the one thing being built in the current step.
5. State what existing face, edge, socket, beam, or surface it connects to.
6. Build only that step, deriving placement from the anchor instead of eyeballing.
7. Inspect the Blender result from the correct angle, close-up connection views, and six-side orthographic views when parts attach or stack.
8. Compare back to the reference.
9. Iterate that step before adding the next detail.

Do not stack multiple unverified details. Do not substitute a generic primitive for the referenced shape. Do not rely on bevels, smoothing, or decorative objects to hide weak construction.
For low-poly game assets, default to crisp hard edges and flat planar faces. Do not add bevel or weighted-normal modifiers as decoration. Add chamfer geometry only when the reference visibly has a planar cut edge, and keep it narrow, intentional, and inspected from close range.
For repeated construction features, build and inspect one complete module first, then duplicate it from that measured pattern. Do not hand-place many disconnected bars, bolts, rim facets, slats, stairs, posts, rails, or panels one at a time. Do not leave linked duplicates or shared mesh data in final assets; every duplicate must be single-user so Apply Transform and per-object edits work normally.
For contact-critical assets, switch from visual-guess mode into interface-audit mode. Name the parts, name the intended contact surfaces, build to explicit face/edge/plane boundaries, and numerically verify the interface after construction. If a top bar is supposed to run pole-to-pole, check the bar end faces against the clamp or pole contact faces. If a post sits on a base, check post bottom against base top. Do not trust visual closeness when the interface can be measured directly.
For curved/pipe-like continuous parts, build cross-section rings along the path and bridge edge loops between rings. Mitered corners, elbows, bent hoops, handrails, pipes, and curved guardrails must share connected loop topology instead of being assembled from overlapping or touching cube/cylinder chunks.
For parabolic dishes, define the feed/opening direction first. The bowl center is deepest and the rim moves toward the feed; if the rim moves away from the feed the dish is inside-out. Build the shell as rings, not a center triangle fan, wind the bowl faces so normals point toward the feed, and verify from the feed-side viewport before adding rods or horns.
For custom closed meshes with cut pockets, verify normals by face plane before screenshots: back faces point +Y, front faces -Y, right +X, left -X, top +Z, bottom -Z, and pocket lip faces point out of their local side walls. If a face looks missing, check and fix winding before adding cover patches.
Do not add preview cameras while modeling. Use the viewport directly for critique; cameras are presentation helpers, not construction tools.

## Orchestrated Reference Runs

For complex reference-based modeling, especially buildings or hard-surface assets from an image, prefer the bundled orchestrator instead of modeling directly in the main conversation. This is mandatory when the user asks for high reference fidelity, proportion/detail matching, or step discipline, unless they explicitly request a quick manual pass.

If the user wants script-controlled modeling because conversation memory is unreliable, use a deterministic Blender build script pattern instead of freehand MCP actions. The script should be generic and reusable across object types: a small runner owns collection placement, material creation, naming, cleanup, step logging, and validation, while the asset-specific recipe owns only the ordered build functions. Treat the script as the durable memory: every step should be encoded as data or a named function that can be rerun, inspected, and repaired without relying on chat context.

For reusable build scripts:

- Keep the generic runner separate from the object recipe.
- The runner should provide helpers for collection lookup/creation, object linking, material reuse, mesh creation, primitive creation, transforms, contact checks, screenshot/view capture hooks, and final validation.
- The recipe should define an anatomy/proportion block and an ordered step list such as `build_body`, `build_roof`, `build_openings`, `build_details`, and `validate_asset`.
- Rebuild from clean, named outputs when rerun. Remove or replace only objects owned by the current recipe prefix; never delete unrelated scene objects.
- Place generated objects in the user-specified collection through the runner, not through scattered ad hoc code.
- Derive dimensions and placement from constants, bounding boxes, face planes, and named anchors stored in the recipe.
- Log each completed step with created object names, anchors used, inspections required, and known remaining differences.
- Prefer this script pattern when the orchestrator cannot run reliably in the current environment, when the user asks for reusable scripted control, or when the same asset needs repeated repair passes.

Use [scripts/blender_orchestrator.py](scripts/blender_orchestrator.py) to create a deterministic run state and invoke Codex workers one step at a time. The orchestrator owns the anatomy checklist, proportion table, current step, validation errors, repair loop, final review, and run artifacts. The worker Codex instance owns only the current bounded task.

Default command shape:

```powershell
python .agents/skills/blender-superskill/scripts/blender_orchestrator.py --workspace "." run --task "<user task>" --reference "<reference image>"
```

For a staged or inspectable run:

```powershell
python .agents/skills/blender-superskill/scripts/blender_orchestrator.py --workspace "." init --task "<user task>" --reference "<reference image>"
python .agents/skills/blender-superskill/scripts/blender_orchestrator.py --workspace "." prompt latest
python .agents/skills/blender-superskill/scripts/blender_orchestrator.py --workspace "." continue latest
```

When using the orchestrator:

- Do not bypass its plan/build/repair/final-review phases.
- Do not start another orchestrator from inside a worker prompt.
- Treat a blocked run as a real stop: inspect `state.json`, `plan.json`, `step-results/`, and `logs/` before deciding whether to continue manually.
- If a step fails validation because screenshots, inspections, mismatches, or proportion checks are missing, rerun/repair that step before adding new geometry.
- Keep user-facing progress concise; the run directory is the durable memory.

## Operating Loop

- 优化已有游戏场景前，先确认主要游戏相机的位置、朝向、视场和常见运动路径，再按画面占比与持续可见时间安排模型、材质预算。跟随运动员的低机位应优先看台、观众轮廓、泳道与池内材质，不能用池岸近景或编辑器全景代替主视角验收。
- 先区分 Blender 源资产与运行时重建的内容（观众、角色、水面、描边等）；只看源文件缺少这些内容时，不得据此声称游戏画面空旷或水面错误。示意渲染必须明确标为源模型/材质预览，不能冒充运行时截图。
- 有折返、反向跟拍或绕行镜头的资产，必须在相同距离、高度和视场下做正反视角对照。双面显示仅保证面片可见，不能把单向凸面变成双向一致的体积；优先使用前后对称、闭合且法线向外的低面数形状，并数值校验两侧几何与 UV 的对称性。
- 重复排列的浮漂等近景资产还须检查侧视覆盖率：分别量化单颗轴向长度、中心节距和端点间隙。优先移动现有顶点拉长单颗来缩小空隙，避免只靠增加颗数补密度；圆周边数则按近景轮廓决定，不能为预算削成明显尖角后只用纵向透视验收。
- 轴向包围盒接近不等于主体连续：双锥尖端之间即使只留小缝，主体仍可能显得像串珠。需要紧密盘节时用完整端面和等截面柱身，按主要可见高度检查空隙，不能继续拉长尖端来冒充盘身密度。
- 移动端密集重复盘片若在主要视角只贡献细小明暗条纹，先验证低面数连续外壳加重复纹理，避免为不可辨的端面与内部细绳支付几何成本。纹理密度与几何密度独立设置；检查正反纹理一致、近景轮廓损失和远处混叠，再决定是否值得增加真实盘片。不可把纹理假凹槽描述为真实轮廓细节。
- 既有场馆广告优先复用挡板几何、材质与图片身份，用图集和 UV 分配不同设计；入口半板需单独排版，转角重叠区需留出文字安全边距。两面文字以各自观看方向确定 UV，检查四侧及转角，不能只看一面。向合批同步 UV 时用源面的空间位置匹配并逐模块验证覆盖面数，避免仅按整块中心误分配相邻端面。

- Use Blender MCP directly when the user asks to model, critique, arrange, clean, or inspect Blender assets.
- For complex reference-image modeling, start with an orchestrated reference run unless the user explicitly asks to work directly in the main loop.
- For compound scenes, make a close reference crop/sheet for the target asset before touching Blender. Use that reference for silhouette, construction order, and missing-detail critique.
- Hide unrelated objects before judging a model.
- Deselect objects before visual critique when selection outlines obscure the surface.
- Set the viewport to Solid shading with material/color optional only after the form is approved.
- Do not create preview cameras during modeling. Use explicit viewport orientations and screenshots.
- Before blockout, make a short anatomy list: primary masses, connecting parts, supports, repeated details, and optional decorations.
- Before detail, state proportion ratios from the reference: length/height/depth, body-to-pipe, wheel-to-body, roof-to-wall, door-to-face, or whatever matters for the asset.
- Use the right view for the detail: front for facades, top/isometric for roof and top details, side/three-quarter for cables and sockets.
- After major attached assemblies, inspect six sides: front, back, left, right, top, and underside/bottom. This is mandatory for catching hidden gaps, floating supports, and false contact.
- Compare to the reference after each step, not only at the end.
- For every attached part, perform a connection proof before continuing:
  - identify the parent part and named anchor surface
  - calculate the child position from the parent's dimensions, bounding box, or face center
  - allow a tiny intentional overlap or exact surface contact so no daylight gap appears
  - inspect the contact area close-up from a view that can reveal gaps
- For assemblies whose correctness depends on exact seating, add a contact checklist before moving on:
  - list each part-to-part interface that is supposed to touch
  - identify the exact faces, edges, or boundary planes involved
  - measure the signed gap or overlap for that interface
  - keep the interface only if the result is intentional and explicit, not accidental
- Name objects and collections clearly enough that the user can select, move, delete, join, or reuse them.
- Keep temporary cutters, swatches, and preview helpers out of final asset collections unless they are explicitly needed.

## Modeling Rules

- Start with the reference silhouette and proportions before detail.
- Use simple primitives and face-derived anchors, but make the shape match the reference, not the primitive's default form.
- Prefer real construction logic: cut recesses, seat inserts, create plinths, define ports, then route cables.
- Inset details belong to the parent mesh when the reference shows an inward cut. Do not create reveal strips or plaques on top of an uncut parent surface; split or cut the parent face and extrude the inset floor inward. Glowing screens and display glass follow the same rule: cut a shallow pocket into the console/body face first, then seat the dark bed and smaller screen glass inside the opening.
- Build low-poly assets with hard planar edges by default. Do not globally bevel cubes, cylinders, bases, panels, bolts, rims, or trim just to make them look "finished."
- Use chamfers only as modeled planar edge cuts when the reference clearly shows that edge treatment. Avoid bevel modifiers and weighted normals unless they are needed for a specific inspected feature and do not soften the low-poly read.
- Keep cylinders faceted when the reference is faceted. Prefer 8, 10, 12, or 16 visible sides over smoothed/rounded silhouettes for reusable low-poly props.
- For color bands on one continuous low-poly form, especially bollards, cones, pipes, poles, and cylinders, prefer one stepped mesh with per-face material assignment over stacked separate objects. Model top/bottom profile changes as ring extrusions or inward-scaled rings, then paint the relevant face bands by polygon material index.
- Use shallow boolean cuts for clean recessed panels/openings when direct face cutting would make the main mesh messy.
- Build visible inserts as simple cube-clean pieces seated inside cuts.
- Use curves for hoses/cables, with endpoints anchored to actual socket/port positions.
- Stacked pieces, hanging pieces, sockets, feet, posts, columns, and cables must physically seat into their parent. Visual alignment is not enough.
- When making repeated parts, validate the first complete module in close-up before duplicating the rest. Use the same measured dimensions and anchor math for identical rail panels, rim facets, stair units, bolts, vents, slats, fence segments, ladder rungs, and repeating panels so spacing, contact, and proportions stay consistent. Final duplicates must not share mesh datablocks.
- For railings and fences, build a post-to-post panel module with posts, foot plates, and rails as one logical unit, then duplicate/link the panel around the platform. Avoid separate long rail bars that merely pass near posts.
- For chainlink, mesh, and diamond-pattern fence infill, do not hand-place many separate diagonal rods. Build one continuous strip or validated lattice module using bridged edge-loop sections, then duplicate/trim that pattern into the fence opening and seat it into the side/top/bottom supports.
- For fence, gate, railing, ladder, frame, bracket, or support assemblies, define the support system, frame system, and infill/detail system separately. Build the support and frame contact surfaces first, then fit the infill or detail pieces to those measured boundaries. Do not start with the decorative/repeating part and hope the frame catches up.
- For standalone hoop barriers and yellow guardrails, build the bent U/portal as one continuous low-poly form with connected legs, mitered/chamfered corners, collars, plates, and bolts. Do not replace a hoop-style reference with a generic fence panel or disconnected rails.
- When a hoop, pipe, handrail, or bent guardrail changes direction, make adjacent sections from matching profile loops and bridge those edge loops so the curve/corner is real topology. Do not use separate end-capped parts that only overlap at the bend.
- Join only after the shape is approved. During learning, keep functional parts separate; later join them into logical modules.

## When To Load References

- For utility cabinets, batteries, generators, transformers, vents, panels, sockets, cables, and machinery housings, read [hard-surface-props.md](references/hard-surface-props.md).
- For commercial buildings, warehouses, doors, signs, site assets, and building massing, read [buildings.md](references/buildings.md).
- For roof forms, overhangs, dormers, gables, hips, sheds, and warehouse roofs, read [roofs.md](references/roofs.md).
- For pylons, towers, trusses, gantries, and scaffold/lattice structures, read [lattice-structures.md](references/lattice-structures.md).
- For asset organization, Blender collection structure, cleanup, joining, tile lots, and reusable modules, read [collections-and-cleanup.md](references/collections-and-cleanup.md).
- For known bad patterns and what to avoid, read [failure-patterns.md](references/failure-patterns.md).

## Skill Updates

- 固定场馆顶灯先检查运行时是否还叠加逐灯 billboard 眩光；美术重制应同时审计这些节点和逐帧朝向更新。优先把灯壳、真实凹槽、扩散面、吊杆和支架做成一个不透明顶点色批次，用轮廓、有限明暗与清晰接触表现灯具。
- 为顶灯补屋盖时，检查两端切角和后墙封口，不能只把中央截面沿泳池拉长而留下黑色缺口。屋架端部从实际后墙顶面定位，吊杆上下端从灯壳和梁底推导；相机俯视隐藏所依赖的 ceiling 名称须覆盖整个合并批次。

- 领奖台等卡通道具的“整体感”不能只靠三块同色盒子接触。先检查总宽高比、每级踏面与角色尺度，再去掉独立底脚、外挑盖板和可见间隙；连续立面、统一底带及固定面向明暗应一起验证。真实参考只提供结构逻辑，不应直接照搬低对比配色和细弱号码。
- 小图集文字模糊时，先按表面实际宽高比重新分配图块，优先增加字形短缺方向的像素；不要把大量像素留给横向空白后直接扩大整张纹理。以相同物理字号检查各名次数字，不按各台高度分别缩放。

When a modeling pattern succeeds or fails in a way that should transfer to future Blender work:

- Update this skill or one of its references.
- Put broadly important rules near the top of `SKILL.md`.
- Put detailed domain patterns in `references/`.
- Keep additions procedural and reusable.
- Record both what worked and what failed.
