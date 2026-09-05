#!/usr/bin/env python3
"""检查仓库技能；可备份用户目录旧副本并保留脚本兼容入口。"""
import argparse
import ast
from datetime import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import shutil

PROJECT_ROOT = Path(__file__).resolve().parents[1]
MARKER = '.project-skill-compat.json'


def check_skills(project_root=PROJECT_ROOT):
    skill_root = project_root / '.agents' / 'skills'
    names = []
    errors = []
    for folder in sorted(skill_root.iterdir()):
        if not folder.is_dir():
            continue
        entry = folder / 'SKILL.md'
        if not entry.is_file():
            errors.append('缺少技能入口：' + str(entry))
            continue
        names.append(folder.name)
        text = entry.read_text(encoding='utf-8-sig')
        match = re.match(r'^---\s*\n(.*?)\n---', text, re.S)
        if not match or not re.search(r'^name:\s*' + re.escape(folder.name) + r'\s*$', match.group(1), re.M) or not re.search(r'^description:\s*\S', match.group(1), re.M):
            errors.append('技能名称或描述不合法：' + str(entry))
        for path in folder.rglob('*'):
            if not path.is_file() or '__pycache__' in path.parts:
                continue
            if path.suffix in {'.md', '.py', '.yaml'}:
                content = path.read_text(encoding='utf-8-sig')
                if re.search(r'(?<![A-Za-z])[A-Za-z]:[\\/]', content) or '$env:USERPROFILE' in content:
                    errors.append('发现机器专属路径：' + str(path))
                if path.suffix == '.py':
                    try:
                        ast.parse(content)
                    except SyntaxError as exc:
                        errors.append(str(path) + ': ' + str(exc))
                if path.suffix == '.md':
                    for target in re.findall(r'\]\(([^)]+)\)', content):
                        if '://' in target or target.startswith('#'):
                            continue
                        target = target.split('#')[0]
                        if target and not (path.parent / target).exists():
                            errors.append('引用文件不存在：' + str(path) + ' -> ' + target)
    if not names:
        errors.append('未发现项目技能。')
    return names, errors


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def make_compatibility(target, source):
    """旧工具可继续导入脚本，但此目录不再提供 SKILL.md。"""
    target.mkdir(parents=True, exist_ok=True)
    files = {}
    for script in sorted((source / 'scripts').rglob('*.py')):
        if '__pycache__' in script.parts:
            continue
        relative = script.relative_to(source)
        output = target / relative
        output.parent.mkdir(parents=True, exist_ok=True)
        content = (
            '# 本机兼容入口；共享源码由项目 Git 管理。\n'
            'from pathlib import Path as _ProjectSkillPath\n'
            f'_project_skill_source = _ProjectSkillPath({str(script.resolve())!r})\n'
            "__file__ = str(_project_skill_source)\n"
            "exec(compile(_project_skill_source.read_text(encoding='utf-8-sig'), __file__, 'exec'), globals())\n"
        )
        output.write_text(content, encoding='utf-8')
        files[relative.as_posix()] = digest(output)
    (target / MARKER).write_text(json.dumps({'source': str(source.resolve()), 'files': files}, ensure_ascii=False, indent=2), encoding='utf-8')


def user_roots():
    codex_dir = Path(os.environ.get('CODEX_HOME', str(Path.home() / '.codex'))).expanduser()
    return [codex_dir / 'skills', Path.home() / '.agents' / 'skills']


def migrate(project_root, roots, apply=False, backup_root=None):
    names, errors = check_skills(project_root)
    if errors:
        raise ValueError('\n'.join(errors))
    results = []
    plans = []
    visited = set()
    for root in roots:
        root = root.expanduser().resolve()
        if root in visited:
            continue
        visited.add(root)
        for name in names:
            source = project_root / '.agents' / 'skills' / name
            candidate = root / name
            if not candidate.exists():
                continue
            if candidate.resolve() == source.resolve():
                results.append({'path': str(candidate), 'status': '已经指向仓库，未改动'})
                continue
            if candidate.is_symlink() or getattr(candidate, 'is_junction', lambda: False)():
                results.append({'path': str(candidate), 'status': '外部链接，未改动；请核对重复来源'})
                continue
            if candidate.resolve().parent != root:
                raise ValueError('目标超出预期用户技能目录：' + str(candidate))
            if not (candidate / 'SKILL.md').is_file():
                if (candidate / MARKER).is_file():
                    marker = json.loads((candidate / MARKER).read_text(encoding='utf-8'))
                    status = '已有兼容入口' if marker['source'] == str(source.resolve()) else '兼容入口指向其他项目位置，未改动'
                    results.append({'path': str(candidate), 'status': status})
                continue
            item = {'name': name, 'path': str(candidate), 'status': '待备份的用户技能副本'}
            results.append(item)
            plans.append((candidate, source, item))
    if apply and plans:
        base = backup_root or Path(os.environ.get('CODEX_HOME', str(Path.home() / '.codex'))) / 'backups' / 'project-skills'
        backup = base.expanduser().resolve() / datetime.now().strftime('%Y%m%d-%H%M%S-%f')
        if any(candidate.resolve() == backup or candidate.resolve() in backup.parents for candidate, _, _ in plans):
            raise ValueError('备份目录不能位于待迁移技能内部。')
        backup.mkdir(parents=True, exist_ok=False)
        for index, (candidate, source, item) in enumerate(plans):
            saved = backup / (str(index) + '-' + candidate.name)
            # 先完整复制并校验，再从扫描目录移走旧副本。
            shutil.copytree(candidate, saved)
            old_files = [p for p in candidate.rglob('*') if p.is_file()]
            if any(digest(p) != digest(saved / p.relative_to(candidate)) for p in old_files):
                raise RuntimeError('备份校验失败，保留原目录：' + str(candidate))
            # move 的两个绝对路径均在上面核实的用户技能目录和备份目录内。
            moved = backup / (str(index) + '-' + candidate.name + '-original')
            shutil.move(str(candidate), str(moved))
            item.update(status='已备份并移出技能扫描目录', backup=str(moved), verified_copy=str(saved))
            (backup / 'migration.json').write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding='utf-8')
            make_compatibility(candidate, source)
    return results


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--archive-user-copies', action='store_true', help='备份并迁移同名用户技能；默认只检查')
    parser.add_argument('--user-skills', action='append', type=Path, help='显式指定用户技能目录，可重复')
    args = parser.parse_args()
    names, errors = check_skills()
    if errors:
        raise SystemExit('\n'.join(errors))
    result = {'project_skills': names, 'source': str(PROJECT_ROOT / '.agents' / 'skills'), 'user_copies': migrate(PROJECT_ROOT, args.user_skills or user_roots(), args.archive_user_copies)}
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
