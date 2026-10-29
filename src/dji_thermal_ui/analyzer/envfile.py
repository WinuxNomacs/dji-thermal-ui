"""The values the app keeps in .env files (the Mapbox token, WebODM's address and login): a name from the environment,
else from the first of the settings' ENV_FILES that has it. The System Settings page writes them in place of those
there, in the file they were read from, else the data folder's (the last in ENV_FILES); a new file is readable by the
user only."""

import os
import re
import tempfile

from django.conf import settings

ENVIRONMENT = 'environment'
# A value written as it is; any other is quoted (the quotes are taken off when read)
PLAIN_RE = re.compile(r'^[A-Za-z0-9_.,:/@+=~%-]*$')


def line_value(line, name):
    """The value of a name's line of a .env file (export, quotes and comments allowed), else None"""
    m = re.match(r'^\s*(?:export\s+)?' + re.escape(name) + r'\s*=\s*(.*?)\s*$', line)
    if not m:
        return None
    value = m.group(1)
    if len(value) >= 2 and value[0] == value[-1] and value[0] in '"\'':
        return value[1:-1]
    return value.split(' #')[0].strip()


def file_value(path, name):
    """A name's value in a .env file (KEY=value lines), or None"""
    try:
        with open(path, encoding='utf-8') as f:
            lines = f.read().splitlines()
    except (OSError, UnicodeDecodeError):
        return None
    for line in lines:
        value = line_value(line, name)
        if value is not None:
            return value or None
    return None


def lookup(name):
    """A name's value and where it comes from: (value, 'environment' | the .env file's path), or (None, None)"""
    value = os.environ.get(name, '').strip()
    if value:
        return value, ENVIRONMENT
    for path in settings.ENV_FILES:
        value = file_value(path, name)
        if value:
            return value, str(path)
    return None, None


def target_file(*names):
    """The .env file values are written to: the one the first of the names found in a file was read from, else the data
    folder's"""
    for name in names:
        value, source = lookup(name)
        if value and source != ENVIRONMENT:
            return source
    return str(settings.ENV_FILES[-1])


def quoted(value):
    """A value as written in a .env file: as it is when plain, else between quotes"""
    if PLAIN_RE.match(value):
        return value
    return ("'" if "'" not in value else '"') + value + ("'" if "'" not in value else '"')


def write(values, path=None):
    """Puts {name: value} in a .env file in place of those there (each name's first line; the others are kept), else
    at the end; a value None takes the name's lines out. A file left as it was is not written. Returns its path"""
    path = path or target_file(*values)
    try:
        with open(path, encoding='utf-8') as f:
            lines = f.read().splitlines()
        mode = os.stat(path).st_mode & 0o777
    except FileNotFoundError:
        if all(v is None for v in values.values()):
            return path
        lines, mode = None, 0o600
    before, lines = lines, list(lines or [])
    for name, value in values.items():
        at = [i for i, x in enumerate(lines) if line_value(x, name) is not None]
        if value is None:
            lines = [x for i, x in enumerate(lines) if i not in at]
        elif at:
            lines[at[0]] = name + '=' + quoted(value)
        else:
            lines.append(name + '=' + quoted(value))
    if lines == before:
        return path
    folder = os.path.dirname(os.path.abspath(path))
    os.makedirs(folder, exist_ok=True)
    fd, temp = tempfile.mkstemp(dir=folder, prefix='.env.')
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as f:
            f.write(''.join(x + '\n' for x in lines))
        os.chmod(temp, mode)
        os.replace(temp, path)
    except BaseException:
        os.unlink(temp)
        raise
    return path
