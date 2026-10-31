"""A video's frames saved: with the track's point at their time and two PNGs, renamed, attached to a finding, deleted
with their pictures, and carried by a project's export and import"""

import io
import os

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile

from dji_thermal_ui.analyzer.models import Finding, Project, VideoFrame
from tests.fakes import DATASETS, JPEG
from tests.test_api_import import IMPORTS, exported, no_imports, send  # noqa: F401 (the fixture clears imports)
from tests.test_video import VIDEO, analyzed_with_video


def png(colour=(255, 0, 0)):
    from PIL import Image
    out = io.BytesIO()
    Image.new('RGB', (4, 2), colour).save(out, 'PNG')
    return out.getvalue()


def save(api, d, **over):
    data = {'video': VIDEO, 'time': '0.05', 'frame': '2', 'name': "Hot window", 'look': '{"recoloured": true}',
            'picture': SimpleUploadedFile('p.png', png(), content_type='image/png'),
            'original': SimpleUploadedFile('o.png', png((0, 0, 255)), content_type='image/png')}
    data.update(over)
    return api.post("{}/{}/video-frames".format(DATASETS, d.id), {k: v for k, v in data.items() if v is not None},
                    format='multipart')


def test_a_frame_is_saved_with_the_tracks_point_at_its_time_and_both_pictures(api, tmp_path):
    d = analyzed_with_video(tmp_path)
    res = save(api, d)
    assert res.status_code == 201, res.data
    v = res.data
    assert (v['video'], v['time'], v['frame'], v['name'], v['look'], v['finding']) == \
        (VIDEO, 0.05, 2, "Hot window", {'recoloured': True}, None)
    assert (v['point']['t'], v['point']['lat'], v['point']['alt']) == (0.0333, 42.10001, 15.2)
    url = "{}/{}/video-frames/{}/picture".format(DATASETS, d.id, v['id'])
    res = api.get(url)
    assert (res.status_code, res['Content-Type']) == (200, 'image/png')
    assert res.getvalue() == png()
    assert api.get(url, {'original': '1'}).getvalue() == png((0, 0, 255))
    assert api.get("{}/{}/video-frames".format(DATASETS, d.id)).data['frames'] == [v]


def test_a_frame_is_refused_without_its_pictures_a_listed_video_or_a_moment_in_it(api, tmp_path):
    d = analyzed_with_video(tmp_path)
    assert save(api, d, original=None).status_code == 400
    not_png = SimpleUploadedFile('p.png', JPEG, content_type='image/png')
    assert 'picture' in save(api, d, picture=not_png).data
    assert save(api, d, video='other.mp4').status_code == 404
    assert save(api, d, time='9').status_code == 400        # the video is 4 frames long
    assert save(api, d, frame='0').status_code == 400
    assert save(api, d, name="").status_code == 400
    assert 'look' in save(api, d, look='[1]').data
    assert VideoFrame.objects.count() == 0
    assert not os.path.isdir(os.path.join(d.data_dir(), 'video-frames'))


def test_a_frame_is_renamed_and_attached_to_a_finding_of_its_flight_only(api, tmp_path):
    d = analyzed_with_video(tmp_path)
    f = Finding.objects.create(dataset=d, name="Roof leak", geometry={'type': 'Point', 'coordinates': [0, 0]})
    other = Finding.objects.create(dataset=analyzed_with_video(tmp_path / 'b'), name="Elsewhere",
                                   geometry={'type': 'Point', 'coordinates': [0, 0]})
    vid = save(api, d).data['id']
    url = "{}/{}/video-frames/{}".format(DATASETS, d.id, vid)
    res = api.patch(url, {'name': "Window", 'notes': "Warm frame", 'finding': f.id}, format='json')
    assert res.status_code == 200, res.data
    assert (res.data['name'], res.data['notes'], res.data['finding'], res.data['finding_name']) == \
        ("Window", "Warm frame", f.id, "Roof leak")
    assert api.patch(url, {'finding': other.id}, format='json').status_code == 400
    assert api.patch(url, {}, format='json').status_code == 400
    # The finding deleted: the frame is kept, attached to nothing
    f.delete()
    assert VideoFrame.objects.get(pk=vid).finding is None
    assert api.patch(url, {'finding': None}, format='json').data['finding'] is None


def test_a_frame_deleted_takes_its_pictures_and_a_flight_deleted_takes_its_frames(api, tmp_path):
    d = analyzed_with_video(tmp_path)
    a, b = save(api, d).data['id'], save(api, d).data['id']
    folder = os.path.join(d.data_dir(), 'video-frames')
    assert len(os.listdir(folder)) == 4
    assert api.delete("{}/{}/video-frames/{}".format(DATASETS, d.id, a)).status_code == 204
    assert len(os.listdir(folder)) == 2
    assert api.get("{}/{}/video-frames/{}/picture".format(DATASETS, d.id, a)).status_code == 404
    api.delete("{}/{}/video-frames/{}".format(DATASETS, d.id, b))
    assert not os.path.isdir(folder)
    save(api, d)
    assert api.delete("{}/{}".format(DATASETS, d.id)).status_code == 204
    assert VideoFrame.objects.count() == 0 and not os.path.isdir(d.data_dir())


@pytest.mark.usefixtures('no_imports')
def test_an_exported_project_comes_back_with_its_saved_frames_their_pictures_and_findings(api, tmp_path):
    d = analyzed_with_video(tmp_path)
    f = Finding.objects.create(dataset=d, name="Roof leak", geometry={'type': 'Point', 'coordinates': [0, 0]})
    vid = save(api, d, finding=str(f.id)).data['id']
    old = VideoFrame.objects.get(pk=vid)
    data = exported(api, d.project_id)
    import_id, _res = send(api, data)
    res = api.post("{}/{}".format(IMPORTS, import_id), {'name': "Imported"}, format='json')
    assert res.status_code == 201, res.data
    new = Project.objects.get(pk=res.data['id']).datasets.get()
    v = new.video_frames.get()
    assert (v.name, v.time, v.frame, v.point, v.look, v.key) == (old.name, old.time, old.frame, old.point, old.look, old.key)
    assert v.finding == new.findings.get()
    with open(v.picture_path(), 'rb') as a, open(v.picture_path(original=True), 'rb') as b:
        assert (a.read(), b.read()) == (png(), png((0, 0, 255)))
