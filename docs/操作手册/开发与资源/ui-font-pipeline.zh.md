# 《划水大师》UI 字体自动化规范

## 目的

项目不再依赖“某台电脑装了什么字体”，也不维护手写汉字清单。工程会扫描静态 UI 文案，自动生成常规和半粗两套字体子集，并在微信小游戏构建前检查字体是否过期。

这解决三个问题：

- 同一界面在不同电脑上粗细不一致；
- 新增文字后漏字、方框或回退到另一种字体；
- 为了覆盖全部中文而把完整大字体塞进小游戏包体。

## 日常操作

首次配置环境：

```bash
pnpm fonts:setup
```

新增或修改固定 UI 文案后：

```bash
pnpm fonts:build
pnpm fonts:check
```

`fonts:build` 会完成以下工作：

1. 扫描 `assets/scripts`、`assets/resources`、`assets/race` 中的 TypeScript、JSON、场景和 Prefab 文案；
2. 自动汇总字符，不需要人工录入汉字；
3. 从固定版本的 Noto Sans SC 字体源生成 400 和 600 两个真实字重；
4. 输出到 `assets/race/fonts`；
5. 更新字符清单和带哈希的生成清单。

生成后如字体是首次加入工程，应让 Cocos Creator 完成导入并生成 `.meta`，再进行微信构建。以后替换字体文件时保留 `.meta`。

## 文件职责

- `scripts/ui-font-config.json`：唯一配置源，记录扫描范围、字体源和输出字重。
- `scripts/build-ui-fonts.py`：下载固定字体源、扫描文案并生成字体子集。
- `scripts/ui-font-policy.js`：只读检查文案哈希、字体文件哈希和生成清单。
- `scripts/generated/ui-font-glyphs.txt`：自动生成的可审阅字符结果，禁止手改。
- `scripts/generated/ui-font-manifest.json`：自动生成的版本、哈希和文件大小记录，禁止手改。
- `assets/race/fonts/ShuiMasterUI-Regular.ttf`：正文使用的 400 字重。
- `assets/race/fonts/ShuiMasterUI-SemiBold.ttf`：标题、按钮和重点数值使用的 600 字重。

微信构建钩子会调用 `scripts/ui-font-policy.js`。文案已变化但字体没重建、字体被手工覆盖、生成文件缺失时，构建会直接失败并提示运行 `pnpm fonts:build`。

## 使用边界

自动扫描适用于随包发布的固定文案。玩家昵称、聊天、服务器临时公告和构建后才获得的远程文本属于无限字符集合，不能只靠静态子集保证覆盖。这类文本应继续使用已确认的全字符或系统字体回退；如果是固定本地化词库，应把词库文件纳入 `scripts/ui-font-config.json` 的扫描范围。

不要用描边、阴影、复制 Label 或电脑字体名伪造粗体。常规文字使用 Regular，设计稿标记为标题、按钮、重点数字的文字使用 SemiBold。

## 字体来源和许可

字体源固定为 Noto Sans SC 2.004，来自 Noto CJK 官方仓库，许可证为 SIL Open Font License 1.1。运行字体经过项目字符子集化并重命名为 `ShuiMaster UI`，避免依赖本机字体和混淆上游字体名称。

- 官方仓库：https://github.com/notofonts/noto-cjk
- 许可证：https://github.com/notofonts/noto-cjk/blob/Sans2.004/LICENSE
- 项目内许可证副本：`LICENSES/NotoCJK-OFL-1.1.txt`
