# Collections And Cleanup

Use this reference for Blender scene organization, asset collections, object joining, tile lots, and final cleanup.

## Collection Rules

- Put generated objects in the user-specified collection.
- If the asset is experimental, create a clearly named subcollection.
- Do not leave objects both inside and outside the intended collection.
- Use parent empties for critique-friendly prototypes.
- Remove old prototype collections when starting over unless the user asks to preserve versions.

## Object Count Discipline

Separate objects are acceptable while learning, but each object needs a role:

- body mesh
- roof mesh
- panel insert module
- door module
- cable curve
- ground pad
- sign module
- rig/control object

For repeated elements, prefer module objects over many unrelated primitives:

- one rail/fence panel module duplicated around a platform
- one stair unit or tread module duplicated along a run when the design repeats
- one rim facet module duplicated around circular equipment
- one louver/slat/bolt/bracket module duplicated with shared dimensions

Do not leave linked duplicates/shared mesh data in final asset collections. Repeated pieces should be consistent because they were built from the same measured module and placement logic, but each object should have its own mesh datablock so Apply Transform and per-object edits work normally. If a repeated module needs variation, duplicate the module intentionally and rename the variant.
Do not leave linked clones hiding in the Outliner. Before finishing, scan the repeated objects for shared mesh datablocks and make them single-user or replace them with clean real duplicates. If a linked clone was useful during blockout, clean it up before calling the asset done.

After approval, join small static detail pieces into logical modules:

- one body mesh
- one door/panel module if useful
- one cable group if routing may vary
- one sign/roof/accessory module
- one rail/fence/platform-access module instead of loose individual posts and bars

## Tile Lots

- Use the project's base tile object for lot grids when available.
- Rebuild lot tiles from documented footprint sizes.
- Position placement/front/min/max empties from actual tile bounds.
- Remove old mesh planes when replacing them with tile lots.
- Keep tile source and lot dimensions as custom properties where useful.

## Cleanup Checks

- Hide or delete unused cutters after booleans.
- Delete temporary swatches and preview-only helpers from final asset collections.
- Keep preview cameras/lights only if they are intentionally useful.
- Verify object names communicate role and step.
- Check repeated objects: identical rail panels, rim facets, slats, bolts, and fence pieces should be clearly derived from one validated module, but must not share mesh datablocks in the final asset.
- Check the Outliner for linked clones, shared mesh data, accidental multi-collection objects, and leftover prototype duplicates. Clean them before final response.
- For contact-critical assemblies, keep a short interface audit list and verify the claimed touching parts still touch after any transforms, joins, or cleanup.
- Before final response, confirm objects are in the intended collection.

## Blender 源文件定向同步到 Cocos 导出目标

- `bpy.data.libraries.load()` 会把传入的对象名列表原地替换为对象引用；需要保留原名时传入 `names.copy()`。Append 对象先链接到临时集合并更新 view layer，再读取 `matrix_world` 和世界包围盒，避免未求值矩阵误判位移。
- 替换 Mesh 时保留目标节点的父子关系、变换和原 Mesh 名，复用未修改的材质引用。仅在旧 Mesh 已无用户时移除；不要给 Cocos 子资源无意改名。
- GLB 新增纹理会使 `UnnamedTexture-N` 的索引移动。Cocos 重导入后核对 Texture2D 的图片引用及 wrap/filter：旧采样配置应按图片身份保留，不能随旧索引错配到另一张图。压缩 preset 与 mipfilter 仍由项目纹理策略脚本处理。
- 对细栅格、板缝等不影响轮廓的重复细节，优先烘焙到共享小纹理；只给压顶、凹槽和接触面保留几何。相邻材质区域直接分割原表面，避免透明覆盖与贴地面片闪烁。
