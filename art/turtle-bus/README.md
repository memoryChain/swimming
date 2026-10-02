# 海龟班车作者源

美术与玩法规格统一见 [海龟班车计划](../../docs/海龟班车玩法与落地计划.zh.md)。此处只说明复现方法。

- `TurtleBus.blend`：可编辑连续海龟、独立四鳍、四组圈绳；不包含预览相机。
- `build_turtle_bus.py`：确定性建模入口，调用 `build_refined.py` 和 `mesh_builder.py`。运行前保留当前作者源修改；重建会重写本目录 `.blend` 及运行时实体几何、描边几何、尺寸三个文件。
- `reference-study/build_reference_board.cjs`：真实海龟、低多边形分面、拖圈握把和项目炮台／垃圾／玩具鲨对照页生成器，含参考来源链接。先用 `inspect_existing.py` 生成现有模型预览；对照页及预览只保留本地。外部参考图不进入游戏资源。
- `model-audit.json`：网格闭合、体积、实体范围、握带接触和渲染预算。
- `export_grip_review.cjs`：加载全部正式角色GLB及正式抓握代码，输出固定乘客尺度表、11角色测量报告和3种体型的真实蒙皮样件。
- `render_refined.py`：只读 `.blend`，生成六视图、整车及抓握近景；不把相机写回作者源。样件使用简化检查材质，不代表引擎水面或角色最终着色。
- `render_polish_review.py`：只读作者源或导出的 TypeScript 几何，固定机位检查整体、头脸、鳍根及六面；支持素模与顶点色，以及 `--flap -1/1` 的正式摆鳍极值。对照必须使用相同输入类型、机位和显示设置，不能把顶点色离线图当作引擎截图。

从项目根目录执行，Windows用 `python`／`npx.cmd`，macOS用 `python3`／`npx`：

```powershell
python scripts/run-blender.py -- --python art/turtle-bus/build_turtle_bus.py
npx.cmd --yes --package typescript@5.4.5 -c "node art/turtle-bus/export_grip_review.cjs"
python scripts/run-blender.py -- --python art/turtle-bus/render_refined.py
npm.cmd run test:turtle-bus
```

Blender位置由仓库本机配置或 `BLENDER_EXECUTABLE` 指定；MCP可用时优先使用MCP。源使用Blender Z向上；导出映射至Cocos Y向上并翻转三角形绕序。人物尺度必须离线固定，不能在不同客户端按当前动画临时测量。

海龟实体（身体、4鳍、4圈、4绳）合计13次绘制、3972三角形、1材质；圈绳共享模板。细描边额外700三角形、5次绘制、1个共用材质实例，合计4672三角形、18次绘制、2材质，复用人物效果文件。运行时仅控制变换和少量状态，不逐帧重建几何。预览PNG、中间蒙皮数据、Python缓存及Blender备份均不提交。

2026-10-02 精修保持上述预算和现有圈绳、握点、鳍轴，主要调整头脸、沿展向减薄的鳍截面与壳缘分色。审计新增颈根、四鳍根部在正式摆幅极值的嵌入检查。每次重建前先备份当前源；可先用隔离输出验证，不覆盖游戏几何：

```powershell
python scripts/run-blender.py -- --python art/turtle-bus/build_turtle_bus.py -- --review-dir .cache/turtle-review
python scripts/run-blender.py -- --python art/turtle-bus/render_polish_review.py -- --blend .cache/turtle-review/TurtleBus.blend --out-dir .cache/turtle-review --prefix solid --solid
python scripts/run-blender.py -- --python art/turtle-bus/render_polish_review.py -- --geometry .cache/turtle-review/TurtleBusGeometry.ts --layout .cache/turtle-review/TurtleBusLayout.ts --out-dir .cache/turtle-review --prefix color
```

同日色彩修订：用户要求与岸边水炮一样鲜明、卡通。作者色板现在明确采用 sRGB，`MeshBuilder` 转为线性材质色后导出顶点色；不能把屏幕 RGB 直接当线性色，否则显示会偏亮、偏粉。切面明暗范围改为与水炮相同的0.65～1.0；绿色主体配冷白腹甲、蓝色背带、橙白拖圈。蓝／白／橙／深蓝直接对齐水炮作者色值。审计记录色彩空间、色板和明暗范围。

`render_polish_review.py --cannon-geometry assets/scripts/core/WaterPlayObstacleGeometry.ts --out-dir .cache/turtle-review --prefix cannon --views hero` 可在与海龟相同的显示条件下查看正式水炮，无需重导或改动水炮资源。对照页的模型取景会各自缩放以便比较，不表示世界尺寸相等。

同日细描边：`TurtleBusOutlineGeometry.ts` 仅保留闭合壳、头颈、尾巴及四鳍的连续法线，不包含壳缝、眼睛、背带、圈和绳；`TurtleBusOutline.ts` 将5个描边节点一次性挂到身体及四鳍，继承显隐、转向、下潜与摆鳍。颜色为深蓝灰RGB(12,24,32)，外扩参数3（局部0.003世界单位，不是固定像素），深度偏移为0。新增绘制成本按每个实际绘制海龟的镜头计算。

`npx.cmd --yes --package typescript@5.4.5 -c "node art/turtle-bus/build_outline_review.cjs"` 生成 `.cache/turtle-outline-review/index.html` 自包含WebGL对照，可切换近景、人物同框、远景与摆鳍角度。使用正式表现代码采样模型位置；存在 `grip-review-data.json` 时加入真实姿态简化材质人物，没有该文件时只显示海龟。此页不替代引擎水面、正式人物着色或手机性能验收。
