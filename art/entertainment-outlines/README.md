# 娱乐道具细描边

当前范围和预算见 [统一娱乐模式说明](../../docs/统一娱乐模式玩法与实施计划.zh.md)。这是现有模型的附加轮廓，不是第二套实体造型。

- `build_geometry.cjs` 只读当前正式几何及 GLTF／GLB，导出 `EntertainmentOutlineGeometry.ts` 和 `geometry-audit.json`。静态网格离线按位置合并色缝并计算连续法线，按连通部分尺寸排除图案、系带及小附件；原模型不改写。
- 玩具鲨主体与鱼鳍从正式 GLB 提取，位置、法线、骨骼索引和权重逐项保留；审计记录原顶点映射和源文件哈希。天线、螺旋桨、眼睛及接缝不进入描边。不要对双面薄片直接加背面壳，否则背面会形成黑块。
- `build_review.cjs` 使用正式几何、当前水炮转轴和补给尺寸，复用海龟对照页的独立 WebGL 渲染器。源材质含 VEC3／VEC4 两种顶点色，读取时须正确补 alpha。静态页面不验证骨骼动画或真实水体。
- `EntertainmentPropOutline` 按道具池共享网格／材质，仅挂接、加载、销毁时工作。鲨鱼轮廓交给同一 `SkeletalAnimation` 管理，不能硬切实时蒙皮或清空正在播放的片段。所有权只包括专用轮廓，不能销毁借用骨架和原网格。

```powershell
node art/entertainment-outlines/build_geometry.cjs
npx.cmd --yes --package typescript@5.4.5 -c "node art/entertainment-outlines/build_review.cjs"
npm.cmd run test:entertainment
```

输出对照页在 `.cache/entertainment-outline-review/index.html`，自包含、无外部资源。轮廓颜色为海龟同款RGB(12,24,32)，深度偏移0；水炮／浮标局部宽度0.003，鲨鱼／补给瓶0.002，实际宽度随父节点缩放。PNG截图、HTML输出和临时日志不进入游戏资源。

每个可见实例、每个镜头额外预算：水炮1256面／0次额外绘制（已合并，整台共2次），浮标780面／2次绘制，正式鲨鱼1157面／1次绘制，鲨鱼加载回退601面／1次绘制，苏打236面／1次绘制，冰沙172面／1次绘制。七浮标同屏额外5460面／14次绘制；同一池仅两份轮廓模板、一个材质。画中画同时看见时再承担对应绘制成本。未经手机测量，不将这些静态预算表述为真机帧耗结论。

2026-10-02 验证：TypeScript 5.4.5、357项娱乐回归（含6项描边专项）、19项性能与生命周期回归通过。旧性能测试补齐当前炮火事件定义、调试配置读取与取消待发炮击的模拟接口，未改玩法以迁就测试。浏览器180种静态取景状态无WebGL错误；未进行Creator或手机验收。

## 水炮合并描边试点（2026-10-02）

`art/water-play-obstacles/build_cannon_merged.cjs` 从作者 `geometry.json` 提取同一轮廓，归一化法线后外扩0.003、反转绕序并烘入深色顶点色，合并到底座／炮管各自的单一 primitive。保留本体全部顶点、颜色和索引，两部件共享一个 `builtin-unlit` 材质并显式背面剔除；不可改成双面。每台仍为2588面，4次绘制降为2次，不再建立水炮 `PropOutline` 节点或加载独立轮廓材质。生成的公共轮廓数据也移除了水炮独立壳，避免重复携带。

水炮直接使用预合并数据，不再加载原来不含轮廓的GLB来替换网格。原GLB／可编辑源和资源身份保留，作者配方导出后自动调用合并脚本；浮标与水球的晚加载保持原逻辑。`build_geometry.cjs` 和两个审查页始终读取原作者数据，避免把已经合并的壳再次外扩。

颜色须按实际shader核对：当前 `PlayerOutline` 的 `linear:true` 材质上传和片元 `SRGBToLinear` 都会平方；`builtin-unlit` 对顶点色也会平方。因此壳顶点色存 `(RGB/255)^2`，保持现有深色，而非另套标准 sRGB 转换。此试点不改公共shader或其他道具颜色。新对照页按上述引擎路径检查，与旧页的标准线性→sRGB预览不同。

```powershell
node art/water-play-obstacles/build_cannon_merged.cjs
node art/water-play-obstacles/build_cannon_merged.cjs --check
npx.cmd --yes --package typescript@5.4.5 -c "node art/entertainment-outlines/build_cannon_review.cjs"
```

输出 `.cache/cannon-merged-outline-review/index.html`。它比较当前独立描边与合并描边；默认就位、约30°远射、约79°抬头和回弹均采样真实表现类。288组角度／高度／尺寸／姿态检查无WebGL错误，实际 `drawElements` 为4／2；以任一RGB通道差异大于2色阶为阈值，281组无差异像素，其余7组仅一个像素超过阈值（900×650画布）。合并壳开始写深度，仍需在正式主镜头／画中画检查水线、外物遮挡和iOS／Android帧耗；本轮不扩展其他道具。

移除独立水炮壳数据后，两份运行时几何脚本文本相对原版仍约增加53KB，合并后gzip大小约增加4.4KB（仅源码估算，不是微信构建包体）。本轮节省绘制提交、材质与渲染节点，不宣称面数、文件体积或整局帧耗同步减半。
