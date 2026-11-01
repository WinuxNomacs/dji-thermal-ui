"""The documentation's sources (docs/, zensical.toml): what the strict build doesn't check"""

import re
import tomllib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DOCS = ROOT / "docs"
# A picture in Markdown, ![text](path "title"), or in HTML, <img src="path">
PICTURE = re.compile(r'!\[[^\]]*\]\(\s*<?([^)\s>]+)|<img\b[^>]*\bsrc="([^"]+)"')


def nav_pages(entries):
    for entry in entries:
        if isinstance(entry, str):
            yield entry
        else:
            for value in entry.values():
                yield from (nav_pages(value) if isinstance(value, list) else [value])


def test_every_picture_a_page_shows_is_in_the_docs():
    missing = []
    for page in DOCS.rglob("*.md"):
        for match in PICTURE.finditer(page.read_text(encoding="utf-8")):
            src = match.group(1) or match.group(2)
            if not re.match(r"[a-z]+:", src) and not (page.parent / src).resolve().is_file():
                missing.append(f"{page.relative_to(DOCS)}: {src}")
    assert missing == []


def test_every_page_is_in_the_navigation_and_every_entry_is_a_page():
    nav = list(nav_pages(tomllib.loads((ROOT / "zensical.toml").read_text(encoding="utf-8"))["project"]["nav"]))
    pages = sorted(p.relative_to(DOCS).as_posix() for p in DOCS.rglob("*.md"))
    assert sorted(nav) == pages
