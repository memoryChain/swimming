# D 充气玩具鲨交付

2026-09-22，在 `feature/gameplay-progression`、HEAD `25fec10` 的现有多任务工作区完成。D1 源资源和 D2 接入已完成；正式引擎画面、微信双机、iOS／Android 性能及平台审核仍待验。未切换分支，保留 B／C／E、AI 与巨浪改动。

用户复核后要求保留原鲨鱼辨识度，避免胖头圆鱼，并跳过耗时动作采样。最终模型已改为修长身体、收窄头腹、后掠软鳍、清楚尾柄与分叉尾，保留圆鼻、闭合笑脸、鳃纹、接缝和气阀；主展示改为偏侧面的三分之四角度。**最终改形后没有继续逐帧动作采样，也没有把旧圆形模型的采样画面作为交付证据。** 三段动作及运行时接入保留，最终通过通道数据和行为检查验证可执行部分。

## 可直接查看

- [自包含离线预览](review.html)：八个角度／图标切换，内嵌所有图像与当前 GLB 下载，无外部依赖；为静态作者源预览，不是实机录像。
- [当前侧前方](hero.png)、[侧面轮廓](left.png)、[透明图标](icon-shark.png)。
- [唯一正式作者源](SharkModel_bite_source.blend)、[与运行时一致的 GLB 副本](SharkModel_preview.glb)。
- [实际导出审计](export-audit.json)、[作者网格审计](source-audit.json)、[原版基线](baseline-audit.json)。

## 文件与制作链

| 内容 | 位置与用途 |
| --- | --- |
| 唯一正式源 | `SharkModel_bite_source.blend`；名字保留原流程兼容 |
| 原版追溯 | `archive/SharkModel_pre_D.blend`、原 GLB 与原导出脚本；仅归档，不作为另一正式源 |
| 建模／动作／导出 | `build_shark_bite_animation.py`；确定性重建或仅从正式作者源导出 |
| 图标与六面 | `render_shark_review.py`；源模型、灯光、镜头可复现，PNG 无烘焙文字 |
| 低成本回退 | `export_review.py --fallback-only`；只生成同源固定几何，跳过动作采样 |
| 文件检查／预览 | `audit-export.cjs`、`build_review.cjs` |
| 运行时 GLB | `assets/race/models/SharkModel.glb`；主 UUID `80c3b97c-f7a8-4d0a-8ba3-217482a1c8a0` 保留 |
| 图标身份 | `assets/race/ui/entertainment-banner-v1/icon-shark.png`；原 `.meta` 哈希保留；`art/ui/` 对应源稿同步 |

最终 GLB 为 **123,068 字节、2,644 三角面、1,408 导出顶点、1 蒙皮网格、1 不透明顶点色材质、0 贴图、7 骨骼**。原 GLB 为 248,976 字节、2,813 三角面。实际读取新旧逆绑定矩阵，最大差值为零；下颌兼容骨零权重。新同源静态回退为 494 顶点／846 三角面，加载完成后释放，不额外常驻。

图标源为 256×256、运行时 128×128；透明角完整，实际 alpha 与边界记录在 `export-audit.json`。六面源图和离线页都在 `art/`，不进入微信运行包。

## 复现命令

从项目根目录执行。Windows 使用已配置的 Python 3；macOS 将 `python` 换成 `python3`。Blender 本机路径由 `.agents/local.json` 或 `BLENDER_EXECUTABLE` 提供。当前环境系统 Python 别名不可用，本次通过已有 Blender Python 调用项目启动器；未把个人路径写入制作脚本。

```powershell
# 从正式作者源导出；不会重新建模覆盖手改源。
python scripts/run-blender.py -- --python art/shark-animation/build_shark_bite_animation.py -- --export-only --apply
# 六面与图标；只处理作者源，不访问 Creator。
python scripts/run-blender.py -- --python art/shark-animation/render_shark_review.py -- --apply-icon
# 同源回退，不运行逐帧动作采样。
python scripts/run-blender.py -- --python art/shark-animation/export_review.py -- --fallback-only
node art/shark-animation/audit-export.cjs
node art/shark-animation/build_review.cjs
```

确需从确定性建模参数重建时，去掉首条命令的 `--export-only`；该操作会从归档原骨架重建并保存唯一正式源，应先保留需要的手改。图标导出先读入真实像素再改保存路径，防止 Blender 惰性加载误用目标位置的旧 PNG。

## 接入与性能

详细规则统一维护在 [鲨鱼玩法说明](../../docs/鲨鱼大乱斗玩法说明.zh.md)。`SharkArtPresentation` 统一正式追逐和巡游补命中，保留 `Shark_Bite` 兼容名；按有效前摇把作者 0.09 秒接触点映射到原判定，动作结束归位。模型缩放 1.6、局部高度 −0.10、Y 转角 90°，鼻端继续匹配原 +0.75m 判定锚点；改形主要延伸后身与尾柄，没有移动鼻端或扩大范围。

命中复用 B1 浮圈、入场复用 B2 重入水；去重覆盖模型晚加载、快照乱序、可靠事件尾段和旧局延迟水花。退出只下沉鲨鱼外观层，角色不会被鲨鱼包夹或拖走。接触／入场显式采样限 24Hz，隐藏状态提前返回，变换只在变化时写；没有新逐帧字符串、Graphics 绘制、临时向量、透明外壳或粒子池。

两条路径复用现有 256×144／最高 30Hz 事件画中画，FOV 48°，看清玩具、选手及绕行方向；没有新增相机、RenderTexture 或改变优先级。二十组广播、栏目“玩具巡场”、模式入口、提示、结束语与图标已统一。实际代码及文件审计未发现鲨鱼独立咬合／惨叫音效接线，因此没有虚构音频替换或实机试听结论。

## 检查结果与证据边界

最终修长版本与 E 最终接线整合后：`test:entertainment` **242／242**、`test:shark` **66／66**（其中新行为 13 项）、`test:event-camera` **11／11**，TypeScript 5.4.5 指定检查通过。`test:net` **45／45**；E 最终整合的分支性能／B-C 相关检查 **98／98**，随后 D 改形未修改这些共用运行逻辑。测试使用真实 TypeScript 方法、控制器、Cocos 数学和替代渲染器；不是引擎画面或微信双机结果。

- 资产检查：新旧骨架绑定矩阵一致，动作输入时间起点误差小于 0.1 微秒；游动和顶推通道首尾最大差值为零，三段动作、主 UUID、图标 alpha 和路径通过。
- 字体：已执行生成与检查，1,585 字符／276 个工程文案文件；没有手写生成字体或字表。
- 纹理／导入：最新复核的 `.meta` 已为 `imported=true`，三角面 2,644，与最终 GLB 一致；三段动作、顶点色材质、主 UUID 及原动作子 UUID 保留。`export-audit.json` 中 2,452 面的 meta 数据是生成该审计时的历史快照，不能继续当成当前阻塞。纹理政策检查与元数据都不替代引擎画面验收；未启动、重启或截图 Creator。
- 预览：最终静态多角度页已在独立浏览器打开，八个角度按钮、640px 图像、内嵌 GLB 下载与无外部资源请求通过，无横向溢出；未访问 Creator。最终改形的动作连续画面按用户要求跳过，不使用前一版圆形网格证据。
- 必须在引擎／真机完成：所有角色、潜水／海豚跳和前后侧顶推中的鼻端接触、形变与 B1 衔接；正式主视角／画中画水线、材质、透明排序；微信弱网／迁移／保活重开；iOS／Android 峰值帧耗和内存。离线通过不代表 8+ 审核通过。
