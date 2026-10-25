"""The data folder: the database, the secret key and the datasets' files.

It is platformdirs' user data folder (~/.local/share/dji-thermal-ui, %LOCALAPPDATA%\\dji-thermal-ui), or the folder
in DJI_THERMAL_UI_DATA_DIR, which the CLI's --data-dir sets.
"""

import os
from pathlib import Path

import platformdirs

ENV_VAR = "DJI_THERMAL_UI_DATA_DIR"


def data_dir():
    """The data folder, made with its datasets/ folder if missing"""
    d = os.environ.get(ENV_VAR)
    d = Path(d).expanduser() if d else Path(platformdirs.user_data_dir("dji-thermal-ui", appauthor=False))
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
