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
4. **Screenshots** are made by `scripts/screenshots.mjs`, never edited by hand: after a change to a page they show,
   run `npm run screenshots -- <a flight's images>` (on the machine with the test flight: the images of
   "m4t-test-flights") and commit the shots that changed. It runs its own instance on 8081 with scratch folders,
   takes several minutes (upload, analysis, conversion, mosaics), and fails a shot that shows the flight's
   coordinates; it masks the serial numbers and the data folder's path. `--keep DIR` keeps its data, so a second run
   skips straight to the shots after the dataset. A new shot goes in the script and on a page: `tests/test_docs.py`
   fails on a shot no page shows. The banner (the README's and the home page's) is made from its source,
   `branding/dji-thermal-analyzer.jpg`, by `uv run scripts/banner.py`; replace the source, never the copies.
5. **Check it:** `uv run --only-group docs zensical build --strict` (fails on a broken link) and
   `uv run pytest tests/test_docs.py` (a missing picture, a page not in the navigation, a link to a heading that
   isn't there). Look at a changed page with
   `uv run --only-group docs zensical serve`, or at `/help/` on an instance of the branch.
6. **The README** keeps only what the app is (a short list linking to the guide's pages), Install, Run, Development
   and Licence: change its list only when a part of the app is added or removed, and Install or Run when they change.
   Its banner is the docs site's copy (an address on the site, so it shows on PyPI too).
7. Commit the docs with the change, on the same branch.

## At a release

The user pushes and tags. After the release branch is merged, offer to run
`uv run --no-project python scripts/publish_docs.py <clone of dji-thermal-ui-docs>`: it builds the docs and commits
them in that clone, and never pushes. Say that pushing that clone publishes the site.
