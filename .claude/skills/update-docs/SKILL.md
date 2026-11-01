---
name: update-docs
description: Keep the documentation (docs/, served at /help/ and on the public docs site) true to a change on the branch. Use when a change adds, changes or removes something a user sees or does, and before merging it.
---

# Updating the documentation

The documentation is `docs/` (Markdown), laid out in `zensical.toml`'s `nav`, built by Zensical into
`src/dji_thermal_ui/static/docs/` (gitignored). The app serves it at `/help/`, the wheel carries it, and the public
`dji-thermal-ui-docs` repository serves a copy with GitHub Pages.

## On the branch of every change a user sees

1. **Find the pages it touches.** The user guide has a page per part of the app (`docs/guide/`), named as the app
   names it; the header's Help opens the one for each page (`HELP_PAGES` in `frontend/src/components/header.tsx`).
   Also check Getting started, the Quickstart tutorials and Reference (the command, the data folder).
2. **Write what changed as the user sees it**: the page and the panel or tab, the control's own label, what it does.
   Write it in the guide's present tense, not as news: the CHANGELOG says what changed.
3. **A new page** goes in `zensical.toml`'s `nav` (`tests/test_docs.py` fails otherwise). A new app page gets an entry
   in `HELP_PAGES`, with its address in the header test (`frontend/tests/header.test.tsx`), which also checks the
   page exists in `docs/`.
4. **Screenshots** of a page that changed are made again with the screenshot script, once W3 has added it; never edit
   one by hand. No GPS coordinate, address or basemap may show in one.
5. **Check it:** `uv run --only-group docs zensical build --strict` (fails on a broken link) and
   `uv run pytest tests/test_docs.py` (a missing picture, a page not in the navigation). Look at a changed page with
   `uv run --only-group docs zensical serve`, or at `/help/` on an instance of the branch.
6. Commit the docs with the change, on the same branch.

## At a release

The user pushes and tags. After the release branch is merged, offer to run
`uv run --no-project python scripts/publish_docs.py <clone of dji-thermal-ui-docs>`: it builds the docs and commits
them in that clone, and never pushes. Say that pushing that clone publishes the site.
