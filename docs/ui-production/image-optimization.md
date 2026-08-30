# UI 图片源文件优化

项目里的 UI 图片分为两类：

- `assets/resources/ui` 位于微信主包。这里不能生成 ASTC/PVR/ETC 变体，减小体积主要依靠优化 PNG/JPG 源文件。
- `assets/race/ui` 位于比赛分包。源文件优化能减小回退资源，`npm run textures:fix` 还会为符合策略的大图配置 ASTC。

两套工具职责不同，不能互相替代：

- `ui:images:*` 优化 PNG/JPG 文件本身。
- `textures:fix/check` 维护 Cocos `.meta` 中的构建压缩配置。

## 使用方法

首次使用先安装图片工具依赖：

```powershell
npm run ui:images:setup
```

只查看预计结果，不修改文件：

```powershell
npm run ui:images:audit
```

一键优化：

```powershell
npm run ui:images:optimize
```

工具会扫描 `assets/resources/ui` 和 `assets/race/ui`，对 PNG 做像素完全一致的无损重编码；仅当 JPG 的估算质量高于 82 时，才以质量 82、渐进式、4:2:0 重新编码。只有同时节省至少 1 KiB 和 3% 才会替换。图片宽高、文件名、扩展名和 `.meta` 都保持不变。

应用前的原文件会备份到 `temp/ui-image-optimizer/backups/<时间>/`。`temp/` 已被 Git 忽略；确认效果后可以自行清理旧备份。

提交前可执行：

```powershell
npm run ui:images:check
npm run textures:check
```

`ui:images:check` 在仍有达到阈值的可优化图片时失败。预算超限默认只提示，因为是否缩小像素尺寸需要结合实际显示尺寸判断；如要把预算提示也作为失败条件，可直接运行：

```powershell
python scripts/optimize-ui-images.py --check --fail-on-budget
```

## 安全边界

- 不自动改变像素尺寸，避免模糊、九宫格边界变化或 UITransform 适配问题。
- 不自动把 PNG 改成 JPG；带透明通道的 UI 必须保留 PNG。
- 不做有损 PNG 调色板量化，避免渐变、辉光和半透明边缘出现色带。
- 不修改 `.meta`，所以 Cocos UUID、SpriteFrame 和资源路径保持不变。
- 替换图片后让 Cocos Creator 自行重新导入；不要手改压缩配置。
