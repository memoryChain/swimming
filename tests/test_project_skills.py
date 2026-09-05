import ast
import importlib.util
import json
import os
from pathlib import Path
import runpy
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


manage = load('manage_project_skills', ROOT / 'scripts' / 'manage-project-skills.py')
launcher = load('run_blender', ROOT / 'scripts' / 'run-blender.py')


class ProjectSkillsTests(unittest.TestCase):
    def test_repository_skills_and_references(self):
        names, errors = manage.check_skills(ROOT)
        self.assertEqual(len(names), 4)
        self.assertEqual(errors, [])

    def test_archive_preserves_custom_edits_and_forwards_to_live_source(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp).resolve()
            project = root / '含空格 项目'
            source = project / '.agents' / 'skills' / 'fixture-skill'
            (source / 'scripts').mkdir(parents=True)
            (source / 'SKILL.md').write_text('---\nname: fixture-skill\ndescription: 测试技能\n---\n', encoding='utf-8')
            script = source / 'scripts' / 'helper.py'
            script.write_text('VALUE = 1\n', encoding='utf-8')
            user = root / 'user-skills'
            old = user / 'fixture-skill'
            old.mkdir(parents=True)
            (old / 'SKILL.md').write_text('用户未同步的经验', encoding='utf-8')
            (old / 'custom.txt').write_text('独有笔记', encoding='utf-8')
            result = manage.migrate(project, [user], apply=False)
            self.assertEqual(len(result), 1)
            self.assertTrue((old / 'SKILL.md').exists())
            result = manage.migrate(project, [user], apply=True, backup_root=root / 'backups')
            backup = Path(result[0]['backup'])
            self.assertEqual((backup / 'custom.txt').read_text(encoding='utf-8'), '独有笔记')
            self.assertFalse((old / 'SKILL.md').exists())
            alias = old / 'scripts' / 'helper.py'
            self.assertEqual(runpy.run_path(str(alias))['VALUE'], 1)
            script.write_text('VALUE = 2\n', encoding='utf-8')
            self.assertEqual(runpy.run_path(str(alias))['VALUE'], 2)
            self.assertEqual(runpy.run_path(str(alias))['__file__'], str(script))
            before = alias.read_bytes()
            manage.migrate(project, [user], apply=True, backup_root=root / 'backups')
            self.assertEqual(alias.read_bytes(), before)

    def test_invalid_source_does_not_archive_user_copy(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source = root / 'project' / '.agents' / 'skills' / 'broken'
            source.mkdir(parents=True)
            (source / 'SKILL.md').write_text('无元数据', encoding='utf-8')
            old = root / 'user' / 'broken'
            old.mkdir(parents=True)
            (old / 'SKILL.md').write_text('保留', encoding='utf-8')
            with self.assertRaises(ValueError):
                manage.migrate(root / 'project', [root / 'user'], apply=True)
            self.assertTrue((old / 'SKILL.md').exists())

    def test_launcher_local_config_and_override(self):
        with tempfile.TemporaryDirectory() as temp:
            project = Path(temp).resolve()
            (project / '.agents').mkdir()
            binary = project / 'Blender 空格' / 'blender'
            binary.parent.mkdir()
            binary.touch()
            override = project / '另一个blender'
            override.touch()
            (project / '.agents' / 'local.json').write_text(json.dumps({'blender_executable': str(binary)}), encoding='utf-8')
            with patch.dict(os.environ, {}, clear=True):
                self.assertEqual(launcher.find_blender(project_root=project), binary)
                self.assertEqual(launcher.find_blender(str(override), project), override)
            with patch.dict(os.environ, {'BLENDER_EXECUTABLE': str(override)}):
                self.assertEqual(launcher.find_blender(project_root=project), override)
            command = launcher.build_command(binary, ['--', '模型 空格.blend', '--python', '工具.py', '--', '--output', '报告 空格.json'])
            self.assertEqual(command[0], str(binary))
            self.assertIn('模型 空格.blend', command)
            self.assertEqual(command[-3:], ['--', '--output', '报告 空格.json'])
            self.assertLess(command.index('--python-exit-code'), command.index('--python'))

    def test_retarget_and_sampler_find_relocated_project(self):
        for name in ['retarget-mixamo-swimming.py', 'sample-debug-actions.py']:
            tree = ast.parse((ROOT / 'tools' / name).read_text(encoding='utf-8'))
            node = next(n for n in tree.body if isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id == 'PROJECT_ROOT' for t in n.targets))
            with tempfile.TemporaryDirectory() as temp:
                project = Path(temp).resolve() / '另一个项目'
                fake_script = project / 'tools' / name
                value = eval(compile(ast.Expression(node.value), name, 'eval'), {'os': os, '__file__': str(fake_script)})
                self.assertEqual(Path(value), project)


if __name__ == '__main__':
    unittest.main()
