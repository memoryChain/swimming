#!/usr/bin/env python3
"""从项目根目录启动独立后台 Blender，运行时读取本机可执行路径。"""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess

PROJECT_ROOT = Path(__file__).resolve().parents[1]


def find_blender(explicit=None, project_root=PROJECT_ROOT):
    candidate = explicit or os.environ.get('BLENDER_EXECUTABLE')
    if not candidate:
        config = project_root / '.agents' / 'local.json'
        if config.is_file():
            candidate = json.loads(config.read_text(encoding='utf-8-sig')).get('blender_executable')
    if candidate:
        resolved = shutil.which(candidate) or str(Path(candidate).expanduser())
        path = Path(resolved)
        if not path.is_absolute():
            path = project_root / path
        if path.is_file():
            return path.resolve()
        raise FileNotFoundError('配置的 Blender 不存在：' + str(path))
    found = shutil.which('blender')
    if found:
        return Path(found).resolve()
    mac = Path('/Applications/Blender.app/Contents/MacOS/Blender')
    if mac.is_file():
        return mac
    raise FileNotFoundError('未找到 Blender。请在 .agents/local.json 设置 blender_executable，或传入 --blender。')


def build_command(binary, arguments):
    arguments = list(arguments)
    if arguments[:1] == ['--']:
        arguments.pop(0)
    if not arguments:
        arguments = ['--version']
    return [str(binary), '--background', '--python-exit-code', '1', *arguments]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--blender', help='覆盖本机 Blender 可执行文件路径')
    parser.add_argument('--dry-run', action='store_true', help='只输出命令，不启动 Blender')
    parser.add_argument('arguments', nargs=argparse.REMAINDER)
    args = parser.parse_args()
    command = build_command(find_blender(args.blender), args.arguments)
    if args.dry_run:
        print(json.dumps({'cwd': str(PROJECT_ROOT), 'command': command}, ensure_ascii=False, indent=2))
        return 0
    return subprocess.run(command, cwd=PROJECT_ROOT).returncode


if __name__ == '__main__':
    raise SystemExit(main())
