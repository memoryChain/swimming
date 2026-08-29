# 大厅界面运行时资源说明

- 设计源：`划水大师-大厅-A版-1280x720-v1.psd`，画布 `1280×720`。
- 运行时资源目录：`assets/race/ui/lobby-v1`。
- 参考图：`lobby-reference-1280x720.jpg`。
- PSD 本体继续保留在美术源目录，不放入 `assets/`，避免被 Cocos 当作运行时资源导入。

## 导出约束

- 所有可变文字均由 Cocos `Label` 渲染，PNG 内不包含按钮、模式、角色、属性或技能文案。
- 角色占位图不导出；大厅中央继续使用 `PrepareRaceCharacterPreview` 的运行时 3D 角色。
- 模式卡使用 PSD 中隐藏的 `1 / 2 / 3` 原始组导出为统一的 `410×170` PNG。
- 选中模式保持 `100%`；未选中模式缩放至 `80%` 并保持右侧对齐。
- 三张模式卡按各自当前显示高度逐张排布，始终保持 `7px` 可见间距，不使用固定中心点间距。
- 选中框直接使用 PSD 中的 `选中框` 智能对象导出，透明中心、圆角描边和星标位于同一张贴图；只在选择状态变化时切换显示。
- 顶部玩家、货币和设置使用大厅 PSD 新版控件；昵称和货币数值仍是运行时数据，大厅态不显示返回按钮。
- 中文使用 `PingFang SC` 及对应粗体状态；数字和英文使用 `Arial Black`，避免普通系统字体造成字面宽度和重量偏差。
- 大厅 3D 角色使用独立的放大尺度和镜头偏移；角色管理页保留原展示尺度。

## 资源清单

- `background.jpg`：大厅背景，不含角色和界面控件。
- `character-panel.png`：角色信息卡底板、属性图标和等级胶囊。
- `skill-card.png`：技能卡底板和技能图标。
- `character-button.png`：角色养成按钮底板和箭头。
- `mode-beginner.png`、`mode-standard.png`、`mode-championship.png`：三张无文字模式原图。
- `mode-selected-frame.png`：PSD `选中框` 智能对象原样导出的完整选中态。
- `online-button.png`、`start-button.png`：无文字操作按钮。
- `top-player.png`、`top-settings.png`、`top-currency.png`：新版顶部控件底图与图标，不含动态文字。

新增图片首次进入 Cocos Creator 后，应由编辑器生成 `.meta`，随后执行 `npm run textures:fix` 和 `npm run textures:check`。不要手工填写压缩配置。
