"""
A DJI drone's MP4: its length, size and drone, the cover picture it carries, and its track, read in plain Python with
no decoder (the browser plays the video). DJI's newer drones (the Matrice 4T among them) write no SRT: a `DJI meta`
data track holds a protobuf sample per frame with the time, position, attitude and gimbal angles.
"""
import datetime
import math
import os
import re
import struct

VIDEO_EXTENSIONS = ('.mp4',)
# DJI's name for a thermal camera's video (DJI_<time>_<index>_T.MP4, or _T_<mission step>.MP4), beside _W, _Z and _V
THERMAL_NAME = re.compile(r'_T(_[^/\\]*)?\.mp4$', re.IGNORECASE)
CONTAINERS = {b'moov', b'trak', b'mdia', b'minf', b'stbl', b'udta', b'ilst', b'covr'}
MP4_EPOCH = datetime.datetime(1904, 1, 1, tzinfo=datetime.timezone.utc)
# The track's columns, in the order of each point
TRACK_FIELDS = ('t', 'lat', 'lon', 'alt', 'abs_alt', 'pitch', 'yaw', 'heading', 'speed')


class NotVideo(Exception):
    pass


def is_video(path):
    return str(path).lower().endswith(VIDEO_EXTENSIONS)


def _boxes(f, start, end):
    """The boxes between start and end: (kind, where its content starts, where it ends)"""
    pos = start
    while pos + 8 <= end:
        f.seek(pos)
        size, kind = struct.unpack('>I4s', f.read(8))
        head = 8
        if size == 1:
            size = struct.unpack('>Q', f.read(8))[0]
            head = 16
        elif size == 0:
            size = end - pos
        if size < head or pos + size > end:
            return
        yield kind, pos + head, pos + size
        pos += size


def _find(f, start, end, *path):
    """The boxes at path under start..end (meta boxes have 4 bytes of version and flags before their children)"""
    for kind, a, b in _boxes(f, start, end):
        if kind != path[0]:
            continue
        if len(path) == 1:
            yield a, b
        else:
            yield from _find(f, a + (4 if kind == b'meta' else 0), b, *path[1:])


def _first(f, start, end, *path):
    return next(_find(f, start, end, *path), None)


def _full(f, box):
    """A full box's content after its version and flags"""
    return _versioned(f, box)[1]


def _versioned(f, box):
    """A full box's version, and its content after its version and flags"""
    f.seek(box[0])
    data = f.read(box[1] - box[0])
    return data[0], data[4:]


def _samples(f, stbl):
    """A track's samples: [(offset, size, time in the track's units)]"""
    box = _first(f, *stbl, b'stsz')
    data = _full(f, box)
    fixed, count = struct.unpack('>II', data[:8])
    sizes = [fixed] * count if fixed else list(struct.unpack('>%dI' % count, data[8:8 + 4 * count]))

    chunk = _first(f, *stbl, b'stco')
    if chunk:
        data = _full(f, chunk)
        n = struct.unpack('>I', data[:4])[0]
        chunks = struct.unpack('>%dI' % n, data[4:4 + 4 * n])
    else:
        data = _full(f, _first(f, *stbl, b'co64'))
        n = struct.unpack('>I', data[:4])[0]
        chunks = struct.unpack('>%dQ' % n, data[4:4 + 8 * n])

    data = _full(f, _first(f, *stbl, b'stsc'))
    n = struct.unpack('>I', data[:4])[0]
    runs = [struct.unpack('>III', data[4 + 12 * i:16 + 12 * i]) for i in range(n)]
    offsets = []
    for i, (first, per_chunk, _desc) in enumerate(runs):
        last = runs[i + 1][0] - 1 if i + 1 < len(runs) else len(chunks)
        for c in range(first - 1, last):
            pos = chunks[c]
            for _ in range(per_chunk):
                if len(offsets) == len(sizes):
                    break
                offsets.append(pos)
                pos += sizes[len(offsets) - 1]

    data = _full(f, _first(f, *stbl, b'stts'))
    n = struct.unpack('>I', data[:4])[0]
    times, t = [], 0
    for i in range(n):
        repeat, delta = struct.unpack('>II', data[4 + 8 * i:12 + 8 * i])
        for _ in range(repeat):
            times.append(t)
            t += delta
    return list(zip(offsets, sizes, times))


