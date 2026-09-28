# 海龟班车作者源

美术与玩法规格统一见 [海龟班车计划](../../docs/海龟班车玩法与落地计划.zh.md)。此处只说明复现方法。

- `TurtleBus.blend`：可编辑连续海龟、独立四鳍、四组圈绳；不包含预览相机。
- `build_turtle_bus.py`：确定性建模入口，调用 `build_refined.py` 和 `mesh_builder.py`。运行前保留当前作者源修改；重建会重写本目录 `.blend` 及两个运行时几何／尺寸文件。
- `reference-study/build_reference_board.cjs`：真实海龟、低多边形分面、拖圈握把和项目炮台／垃圾／玩具鲨对照页生成器，含参考来源链接。先用 `inspect_existing.py` 生成现有模型预览；对照页及预览只保留本地。外部参考图不进入游戏资源。
- `model-audit.json`：网格闭合、体积、实体范围、握带接触和渲染预算。
- `export_grip_review.cjs`：加载全部正式角色GLB及正式抓握代码，输出固定乘客尺度表、11角色测量报告和3种体型的真实蒙皮样件。
- `render_refined.py`：只读 `.blend`，生成六视图、整车及抓握近景；不把相机写回作者源。样件使用简化检查材质，不代表引擎水面或角色最终着色。

从项目根目录执行，Windows用 `python`／`npx.cmd`，macOS用 `python3`／`npx`：

```powershell
python scripts/run-blender.py -- --python art/turtle-bus/build_turtle_bus.py
npx.cmd --yes --package typescript@5.4.5 -c "node art/turtle-bus/export_grip_review.cjs"
python scripts/run-blender.py -- --python art/turtle-bus/render_refined.py
npm.cmd run test:turtle-bus
```

Blender位置由仓库本机配置或 `BLENDER_EXECUTABLE` 指定；MCP可用时优先使用MCP。源使用Blender Z向上；导出映射至Cocos Y向上并翻转三角形绕序。人物尺度必须离线固定，不能在不同客户端按当前动画临时测量。

海龟身体、4鳍、4圈、4绳合计13次绘制、3972三角形、1材质；圈绳共享模板。运行时仅控制变换和少量状态，不逐帧重建几何。预览PNG、中间蒙皮数据、Python缓存及Blender备份均不提交。
