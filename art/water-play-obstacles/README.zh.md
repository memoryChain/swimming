# E：运动场水炮与圆盘喷泉浮标

2026-09-22。源模型、源动作、导出脚本、图标与运行时接入在本任务内制作。游戏结果、出生安全、分波和联机规则保持原实现；引擎画面与微信真机另行验收。

## 气球版交付（2026-09-22）

按用户确认的“水滴爆花＋感叹号”完成改版。黄色梨形气球、扣座和连续软系带、分区橙白软边、奶白承托、青蓝盘面及导水槽均来自同一作者源；前后警示采用与曲面连接的浅浮雕顶点色徽记，无贴图或额外透明层。首轮圆盘版保存在 [archive/round-disc](archive/round-disc/README.zh.md)。

- [完整离线预览](buoy-review.html)包含原速／慢放、三角度、时间轴、七套共存与爆开音试听。七套预览执行实际表现与 B2 池，布局仅为离线密度示意，不代表正式出生排期。
- [就位截图](offline-buoy-ready.png)、[爆开截图](offline-buoy-pop.png)、[消耗后截图](offline-buoy-spent.png)、[七套共存截图](offline-buoy-seven.png)均为独立浏览器画面。
- 命中当帧喷水和轻压，气球约 0.10 秒内爆开，底座约 0.30 秒下潜。已武装时入场高度最低为水面下 0.04m，且不等待槽位错开，避免有判定却不可见；未武装可继续水下扰动与展开。成熟快照直接恢复就位，已消耗快照不补声画。
- 系带锚点为底座局部 (-0.32, 0.195, 0.05)m，源网格底环到锚点误差约 1e-8m；同源回退与导入网格保持同一局部坐标。晚加载只交换两块网格，保留气球展开／爆开状态。
- 更新浮标二十组广播与同源图标，维持“喷水浮标”入口及原身份。未改水炮、C 水球、D 鲨鱼资源、命中控制器、协议或 B1／B2 池；任务前后保护文件哈希一致。
- 最终娱乐回归 247／247、性能与生命周期 98／98、联机 45／45、E 专项 13／13、设置 5／5；专项包含七套连续二十轮节点／网格／材质稳定及音效静音／并发／晚加载验证。源模型六面、封闭边界、连接、正体积和原速状态已离线检查。
- 指定类型检查、字体生成及检查（1,581 字符／276 文件）、纹理 fix／check（281 项）通过。现有 Creator 会话生成了新气球网格和短音元数据，主模型 UUID 保留；未启动／重启／截图 Creator。

只重做浮标的复现命令：

```powershell
python scripts/run-blender.py -- --python art/water-play-obstacles/build_obstacles.py -- --only SprayBuoy
python scripts/run-blender.py -- --python art/water-play-obstacles/render_obstacles.py -- --only SprayBuoy
python art/water-play-obstacles/build_pop_sound.py
npx.cmd --yes --package typescript@5.4.5 -c "node art/water-play-obstacles/build_review.cjs --only buoy"
```

完整游戏镜头读性、引擎材质／水中排序、微信双机弱网、iOS／Android 性能和实际包体仍待验；音频浏览器解码与玩法回归不等于手机混音听感验收。

## 源资源与运行时对应

| 道具 | 可编辑作者源 | 运行时 | 状态预览 |
| --- | --- | --- | --- |
| 蓝白运动场水炮 | [WaterBallCannon.blend](WaterBallCannon.blend) | [WaterBallCannon.glb](../../assets/race/items/WaterBallCannon.glb) | [自包含离线预览](cannon-review.html) |
| 气球喷水浮标 | [SprayBuoy.blend](SprayBuoy.blend) | [SprayBuoy.glb](../../assets/race/items/SprayBuoy.glb) | [自包含离线预览](buoy-review.html) |

两个 HTML 均可直接用浏览器打开，无 CDN、外部图片或服务器依赖。可看原速／慢放、三种角度和时间轴；页面嵌入作者源六面图及 72px 图标。水炮画中画取当前实际方法的参数；浮标页的小窗只是离线近景，游戏没有浮标画中画。

模型以米制、GLB +Y 向上导出。水炮 `CannonBase` 与 `CannonNozzle` 为两块独立可编辑网格，局部炮口中心 `(0, 1.04, 1.02)`；浮标由 `BuoyBody` 与 `BuoyBalloon` 两网格组成，局部喷口中心 `(0, 0.25, 0)`。不透明顶点色、单材质、无贴图，无复杂骨骼或运行时动画组件。

水炮底座宽 1.70m，总高约 1.47m，圆钝短喷口；浮标外半径约 0.66／0.65m，主体厚约 0.26m，与既有道具碰撞椭圆匹配。源动作时间轴包含入场／就位／退出、水炮 0.28 秒轻回弹，以及浮标扰动／上浮／稳定／轻压／下潜。源动作供编辑审查，游戏按现有权威阶段驱动同名固定节点，GLB 不携带重复动画系统。

