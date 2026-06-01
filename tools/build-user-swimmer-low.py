from pathlib import Path
import runpy


SCRIPT = Path(__file__).with_name("build-user-swimmer-remesh-low.py")


if __name__ == "__main__":
    runpy.run_path(str(SCRIPT), run_name="__main__")
