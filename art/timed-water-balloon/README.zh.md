# 定时水球 C1 源资源

本目录为离线制作交付。预览使用实际角色蒙皮几何和中性审查材质，**不是游戏实机效果，也不证明微信真机验收通过**。

## 资源与尺寸

- `TimedWaterBalloon.blend`：可编辑球体／扎口与短软连接件。
- `TimedWaterBalloon.glb`：C1 原始导出物；C2 已复制同一文件到 `assets/race/items/TimedWaterBalloon.glb`。
- `build_balloon.py`：独立后台、确定性建模及 GLB 导出。
- `export_review.cjs`：只读采样 11 个真实角色的骨架、蒙皮和肩背位置；`mounts.json` 保存各体型相对 `Spine02` 的挂点、旋转及缩放。
- `render_review.py`：生成三状态、六面、宽窄角色／全角色携带和转交示意。
- `review.html`：预览索引；`asset-audit.json`：几何预算。

导出坐标为米、Y 向上；Blender 源坐标为 Z 向上。原点位于软连接件接触背部的一端。正常总高 0.58m，球体最大宽 0.36m、深 0.3312m；连接件长 0.14m。扎口朝连接件，饱满端朝外，三条宽黄色瓣与橙色主体形成远景区分。

节点：`TimedWaterBalloon` 根、`BalloonBody`（球体与扎口，缩放原点 Y=0.14m）、`BalloonConnector`。合计 2 网格／2 primitive、696 三角面、1 个共用不透明顶点色材质 `WaterBalloonRubber`，0 贴图、0 骨骼、0 形态键；GLB 23,452 字节。软胶采用低金属度、粗糙度 0.38 的普通材质，不使用折射和自定义 effect。

`BalloonBody` 建议 1.00～1.22 倍均匀鼓胀，根和连接件保持尺寸；扎口与连接件正常重叠 0.012m，最大鼓胀时仍有接触。轻晃／锁定抖动围绕扎口原点，角度不超过 4°。鼓胀不更改游戏碰撞范围。

## 挂载与转交

挂在 `Spine02`，从每个角色背部蒙皮范围推导接触位置，连接件末端略进入背部，随骨骼和模型的潜水、起跳、翻滚一起运动，不把高度固定在水面。`mounts.json` 使用角色既有 modelScaleMultiplier，保持道具米制尺寸；未来新增角色应重新采样，不能套宽体型数值。

连接件不参与骨骼蒙皮；固定根端随肩背，球体以扎口为中心轻晃。短弧线转交只移动同一份视觉道具，建议沿用现有 0.22 秒和 0.55m 弧高；权威归属及剩余时间立即切换，动画不参与规则。转交图的五份水球表示五个时刻，运行时只有一份道具。

## 复现

从项目根目录执行（Windows；使用已有 Python 环境，Blender 本机路径由 `.agents/local.json` 或环境变量配置）：

```powershell
python scripts/run-blender.py -- --factory-startup --python art/timed-water-balloon/build_balloon.py
npx.cmd --yes --package typescript@5.4.5 -c "node art/timed-water-balloon/export_review.cjs"
python scripts/run-blender.py -- --factory-startup --python art/timed-water-balloon/render_review.py
node art/timed-water-balloon/build_review_page.cjs
```

当前机器系统 `python` 为无可用运行时的商店入口，因此本次使用已配置 Blender 自带的 Python 执行同一个仓库入口；脚本没有写入本机路径。MCP 连接探测返回拒绝连接，采用独立后台进程，不触碰共享 Blender 场景。

## 验证边界

已检查正常／鼓胀／锁定正面、侧面及比赛相近角度，补充背面、左面、顶部和底部；网格封闭、扎口与软连接件接触、没有引信或计时器。使用 11 个现有角色实际蒙皮，包含最宽肌肉男与最窄超级腿。首次预览发现窄体型连接端悬空，已改为相对肩背骨的挂载，末端略进入背部并重新渲染。

完整划水周期与水下、空中、翻滚的自动检查及 C2 行为结果见 [8+ 计划第 6.2 节](../../docs/娱乐模式8加适龄调整计划.zh.md#62-c2-运行时接入与验证2026-09-22)。已完成 11 角色、24 个划水采样时刻的头部蒙皮顶点与上肢骨点间距检查，以及一份实例连续转交、晚快照／加载、冲线、退出和共享喷水接线测试。此检查不覆盖全部身体网格的精确碰撞。

角色材质、遮挡、水下排序、手机实际尺寸和运行时光照必须继续在引擎与微信 iOS／Android 检查；B1／B2／C2 最终视觉整合、真实房主迁移／后台恢复和设备性能仍待完成，离线通过不能代替这些项目。
