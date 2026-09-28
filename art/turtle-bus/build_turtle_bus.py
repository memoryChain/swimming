"""海龟班车统一重建入口，配方与通用网格工具分开维护。"""
from pathlib import Path
import runpy
if __name__ == '__main__':
    runpy.run_path(str(Path(__file__).with_name('build_refined.py')), run_name='__main__')