作者配方为 [build_obstacles.py](build_obstacles.py)，共享建模工具为 [model_tools.py](model_tools.py)。部件接触有小幅明确重叠；喷口暗色内衬与口缘端面保留间隔，避免共面闪烁。六面和封闭网格检查见 [source-audit.json](source-audit.json)。

## 复现

从项目根目录运行，Blender 本机位置沿仓库 `.agents/local.json` 或 `BLENDER_EXECUTABLE`，脚本不写入个人安装路径。Windows 使用 `python`，macOS 使用 `python3`：

```powershell
python scripts/run-blender.py -- --python art/water-play-obstacles/build_obstacles.py
python scripts/run-blender.py -- --python art/water-play-obstacles/render_obstacles.py
python scripts/run-blender.py -- --python art/water-play-obstacles/audit_sources.py
node art/water-play-obstacles/audit_assets.cjs
npx.cmd --yes --package typescript@5.4.5 -c "node art/water-play-obstacles/build_review.cjs"
npm.cmd run test:water-play
```

本机普通 Python 商店入口不可用时，本次使用已配置 Blender 自带 Python 执行同一 `scripts/run-blender.py`。模型构建会更新两个专属运行时 GLB 和生成的 `WaterPlayObstacleGeometry.ts`；重导时保留现有 `.meta`，待已有 Creator 会话导入完成后按项目纹理策略检查。

[render_obstacles.py](render_obstacles.py) 从同一作者源导出无文字透明图标，更新 `art/ui/entertainment-banner-v1/icon-{cannon,mine}-generated-source.png`、相应 SVG 索引及运行时同名 PNG，不改变原 UUID。按钮和广播文字仍由程序 Label 显示。

离线预览由 [build_review.cjs](build_review.cjs) 实际执行 E 表现类、Cocos 数学与球体生成函数、B2 共用水花池，采样固定网格和 20Hz 变换。源图来自 Blender。人物为 B1 已有固定姿态的灰色参照，不代替完整受击／搭圈动作和正式角色材质。

[capture_review.cjs](capture_review.cjs) 仅用于已经打开的独立 E 浏览器标签（本地审查端口 8770）。它不会连接或截图 Creator，产出 [水炮离线截图](offline-cannon.png)、[浮标离线截图](offline-buoy.png)及 [浏览器检查记录](browser-audit.json)。HTML 的直接打开不依赖这个截图脚本。

## 运行时行为

- `WaterPlayObstacleModels` 构建固定节点和同源几何回退；加载 GLB 后只交换网格引用。两条候选路径集中登记于 `ResourcePaths.ts`，不在热路径加载资源。加载失败仍显示新题材，加载迟到不改变入场／漂浮／下潜状态。
- 水炮延续 1.8 秒入场、1.2 秒退出。底座固定，只在发射时转向；水球从实际喷口端面出发。短回弹完全归零，晚快照不补播已过去的回弹。原水面预警、飞行时长、5.8m 增高、中心与外围判定保持。
- 浮标继续 `WaterFloatMotion.heavyHazard`，命中当帧喷水和轻压，独立视觉尾段在 0.3 秒内下潜。当前槽位状态与 revision 阻止迟到事件操作新浮标，generation 更换清掉旧尾段。未启用快照不自动重播喷水。
- 两类分别复用 B2 的 CANNON／MINEFIELD owner、原容量与强度；浮标局部喷水取真实喷口世界坐标，水面水花取权威 X/Z。没有新增特效池、场景摄像机或 RenderTexture。
- 中心／接触命中继续 B1；删除浮标“撞上水雷 · 急救中”的重复个人大提示。HUD、模式入口、图标、各 20 组广播和浮标调参文字使用新题材，原稳定 ID、调参键与确定性选择不变。
- 气球版新增原创短音 `buoy_balloon_pop.wav`（0.18 秒、22.05kHz 单声道、7,982 字节），由 `build_pop_sound.py` 确定性合成。复用 StrokeSfxManager 的已有输出与设置音量，间隔 120ms 合并同类声音，最多两声重叠；预载完成不补播旧事件。水炮声音不变。
- C 的 `MineRelayBrawlPresentation.ts`、`MineRelayBrawlController.ts` 和 `TimedWaterBalloon.glb` 与任务开始时 SHA-256 一致；水炮／浮标控制器同样一致。解除旧水雷帮助函数依赖没有重构 C 或删除其兼容导出。

## 静态成本与验证边界

| 项目 | 水炮 | 浮标 |
| --- | --- | --- |
| 单件网格／材质 | 2／1 | 2／1 |
| 单件三角面 | 1,012 | 1,328 |
| GLB 原始字节 | 71,528 | 104,248 |
| 常规最大实例 | 2 | 独立 7／统一 5 |
| 额外贴图 | 0 | 0 |

