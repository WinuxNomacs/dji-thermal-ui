"""scripts/publish_docs.py: the built documentation committed in a clone of its public repository, never pushed"""

import importlib.util
import subprocess

import pytest

from tests.test_script import ROOT

spec = importlib.util.spec_from_file_location("publish_docs", ROOT / "scripts" / "publish_docs.py")
publish_docs = importlib.util.module_from_spec(spec)
spec.loader.exec_module(publish_docs)


def git(d, *args):
    return subprocess.run(["git", "-C", str(d), *args], check=True, capture_output=True, text=True).stdout


@pytest.fixture
def site(tmp_path):
    d = tmp_path / "site"
    (d / "guide" / "storage").mkdir(parents=True)
    (d / "index.html").write_text("start")
    (d / "guide" / "storage" / "index.html").write_text("storage")
    return d


@pytest.fixture
def checkout(tmp_path):
    """A clone of the documentation's repository, with its README and a page an earlier version had"""
    d = tmp_path / "checkout"
    d.mkdir()
    git(d, "init", "--quiet", "--initial-branch", "main")
    git(d, "config", "user.name", "Test")
    git(d, "config", "user.email", "test@example.com")
    (d / "README.md").write_text("the docs")
    (d / "old").mkdir()
    (d / "old" / "index.html").write_text("gone")
    git(d, "add", "--all")
    git(d, "commit", "--quiet", "--message", "first")
    return d


def test_the_site_replaces_the_checkouts_pages_and_is_committed_there(site, checkout):
    assert publish_docs.publish(site, checkout, "The documentation of dji-thermal-ui 1.0.0 (abc1234)")
    assert sorted(git(checkout, "ls-files").split()) == [".nojekyll", "README.md", "guide/storage/index.html",
                                                         "index.html"]
    assert git(checkout, "log", "-1", "--format=%s").strip() == "The documentation of dji-thermal-ui 1.0.0 (abc1234)"
    assert git(checkout, "status", "--porcelain") == ""


def test_the_same_site_again_commits_nothing(site, checkout):
    publish_docs.publish(site, checkout, "once")
    assert not publish_docs.publish(site, checkout, "twice")
    assert git(checkout, "log", "-1", "--format=%s").strip() == "once"


def test_a_checkout_with_changes_of_its_own_is_left_alone(site, checkout):
    (checkout / "README.md").write_text("edited")
    with pytest.raises(SystemExit, match="changes of its own"):
        publish_docs.publish(site, checkout, "no")
    assert (checkout / "old" / "index.html").exists()


def test_a_folder_that_isnt_a_clone_or_a_site_not_built_is_refused(site, checkout, tmp_path):
    with pytest.raises(SystemExit, match="not a clone"):
        publish_docs.publish(site, tmp_path, "no")
    with pytest.raises(SystemExit, match="no documentation built"):
        publish_docs.publish(tmp_path / "none", checkout, "no")