def _tracks(f, moov):
    """The moov's tracks: [(handler type, handler name, timescale, duration, sample table, its first sample entry)]"""
    out = []
    for trak in _find(f, *moov, b'trak'):
        mdia = _first(f, *trak, b'mdia')
        if not mdia:
            continue
        hdlr = _full(f, _first(f, *mdia, b'hdlr'))
        version, mdhd = _versioned(f, _first(f, *mdia, b'mdhd'))
        scale, duration = struct.unpack('>IQ', mdhd[16:28]) if version == 1 else struct.unpack('>II', mdhd[8:16])
        stbl = _first(f, *mdia, b'minf', b'stbl')
        stsd = _full(f, _first(f, *stbl, b'stsd')) if stbl else b''
        out.append((hdlr[4:8], hdlr[20:].split(b'\0')[0].decode('latin-1'), scale, duration, stbl, stsd[4:]))
    return out


def _varint(d, i):
    r = s = 0
    while True:
        x = d[i]
        i += 1
        r |= (x & 0x7f) << s
        s += 7
        if x < 128:
            return r, i


def _protobuf(d):
    """A protobuf message as {field: value} (the last of a repeated field): messages nested as dicts, integers signed"""
    out, i = {}, 0
    while i < len(d):
        key, i = _varint(d, i)
        field, wire = key >> 3, key & 7
        if wire == 0:
            v, i = _varint(d, i)
            v = v - (1 << 64) if v >= 1 << 63 else v
        elif wire == 1:
            v = struct.unpack('<d', d[i:i + 8])[0]
            i += 8
        elif wire == 5:
            v = struct.unpack('<f', d[i:i + 4])[0]
            i += 4
        elif wire == 2:
            n, i = _varint(d, i)
            v = d[i:i + n]
            i += n
            try:
                v = _protobuf(v)
            except (IndexError, ValueError, struct.error):
                pass
        else:
            raise ValueError("Wire type {}".format(wire))
        if i > len(d):
            raise ValueError("Truncated")
        out[field] = v
    return out


def _at(message, *path):
    for k in path:
        if not isinstance(message, dict):
            return None
        message = message.get(k)
    return message


def _zeroed(message, *path):
    """A number in a message: protobuf leaves out a field that is zero, so one missing from a message that is there
    is 0; None when the message is not there"""
    *parents, last = path
    parent = _at(message, *parents)
    return parent.get(last, 0) if isinstance(parent, dict) else None


def _number(v, scale=1.0, digits=None):
    if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v):
        return None
    v = v * scale
    return round(v, digits) if digits is not None else v


def _point(t, m):
    """One frame of DJI's metadata as a track point (TRACK_FIELDS): None where it has no position"""
    aircraft = _at(m, 3, 3)
    lat, lon = _at(aircraft, 4, 1, 2), _at(aircraft, 4, 1, 3)
    if not isinstance(lat, float) or not isinstance(lon, float) or (lat == 0 and lon == 0):
        lat = lon = None
    speed = [_number(_zeroed(aircraft, 2, k)) for k in (1, 2, 3)]
    return [round(t, 4),
            round(math.degrees(lat), 8) if lat is not None else None,
            round(math.degrees(lon), 8) if lon is not None else None,
            _number(_zeroed(aircraft, 5, 1), 0.001, 2),
            _number(_zeroed(aircraft, 4, 2), 0.001, 2),
            _number(_zeroed(m, 3, 4, 3, 1), 0.1, 1),
            _number(_zeroed(m, 3, 4, 3, 3), 0.1, 1),
            _number(_zeroed(aircraft, 3, 3), 0.1, 1),
            round(math.hypot(*(s or 0 for s in speed)), 2) if any(s is not None for s in speed) else None]


