"""Put the documentation in its public repository: python scripts/publish_docs.py CHECKOUT

CHECKOUT is a clone of the public dji-thermal-ui-docs repository, which GitHub Pages serves from its main branch.
The script builds the documentation strictly (zensical.toml), replaces what the checkout holds with it (keeping
its .git, README.md and LICENSE), adds .nojekyll so Pages serves it as it is, and commits it there, naming this
version and commit. It never pushes: push the checkout yourself. Standard library only.
"""

from __future__ import annotations

import shutil
import subprocess
import sys
import tomllib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SITE = ROOT / "src" / "dji_thermal_ui" / "static" / "docs"
KEPT = {".git", "README.md", "LICENSE"}


def git(checkout: Path, *args: str) -> str:
    return subprocess.run(["git", "-C", str(checkout), *args], check=True, capture_output=True, text=True).stdout


def publish(site: Path, checkout: Path, message: str) -> bool:
    """Replaces the checkout's site with the one built and commits it; False when nothing changed"""
    if not (site / "index.html").is_file():
        raise SystemExit(f"no documentation built in {site}")
    if not (checkout / ".git").exists():
        raise SystemExit(f"{checkout} is not a clone of the documentation's repository")
    if git(checkout, "status", "--porcelain"):
        raise SystemExit(f"{checkout} has changes of its own: commit or discard them first")
    for path in checkout.iterdir():
        if path.name not in KEPT:
            shutil.rmtree(path) if path.is_dir() else path.unlink()
    shutil.copytree(site, checkout, dirs_exist_ok=True)
    (checkout / ".nojekyll").touch()
    git(checkout, "add", "--all")
    if not git(checkout, "status", "--porcelain"):
        return False
    git(checkout, "commit", "--quiet", "--message", message)
    return True


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print(__doc__.splitlines()[0])
        return 2
    checkout = Path(argv[1]).resolve()
    subprocess.run(["uv", "run", "--locked", "--only-group", "docs", "zensical", "build", "--strict", "--clean"],
                   cwd=ROOT, check=True)
    version = tomllib.loads((ROOT / "pyproject.toml").read_text(encoding="utf-8"))["project"]["version"]
    commit = git(ROOT, "rev-parse", "--short", "HEAD").strip()
    if publish(SITE, checkout, f"The documentation of dji-thermal-ui {version} ({commit})"):
        print(f"committed in {checkout}: push it with  git -C {checkout} push")
    else:
        print(f"{checkout} already holds this documentation: nothing to commit")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
