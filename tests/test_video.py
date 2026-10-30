"""A flight's videos: DJI's MP4 read (its info, track and cover), listed by the analysis, uploaded, and served to the
player in ranges"""

import io

import pytest

from dji_thermal_ui.analyzer import thermal_analysis, video
from dji_thermal_ui.analyzer.models import ThermalDataset
from tests.fakes import DATASETS, JPEG, dataset, dji_video, server_folder, video_file

VIDEO = 'DCIM/DJI_20261027151837_0001_T_Waypoint1.MP4'


def test_a_dji_video_gives_its_length_size_drone_and_start(tmp_path):
    info = video.summary(video_file(tmp_path / 'v.mp4', frames=30))
    assert info == {'duration': 1.0, 'frames': 30, 'fps': 30.0, 'width': 640, 'height': 512,
                    'utc': '2026-10-27T20:18:38Z', 'model': 'DJI Matrice 4T', 'serial': 'SN1', 'track': True,
                    'lat': 42.1, 'lon': -88.07}


def test_its_track_has_a_point_per_frame_with_zeros_protobuf_left_out_read_as_zeros(tmp_path):
    with video.Reader(video_file(tmp_path / 'v.mp4', frames=3)) as r:
        points = r.track()
    assert video.TRACK_FIELDS == ('t', 'lat', 'lon', 'alt', 'abs_alt', 'pitch', 'yaw', 'heading', 'speed')
    assert [p[0] for p in points] == [0.0, 0.0333, 0.0667]
    assert [p[1] for p in points] == [42.1, 42.10001, 42.10002]
    first = dict(zip(video.TRACK_FIELDS, points[0]))
    assert (first['lon'], first['alt'], first['abs_alt'], first['yaw'], first['heading']) == \
        (-88.07, 15.2, 222.8, 36.4, -27.0)
    assert first['pitch'] == 0.0        # left out of the first frame's message
    assert points[1][5] == -45.0
    assert first['speed'] == pytest.approx(1.3, abs=0.01)


def test_its_cover_is_the_jpeg_dji_put_in_it(tmp_path):
    with video.Reader(video_file(tmp_path / 'v.mp4')) as r:
        assert r.cover() == JPEG
    with video.Reader(video_file(tmp_path / 'bare.mp4', cover=False)) as r:
        assert r.cover() is None


def test_a_video_without_djis_metadata_has_no_track_and_a_file_that_is_not_one_is_refused(tmp_path):
    with video.Reader(video_file(tmp_path / 'plain.mp4', meta=False)) as r:
        assert r.info()['track'] is False
        assert r.info()['model'] == ""
        assert r.track() == []
    junk = tmp_path / 'junk.mp4'
    junk.write_bytes(b'not a video at all')
    with pytest.raises(video.NotVideo):
        video.Reader(junk)


def test_the_analysis_lists_a_video_with_its_info_and_says_why_one_cannot_be_read(tmp_path):
    root = str(tmp_path)
    video_file(tmp_path / VIDEO)
    video_file(tmp_path / 'DJI_0002_W.MP4')
    (tmp_path / 'broken.mp4').write_bytes(b'nope')
    rows = {r['path']: r for r in [thermal_analysis.video_row(str(tmp_path / p), root)
                                   for p in (VIDEO, 'DJI_0002_W.MP4', 'broken.mp4')]}
    v = rows[VIDEO]
    assert (v['kind'], v['reason'], v['thermal'], v['frames'], v['model'], v['lat']) == \
        ('video', "", True, 3, 'DJI Matrice 4T', 42.1)
    assert v['size'] == len(dji_video())
    assert rows['DJI_0002_W.MP4']['thermal'] is False
    assert rows['broken.mp4']['kind'] == 'video'
    assert rows['broken.mp4']['reason'] == "Not an MP4 video"


def analyzed_with_video(tmp_path, name=VIDEO):
    folder = server_folder(tmp_path, files=('DJI_0001_T.JPG',))
    video_file(tmp_path / name, frames=4)
    return dataset(source='folder', folder=folder, analysis={'files': [
        {'path': 'DJI_0001_T.JPG', 'kind': 'thermal'}, thermal_analysis.video_row(str(tmp_path / name), folder)]})


def test_the_player_gets_the_video_in_ranges_and_only_a_video_the_analysis_lists(api, tmp_path):
    d = analyzed_with_video(tmp_path)
    url = "{}/{}/video".format(DATASETS, d.id)
    whole = dji_video(frames=4)
    res = api.get(url, {'file': VIDEO}, HTTP_RANGE='bytes=0-99')
    assert res.status_code == 206
    assert res['Content-Type'] == 'video/mp4'
    assert res['Content-Range'] == 'bytes 0-99/{}'.format(len(whole))
    assert b''.join(res.streaming_content) == whole[:100]
    res = api.get(url, {'file': VIDEO})
    assert res.status_code == 200
    assert res['Accept-Ranges'] == 'bytes'
    # An image, nothing, or a file not listed: not served as a video
    assert api.get(url, {'file': 'DJI_0001_T.JPG'}).status_code == 404
    assert api.get(url).status_code == 404
    assert api.get(url, {'file': 'other.mp4'}).status_code == 404


def test_the_videos_track_cover_and_thumbnail_are_served(api, tmp_path):
    d = analyzed_with_video(tmp_path)
    res = api.get("{}/{}/video-track".format(DATASETS, d.id), {'file': VIDEO})
    assert res.status_code == 200
    assert res.data['fields'][:3] == ('t', 'lat', 'lon')
    assert len(res.data['points']) == 4
    res = api.get("{}/{}/video-cover".format(DATASETS, d.id), {'file': VIDEO})
    assert (res.status_code, res['Content-Type'], res.content) == (200, 'image/jpeg', JPEG)
    res = api.get("{}/{}/thumbnail".format(DATASETS, d.id), {'file': VIDEO})
    assert res.status_code == 200
    from PIL import Image
    with Image.open(io.BytesIO(res.content)) as im:
        assert max(im.size) <= 96


def test_a_video_without_a_cover_has_none_to_serve(api, tmp_path):
    folder = str(tmp_path)
    video_file(tmp_path / 'v.mp4', cover=False)
    d = dataset(source='folder', folder=folder,
                analysis={'files': [thermal_analysis.video_row(str(tmp_path / 'v.mp4'), folder)]})
    assert api.get("{}/{}/video-cover".format(DATASETS, d.id), {'file': 'v.mp4'}).status_code == 404
    assert api.get("{}/{}/thumbnail".format(DATASETS, d.id), {'file': 'v.mp4'}).status_code == 404


def test_videos_are_uploaded_with_the_images(api):
    from django.core.files.uploadedfile import SimpleUploadedFile
    d = dataset()
    res = api.post("{}/{}/upload".format(DATASETS, d.id), {
        'images': [SimpleUploadedFile('DJI_0001_T.MP4', dji_video(), content_type='video/mp4'),
                   SimpleUploadedFile('flight.srt', b'1', content_type='text/plain')],
        'paths': ['100MEDIA/DJI_0001_T.MP4', '100MEDIA/flight.srt']}, format='multipart')
    assert res.status_code == 200
    assert (res.data['saved'], res.data['skipped']) == (1, ['100MEDIA/flight.srt'])
    d = ThermalDataset.objects.get(pk=d.id)
    with open(d.images_dir() + '/100MEDIA/DJI_0001_T.MP4', 'rb') as f:
        assert f.read() == dji_video()
