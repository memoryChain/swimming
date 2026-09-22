# 定时水球 C1 源资源

本目录为离线制作交付。预览使用实际角色蒙皮几何和中性审查材质，**不是游戏实机效果，也不证明微信真机验收通过**。

## 资源与尺寸

- `TimedWaterBalloon.blend`：可编辑球体／扎口与短软连接件。
- `TimedWaterBalloon.glb`：C1 原始导出物；C2 已复制同一文件到 `assets/race/items/TimedWaterBalloon.glb`。
- `build_balloon.py`：独立后台、确定性建模及 GLB 导出。
- `export_review.cjs`：只读采样 11 个真实角色的骨架、蒙皮和肩背位置；`mounts.json` 保存各体型相对 `Spine02` 的挂点、旋转及缩放。
- `render_review.py`：生成三状态、六面、宽窄角色／全角色携带和转交示意。
- `paint_warning.py`：离线生成三面喷水警示印花；`warning-artwork.svg` 为可编辑矢量稿，`warning-basecolor.png` 为内嵌色图，重建以绘制脚本为准。
- `export_motion.cjs`／`render_motion.py`：直接采样运行时表现方法的最后 4.8 秒，生成 `animation-samples.json` 和 `animation-strip.png`，预览页支持播放／暂停和逐帧查看。
- `review.html`：预览索引；`asset-audit.json`：几何预算。

导出坐标为米、Y 向上；Blender 源坐标为 Z 向上。原点位于软连接件接触背部的一端。正常总高 0.58m，球体最大宽 0.36m、深 0.3312m；连接件长 0.14m。扎口朝连接件，饱满端朝外，三条宽黄色瓣与橙色主体形成远景区分。

节点：`TimedWaterBalloon` 根、`BalloonBody`（球体与扎口，缩放原点 Y=0.14m）、`BalloonConnector`。合计 2 网格／2 primitive、696 三角面、1 个共用不透明材质 `WaterBalloonRubber`、1 张 512×512 内嵌色图、0 骨骼、0 形态键；GLB 43,724 字节。软胶采用低金属度、粗糙度 0.38 的普通材质，不使用折射和自定义 effect。与初版相比只增加色图和 UV，网格及材质数量不增加。

2026-09-22 按用户选定的“喷水警示”强化：球面三侧印奶白爆开轮廓、蓝色大水滴与深蓝感叹号。后半段非均匀鼓胀加快，横向最高 1.51 倍、纵向最高 1.36 倍；横向脉动配合轻微纵向压缩再回弹，频率随本轮年龄从 0.75Hz 连续加快至 2.55Hz。最后锁定增加最高 5° 的短促抖动。原 1.22 倍均匀缩放仅为初版记录，不再是当前运行时参数。

根和连接件保持尺寸；扎口与连接件正常重叠 0.012m，缩放／摇摆仍围扎口原点，接触处保持重叠。鼓胀不更改游戏碰撞范围。运行时仍 20Hz 更新形变，无每帧临时对象、材质重建或额外特效池。

## 挂载与转交

挂在 `Spine02`，从每个角色背部蒙皮范围推导接触位置，连接件末端略进入背部，随骨骼和模型的潜水、起跳、翻滚一起运动，不把高度固定在水面。`mounts.json` 使用角色既有 modelScaleMultiplier，保持道具米制尺寸；未来新增角色应重新采样，不能套宽体型数值。

连接件不参与骨骼蒙皮；固定根端随肩背，球体以扎口为中心轻晃。短弧线转交只移动同一份视觉道具，建议沿用现有 0.22 秒和 0.55m 弧高；权威归属及剩余时间立即切换，动画不参与规则。转交图的五份水球表示五个时刻，运行时只有一份道具。

## 复现

从项目根目录执行（Windows；使用已有 Python 环境，Blender 本机路径由 `.agents/local.json` 或环境变量配置）：

```powershell
python scripts/run-blender.py -- --factory-startup --python art/timed-water-balloon/build_balloon.py
npx.cmd --yes --package typescript@5.4.5 -c "node art/timed-water-balloon/export_review.cjs"
python scripts/run-blender.py -- --factory-startup --python art/timed-water-balloon/render_review.py
npx.cmd --yes --package typescript@5.4.5 -c "node art/timed-water-balloon/export_motion.cjs"
python scripts/run-blender.py -- --factory-startup --python art/timed-water-balloon/render_motion.py
node art/timed-water-balloon/build_review_page.cjs
```

当前机器系统 `python` 为无可用运行时的商店入口，因此本次使用已配置 Blender 自带的 Python 执行同一个仓库入口；脚本没有写入本机路径。MCP 连接探测返回拒绝连接，采用独立后台进程，不触碰共享 Blender 场景。

## 验证边界

已检查正常／鼓胀／锁定正面、侧面及比赛相近角度，补充背面、左面、顶部和底部；网格封闭、扎口与软连接件接触、没有引信或计时器。使用 11 个现有角色实际蒙皮，包含最宽肌肉男与最窄超级腿。首次预览发现窄体型连接端悬空，已改为相对肩背骨的挂载，末端略进入背部并重新渲染。

完整划水周期与水下、空中、翻滚的自动检查及 C2 行为结果见 [8+ 计划第 6.2 节](../../docs/娱乐模式8加适龄调整计划.zh.md#62-c2-运行时接入与验证2026-09-22)。已完成 11 角色、24 个划水采样时刻的头部蒙皮顶点与上肢骨点间距检查，以及一份实例连续转交、晚快照／加载、冲线、退出和共享喷水接线测试。此检查不覆盖全部身体网格的精确碰撞。

角色材质、遮挡、水下排序、手机实际尺寸和运行时光照必须继续在引擎与微信 iOS／Android 检查；B1／B2／C2 最终视觉整合、真实房主迁移／后台恢复和设备性能仍待完成，离线通过不能代替这些项目。

本轮强化检查：指定 TypeScript 检查通过，`npm run test:mine-relay` 81／81、共享喷水真实接线 8／8 通过；挂载检查已使用最大 1.51 倍横向、1.335 倍压缩纵向及额外 0.04m 摇摆余量。水花中心改为读取 `BalloonBody.worldMatrix`，包含真实挤压和抖动，不再用均匀缩放近似。

**导入与压缩：** GLB 和原图标已替换，原 `.meta`／UUID 保留。现有 Creator 会话随后已生成新内嵌图片 `WaterBalloonWarning.image`（`@dc145`）及纹理子资源；在元数据就绪后执行 `npm run textures:fix` 和 `npm run textures:check`，均通过。沿项目分类使用不透明世界贴图策略；实际压缩后的标识锐度和设备光照仍待构建／真机检查。未自动启动、重启或截图 Creator。