class Reader:
    """An MP4 opened for reading: info(), track() and cover()"""

    def __init__(self, path):
        self.path = str(path)
        self.f = open(self.path, 'rb')
        try:
            end = self.f.seek(0, os.SEEK_END)
            self.moov = _first(self.f, 0, end, b'moov')
            if not self.moov:
                raise NotVideo("Not an MP4 video")
            self.tracks = _tracks(self.f, self.moov)
        except (struct.error, ValueError, TypeError) as e:
            self.f.close()
            raise NotVideo("Not an MP4 video") from e
        except BaseException:
            self.f.close()
            raise

    def close(self):
        self.f.close()

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()

    def _video(self):
        return next((t for t in self.tracks if t[0] == b'vide'), None)

    def _meta(self):
        return next((t for t in self.tracks if t[0] == b'meta' and t[5][4:8] == b'djmd'), None)

    def _header(self, meta):
        """The first metadata sample's header: (drone, serial)"""
        samples = _samples(self.f, meta[4])
        if not samples:
            return "", ""
        self.f.seek(samples[0][0])
        try:
            m = _protobuf(self.f.read(samples[0][1]))
        except (IndexError, ValueError, struct.error):
            return "", ""
        name, serial = _at(m, 1, 1, 10), _at(m, 1, 1, 5)
        text = (lambda v: v.decode('utf-8', 'replace') if isinstance(v, bytes) else "")
        return text(name).replace("DJI DJI ", "DJI "), text(serial)

    def info(self):
        """{duration (s), frames, fps, width, height, utc (when it started), model, serial, track (whether it has
        one)}"""
        video = self._video()
        if video is None:
            raise NotVideo("The MP4 holds no video")
        _kind, _name, scale, duration, stbl, entry = video
        frames = len(_samples(self.f, stbl)) if stbl else 0
        width, height = struct.unpack('>HH', entry[32:36]) if len(entry) >= 36 else (None, None)
        version, mvhd = _versioned(self.f, _first(self.f, *self.moov, b'mvhd'))
        created = struct.unpack('>Q' if version == 1 else '>I', mvhd[:8 if version == 1 else 4])[0]
        seconds = duration / scale if scale else None
        meta = self._meta()
        model, serial = self._header(meta) if meta else ("", "")
        return {
            'duration': round(seconds, 3) if seconds else None,
            'frames': frames,
            'fps': round(frames / seconds, 3) if seconds and frames else None,
            'width': width,
            'height': height,
            'utc': (MP4_EPOCH + datetime.timedelta(seconds=created)).strftime('%Y-%m-%dT%H:%M:%SZ') if created else "",
            'model': model,
            'serial': serial,
            'track': meta is not None,
        }

    def track(self):
        """Each frame's place, as rows of TRACK_FIELDS: t (s from the start), lat and lon (degrees), alt (m above
        take-off), abs_alt (m), pitch and yaw (the gimbal's, degrees), heading (the aircraft's, degrees), speed (m/s).
        [] without DJI's metadata"""
        meta = self._meta()
        if meta is None:
            return []
        scale = meta[2] or 1
        points = []
        for offset, size, t in _samples(self.f, meta[4]):
            self.f.seek(offset)
            try:
                m = _protobuf(self.f.read(size))
            except (IndexError, ValueError, struct.error):
                continue
            points.append(_point(t / scale, m))
        return points

    def cover(self):
        """The cover picture DJI puts in the MP4 (a JPEG's bytes), or None"""
        udta = _first(self.f, *self.moov, b'udta')
        box = udta and _first(self.f, *udta, b'meta', b'ilst', b'covr', b'data')
        if not box:
            return None
        self.f.seek(box[0] + 8)     # the data box's type and locale
        picture = self.f.read(box[1] - box[0] - 8)
        return picture if picture[:2] == b'\xff\xd8' else None


def summary(path):
    """What a flight's analysis keeps of a video: its info, and its first position (lat, lon) when it has a track.
    Raises NotVideo for a file that is not one"""
    with Reader(path) as r:
        info = r.info()
        if info['track']:
            first = next((p for p in r.track() if p[1] is not None), None)
            info['lat'], info['lon'] = (first[1], first[2]) if first else (None, None)
        return info
