"""The data folder: the database, the secret key and the datasets' files.

It is the folder in DJI_THERMAL_UI_DATA_DIR, which the CLI's --data-dir sets; else the folder it was moved to from the
Storage page, written in the pointer file in the app's config folder; else platformdirs' user data folder
(~/.local/share/dji-thermal-ui, %LOCALAPPDATA%\\dji-thermal-ui).
"""

import os
from pathlib import Path

import platformdirs

ENV_VAR = "DJI_THERMAL_UI_DATA_DIR"
CONFIG_ENV_VAR = "DJI_THERMAL_UI_CONFIG_DIR"
POINTER = "data-dir"


class DataDirError(Exception):
    """The data folder cannot be used, as the command says it"""


def default_dir():
    return Path(platformdirs.user_data_dir("dji-thermal-ui", appauthor=False))


def config_dir():
    """The app's config folder (~/.config/dji-thermal-ui, %LOCALAPPDATA%\\dji-thermal-ui, or the one in
    DJI_THERMAL_UI_CONFIG_DIR): the pointer, a move asked"""
    d = os.environ.get(CONFIG_ENV_VAR)
    return Path(d).expanduser() if d else Path(platformdirs.user_config_dir("dji-thermal-ui", appauthor=False))


def pointer():
    """The folder the data was moved to, or None"""
    try:
        d = (config_dir() / POINTER).read_text(encoding="utf-8").strip()
    except OSError:
        return None
    return Path(d) if d else None


def set_pointer(d):
    """Remembers the folder the data was moved to (none for the default one)"""
    f = config_dir() / POINTER
    if d is None or Path(d).resolve() == default_dir().resolve():
        f.unlink(missing_ok=True)
        return
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text(str(d), encoding="utf-8")


def chosen():
    """The data folder and what chose it: 'environment' (--data-dir or the variable), 'moved' or 'default'"""
    d = os.environ.get(ENV_VAR)
    if d:
        return Path(d).expanduser(), 'environment'
    d = pointer()
    if d is not None:
        return d, 'moved'
    return default_dir(), 'default'


def data_dir():
    """The data folder, made with its datasets/ folder if missing (but not a moved one: its drive may be away)"""
    d, by = chosen()
    if by == 'moved' and not d.is_dir():
        raise DataDirError("The data folder {} (moved there from the Storage page) is missing: is its drive "
                           "connected? Start with --data-dir to use another folder.".format(d))
    (d / "datasets").mkdir(parents=True, exist_ok=True)
    return d.resolve()


def secret_key(d):
    """Django's secret key, made once into the data folder and read from it after"""
    f = Path(d) / "secret_key"
    if f.is_file():
        key = f.read_text(encoding="utf-8").strip()
        if key:
            return key
    from django.core.management.utils import get_random_secret_key
    key = get_random_secret_key()
    f.write_text(key, encoding="utf-8")
    try:
        f.chmod(0o600)
    except OSError:                                # not every file system keeps modes
        pass
    return key
