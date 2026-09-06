# Manifest And WeChat Budgets

本文件及 PowerShell 工具为旧版清单格式。预算仅作项目尚无规则时的起点，不覆盖宿主项目的分包、压缩和尺寸政策；已有设计清单不必迁移。横屏页面记录实际设计比例，不能使用下表的竖屏默认尺寸。划水大师优先运行项目 `scripts/optimize-ui-images.py`、`textures:fix/check` 和页面测试；图标超预算时报告具体原因，不为通过默认值擅自缩小已确认徽章。

## Manifest Fields

- `id`: Stable ASCII asset id.
- `category`: `background`, `sprite`, or `icon`.
- `sourcePath`: Raw/reference file under the job workspace.
- `outputPath`: Final runtime file, relative to project root.
- `width`, `height`: Exact runtime pixel dimensions.
- `format`: `png` or `jpg`.
- `textMode`: `none`, `label`, or `baked`.
- `reuse`: `unique`, `shared`, or `nine-slice`.
- `fitMode`: `cover`, `contain`, `stretch`, or `custom`.
- `edgePolicy`: `transparent` or `allow-opaque`.
- `maxBytes`: Optional per-asset limit that may only tighten the category default.
- `budgetOverride`: Permit an intentional budget exception. Record the reason in `budgetReason`.

All paths are relative to the project root passed to the scripts. Keep the manifest and source files in `temp/ui-pipeline/<job>`.

## Default Budgets

| Category | Size | Bytes |
| --- | --- | --- |
| `background` | 720x1280 portrait default | 256 KiB |
| `sprite` | max edge 1024 | 128 KiB |
| `icon` | max edge 256 | 32 KiB |
| feature total | manifest assets | 1.5 MiB |

Use JPG for opaque full-screen art. Use PNG only when alpha is required. Do not enlarge a low-resolution source merely to satisfy a nominal target size.

An override is acceptable only when reducing the file would visibly damage a primary asset or when a platform-specific requirement demands a larger texture. Keep the override local to that asset and include a reason.