两侧水炮 4 个渲染节点，加单个水球与原落点预警；7 个浮标 14 个渲染节点。水球为 12 段固定球体（288 三角面），预警保持原几何，B2 的池容量与网格完全不变。模型回退网格与导入网格在加载后共存于资源缓存，有界且不随轮次增加。生成回退数据约 87.7KB；新增 GLB 与图标替换的原始字节变化记录于 [delivery-audit.json](delivery-audit.json)，不等同于微信构建包体。

[与旧模型的离线对照](performance-audit.json)：单门水炮 644→1,012 三角面，单个浮标 396→1,328（首轮圆盘版为 704）；两门水炮＋小水球＋预警＋7 个浮标合计 4,140→11,680 三角面、11→20 个渲染节点。增加的九次道具绘制用于独立喷口回弹与七套气球组件，不增加材质或透明层。完整场景成本仍须真机测量。

HUD 10Hz、世界装饰 20Hz、原画中画最高 30Hz；字符串最终值变化才赋值，隐藏表现提前返回。无每帧新建节点、向量、材质、网格、Tween 或 Graphics 重绘。`showImpact` 的快照读取为事件调用，不是逐帧分配。

已检查封闭边界、正体积、非退化面、源动作、GLB 与运行时逐字节一致、RGBA 图标尺寸／透明边界／旧 UUID。已有 Creator 会话随后生成两个正式 glTF `.meta` 与子资源记录；没有自动启动／重启 Creator，也没有截图它。

## 交付检查记录（2026-09-22）

在 `feature/gameplay-progression`、HEAD `25fec10` 的现有工作区完成。D 释放共用占用后，E 重新读取并局部整合远侧镜头与测试夹具；没有切换分支或覆盖 D 专属文件。各组覆盖重叠，不累计成独立测试数量。

| 检查 | 结果 |
| --- | --- |
| `test:entertainment`，D／E 最终整合 | 247／247 |
| `branch-performance-regressions` 与 `branch-delivery-regressions` | 98／98；实际水炮生命周期覆盖取消、漏整轮快照、跨轮和返场 |
| `test:water-play` | 13／13；真实 Cocos 数学和表现方法，资源回调使用替身 |
| `test:net` | 本任务 45／45；E 未变更线协议或命中控制器 |
| B1／B2／C 实际表现专项 | 18／18；C 呈现／控制器／GLB 哈希一致 |
| `test:cannon`／`test:mine-relay`／`test:event-camera` | 本任务分别 65／65、80／80、11／11；最终聚合另含新增测试 |
| 指定 TypeScript 5.4.5 `tsc --noEmit --ignoreDeprecations 5.0 --skipLibCheck` | 最终通过 |
| `fonts:build`／`fonts:check` | 已生成并最终检查通过，1,581 字符、276 文件；本机以 `npm.cmd run` 执行同一脚本 |
| `textures:fix`／`textures:check` | 元数据就绪后通过，281 项扫描、160 项压缩、33 项 mip；D 移除旧鲨鱼贴图后数量减少 |
| 源资源及 PNG／GLB 审计 | 封闭网格、正体积、无退化、源动作、源与运行时字节一致、256px RGBA／透明边界／旧 UUID 均通过 |
| 独立浏览器离线检查 | 两页三角度与全状态、WebGL 零错误、零外部资源、360px 无横向溢出；见 [browser-audit.json](browser-audit.json) |

水炮远侧投影检查覆盖水球和落点；镜头按包围范围扩大拍摄距离，保留原 FOV 和优先级。结束快照先到仍补一次当前水花，退场后不补旧结果。离线页初次绘制直接初始化，不依赖后台标签页可能暂停的动画帧；随后继续正常播放。

性能与交付测试依赖固定 TypeScript 5.4.5；本机通过临时启动脚本将 npx 临时包目录设为 `NODE_PATH`，再执行 `node --test tests/branch-performance-regressions.test.cjs tests/branch-delivery-regressions.test.cjs`。未修改依赖版本。

## 引擎与真机待验

- [ ] Creator 中实际加载新模型与图标；确认 GLB 网格交换、顶点色、水下排序、预警及真实尺寸。元数据存在不代表画面验收。
- [ ] 单机完整水炮入场→发球→喷水→退出，浮标扰动→上浮→触碰→即时调整→下潜；主镜头、折返、远侧落点和画中画的正常速度读性。
- [ ] 微信双机：高速扫掠、潜水接触、迟到／重复事件、快照恢复、旧代次退场、新槽补位、房主迁移与后台恢复；确认结果仍结算一次。
- [ ] B1 浮圈与 B2 水花的全角色完整组合，暂停／保护结束时刻和输入恢复，无遮挡头部与划水方向。
- [ ] iOS／Android 八人、3 个冲击槽满载、7 个浮标、连续 20 轮与保活重开：帧耗、透明填充、draw call、节点／材质／内存和实际微信包体。
- [ ] C 水球携带、短传、锁定、到时、冲线与镜头让位的真机回归；本任务的自动回归不等于 C 全流程真机验收。

本交付不代表 8+ 平台审核通过。
