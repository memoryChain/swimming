# Windows／Mac 共用的项目技能

`.agents/skills` 是这四个技能唯一维护的源码位置：

| 技能 | 用途 |
|---|---|
| character-uv-repack-pipeline | 碎片 UV、顶点膨胀、重排与重烘焙验收 |
| repair-swimmer-textures | 贴图阴影修复、泳装泳帽遮罩与换色 |
| speed-swimming-action-sampling | T-pose 导入、骨骼复用、重定向、动作采样 |
| blender-superskill | 参考图建模、结构与视口检查、分步脚本 |

技能正文、references、scripts、agents 和 assets 全部随项目 Git 同步。以后在任何电脑积累新的 UV 或模型经验，直接修改对应仓库文件并提交。不要再从旧 ZIP 安装这四个技能；旧 ZIP 是历史备份。UI 技能暂保留原来的 `tools/codex-skills` 管理方式。

## 首次接入另一台电脑

在该电脑的项目目录里拉取包含本次迁移的提交，然后用 Codex 打开这个项目。Codex 会发现项目的 `.agents/skills`，无需每次复制到个人目录。

如果之前安装过用户级副本，先检查：

```bash
python3 scripts/manage-project-skills.py
```

备份并移出同名旧技能：

```bash
python3 scripts/manage-project-skills.py --archive-user-copies
```

Windows 使用 `python` 替代 `python3`。脚本仅处理仓库中这四个同名技能，默认检查 `~/.codex/skills`（或 `CODEX_HOME/skills`）及 `~/.agents/skills`。备份位于本机 Codex 目录的 `backups/project-skills/`，输出包含原路径与备份路径。如果旧副本里有尚未同步的经验，从备份比较后合并到仓库。

旧路径下只保留 Python 脚本转发入口，无 `SKILL.md`，因此不会再被识别成第二份技能。历史脚本即使还引用原个人路径，也会执行仓库里的最新版 Python 工具。模型源文件和其他技能不会被迁移。若目录是已有链接，检查工具会报告而不自动改动它。

下一轮任务检查是否能看到四个技能；没有刷新时重启 Codex。只打开项目外的空白任务时，不会自动加载这些项目技能。

## 日常双机同步

1. 开工前，确认本地改动已妥善处理，再拉取：`git pull --ff-only`。
2. 修改 `.agents/skills/<技能名>/` 中的经验或脚本，完成相应验证。
3. 只提交本次相关文件，再正常 `git push`。
4. 另一台电脑拉取同一分支后即得到更新，无需再跑安装程序。

两边同时改了同一技能时，通过 Git 合并；不要以目录覆盖的方式丢弃一端修改。检查工具不会自动提交、推送、拉取或修改全局 Codex 配置。

## 本机路径与运行依赖

技能中的 `tools/`、`assets/` 等项目路径均相对当前 checkout。技能内部的 `scripts/`、`references/`、`assets/` 则相对该技能目录。不要把 Windows 盘符或 Mac 用户目录写回共享源码。

普通脚本使用 Python 3.10+；Windows 常用 `python`，macOS 常用 `python3`。图片处理依赖 Pillow／NumPy 时，使用本机单独安装的 Python 环境。含 `bpy`、`bmesh`、`mathutils` 的脚本必须在 Blender Python 内运行；普通虚拟环境不自动为 Blender 提供依赖。

需要后台 Blender 时，统一使用 `scripts/run-blender.py`。它读取以下优先级：`--blender` 参数、`BLENDER_EXECUTABLE` 环境变量、`.agents/local.json`、PATH 中的 blender、Mac 标准应用路径。只启动独立后台进程，并将脚本异常转换成非零退出码。

非标准安装位置可将 `.agents/local.example.json` 复制为 `.agents/local.json`，填写本机 Blender 可执行文件绝对路径。`local.json` 已被 Git 忽略，不能提交个人路径。Windows JSON 路径可使用正斜杠；Mac 标准路径为 `/Applications/Blender.app/Contents/MacOS/Blender`。

只检查解析出的命令，不启动 Blender：

```bash
python3 scripts/run-blender.py --dry-run -- --version
```

在模型副本上执行 UV 审计：

```bash
python3 scripts/run-blender.py -- "tools/你的模型副本.blend" --python .agents/skills/character-uv-repack-pipeline/scripts/audit_character_uv.py -- --output temp/uv-audit.json
```

MCP 的短操作和后台任务选择继续遵循根目录 `AGENTS.md`。后台进程只能看到已保存文件，不自动同步窗口中的未保存修改。MCP 中调用项目脚本可用 `runpy.run_path(实际脚本绝对路径, run_name='__main__')`，避免漏设 `__file__` 和入口。

动作技能直接引用的 `tools/retarget-mixamo-swimming.py` 与 `tools/sample-debug-actions.py` 已改为从自身位置定位项目。其他历史脚本、源 FBX、工作 .blend 仍可能存在独立路径和依赖，执行前核对；它们不因技能同步而自动变成跨平台。尤其旧采样脚本的默认目标可能仍是早期角色，不能直接当作当前 T-pose 角色的批量入口。

`.gitignore` 中的 `/tools` 会忽略新增文件，但已有跟踪文件仍会同步。需要长期维护的新工具应放入被跟踪的技能 `scripts/` 或项目 `scripts/`；不要为此把整个素材和临时文件目录强行加入 Git。

Blender MCP 在每台机器独立安装、连接；Python 环境、MCP 配置、代理、登录凭据和 Cocos 缓存各自保留。版本参考为 Blender 5.1.2、Blender MCP 1.9.1、Cocos Creator 3.8.8，迁移技能不会自动升级这些软件。

## 验证

```bash
python3 scripts/manage-project-skills.py
python3 -m unittest discover -s tests -p test_project_skills.py
```

检查覆盖技能格式、引用文件、Python 语法和明显的机器专属路径；测试覆盖迁移备份、兼容入口、跨目录定位和启动参数。它们不替代 Blender 的模型／动作视觉验证或 Cocos 实机验证。

TypeScript 检查在 Windows 使用根 `AGENTS.md` 的 `npx.cmd` 命令，macOS 改用 `npx`，保留 TypeScript 5.4.5 和其余参数。

来源：[OpenAI 项目技能说明](https://learn.chatgpt.com/docs/build-skills)。
