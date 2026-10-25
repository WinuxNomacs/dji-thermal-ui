import os

import pytest
from django.conf import settings

from dji_thermal_ui.analyzer.models import Preferences, ThermalConversion, ThermalDataset

pytestmark = pytest.mark.django_db


def make_files(d, *names):
    os.makedirs(d, exist_ok=True)
    for n in names:
        with open(os.path.join(d, n), "wb") as f:
            f.write(b"x" * 1024)


def test_a_dataset_keeps_its_files_in_the_data_folder():
    ds = ThermalDataset.objects.create(name="d")
    assert ds.data_dir() == os.path.join(settings.DATASETS_DIR, str(ds.id))
    assert ds.images_dir() == os.path.join(ds.data_dir(), "images")
    c = ThermalConversion.objects.create(dataset=ds, name="c")
    assert c.data_dir() == os.path.join(ds.data_dir(), "conversions", str(c.id))


def test_update_size_counts_the_images_on_disk():
    ds = ThermalDataset.objects.create(name="d")
    make_files(ds.images_dir(), "a.jpg", "b.jpg")
    ds.update_size()
    assert ds.file_count == 2
    assert ds.size == pytest.approx(2 / 1024)


def test_deleting_a_dataset_removes_its_folder_but_keeps_the_datasets_folder():
    ds = ThermalDataset.objects.create(name="d")
    c = ThermalConversion.objects.create(dataset=ds, name="c")
    make_files(ds.images_dir(), "a.jpg")
    make_files(c.data_dir(), "a.tif")
    d = ds.data_dir()
    ds.delete()
    assert not os.path.exists(d)
    assert os.path.isdir(settings.DATASETS_DIR)


def test_deleting_a_folder_dataset_never_removes_its_images(tmp_path):
    images = tmp_path / "flight"
    make_files(images, "a.jpg")
    ds = ThermalDataset.objects.create(name="d", source="folder", folder=str(images))
    assert ds.images_dir() == str(images)
    c = ThermalConversion.objects.create(dataset=ds, name="c")
    make_files(c.data_dir(), "a.tif")
    d = ds.data_dir()
    ds.delete()
    assert not os.path.exists(d)
    assert (images / "a.jpg").is_file()


def test_deleting_a_conversion_removes_its_outputs_and_the_conversions_folder_left_empty():
    ds = ThermalDataset.objects.create(name="d")
    make_files(ds.images_dir(), "a.jpg")
    c = ThermalConversion.objects.create(dataset=ds, name="c")
    make_files(c.data_dir(), "a.tif")
    d = c.data_dir()
    c.delete()
    assert not os.path.exists(d)
    assert not os.path.exists(os.path.dirname(d))
    assert os.path.isfile(os.path.join(ds.images_dir(), "a.jpg"))


def test_the_preferences_are_a_single_row():
    p = Preferences.load()
    p.data = {"palette": "iron"}
    p.save()
    assert Preferences.load().data == {"palette": "iron"}
    assert Preferences.objects.count() == 1
