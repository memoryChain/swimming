# UI 运行结构与资源维护

结算定稿的分层切图、字体、名次状态、镜头与联机按钮规则见 [结算界面接入说明](结算界面接入说明.zh.md)。

## 场景流程

- `Login` 是游戏入口，只加载开始界面、赛程选择和调试入口。
- 点击“开始比赛”后，`GameLaunchOptions.ts` 保存本次模式，随后切换到 `MainGame`。
- `MainGame` 创建泳池、选手、比赛 HUD 和结算界面，并自动开始倒计时。
- 返回主菜单时重新加载 `Login`，不会在比赛场景上叠加开始界面。

## UI 职责

- `assets/resources/ui/SpeedStarsUI.prefab` 保存 UI 层级、静态样式和 Sprite 引用。
- `SpeedStarsUiPrefabBuilder.ts` 查找 prefab 节点并绑定运行时组件。
- `UIController.ts` 只更新计时、速度、赛程进度、排名等动态数据，不绘制美术底板。
- `UIFlowController.ts` 管理开始、比赛和结算状态的显隐。
- 所有运行时资源路径集中在 `ResourcePaths.ts`。

## 运行时资源

`assets/resources/ui` 只保留游戏实际引用的资源：

- `paddle-master-login-v8`：登录界面背景、标题 logo、开始/联机按钮和头像等图标。
- `race-hud`：赛程进度中的游泳选手图标。
- `results-v2`：结算面板、排名行、按钮和头像。
- `speed-stars`：HUD 与调试界面仍在使用的通用底板、进度条和计量条。
- `SpeedStarsUI.prefab`：上述资源的运行时装配入口。

原图、imagegen 输出、联系表、旧版资源和废弃代码放在 `temp/ui-source`、`temp/ui-archive`。`temp` 已被 Git 忽略，也不会进入微信小游戏包。

## 资源约束

- 透明 UI 元素使用独立 PNG；全屏不透明背景可使用压缩 JPG，不保留图集源图。
- 固定装饰文字可以烘焙到图片；赛程、成绩、计时等动态或需本地化的文字使用 Cocos `Label`。
- 微信小游戏优先使用小尺寸纹理、少量材质和可复用组件；新增图片前先确认 prefab 或代码确实引用它。
- 替换运行时图片后在 Cocos Creator 中刷新资源目录，确认仍生成 `cc.Texture2D` 与 `cc.SpriteFrame`。

## 检查命令

检查 `assets/resources/ui` 中是否存在没有被项目引用的 PNG/JPG：

```powershell
powershell -ExecutionPolicy Bypass -File tools/audit-runtime-ui-assets.ps1 -FailOnUnused
```

修改 TypeScript 后运行：

```powershell
npx.cmd --yes --package typescript tsc --noEmit --ignoreDeprecations 6.0 --skipLibCheck
```

Cocos Code Mode MCP 的安装与迁移步骤见 `tools/cocos-code-mode-setup/README.md`。
