"""The WebODM password as a .env file keeps it: encrypted with Fernet (AES with a fresh random IV each time, so the same
password never reads the same twice, and an HMAC that catches a changed value), written as enc:<token>. The key is made
once and kept in the database (EncryptionKey), not beside it, so a .env file alone doesn't give the password away. A
value without the prefix (typed by hand, or set in the environment) is read as it is."""

from cryptography.fernet import Fernet, InvalidToken

PREFIX = 'enc:'
KEY_ID = 1


class Unreadable(Exception):
    """An encrypted value the key can't open: the database replaced, or the value changed"""


def _fernet(make):
    """The key's Fernet, made the first time when make; None when there is none"""
    from .models import EncryptionKey
    row = EncryptionKey.objects.filter(pk=KEY_ID).first()
    if row is None:
        if not make:
            return None
        row, _created = EncryptionKey.objects.get_or_create(pk=KEY_ID,
                                                            defaults={'key': Fernet.generate_key().decode()})
    return Fernet(row.key.encode())


def is_encrypted(value):
    return bool(value) and value.startswith(PREFIX)


def encrypt(text):
    return PREFIX + _fernet(make=True).encrypt(text.encode()).decode()


def decrypt(value):
    """A value as typed: an encrypted one opened (Unreadable when it can't be), any other as it is"""
    if not is_encrypted(value):
        return value
    fernet = _fernet(make=False)
    if fernet is None:
        raise Unreadable()
    try:
        return fernet.decrypt(value[len(PREFIX):].encode()).decode()
    except (InvalidToken, UnicodeDecodeError):
        raise Unreadable() from None


def forget():
    """Deletes the key: what it encrypted can't be read again"""
    from .models import EncryptionKey
    EncryptionKey.objects.filter(pk=KEY_ID).delete()
