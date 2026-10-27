"""Checks with real R-JPEGs (set DJI_THERMAL_FLIGHT_DIR)"""

import os
import shutil

import dji_thermal_cli
import pytest

pytestmark = pytest.mark.flight


@pytest.mark.django_db(transaction=True)
def test_a_job_on_the_runner_converts_frames_with_worker_processes(threaded_jobs, flight_frames, tmp_path):
    images = tmp_path / "images"
    images.mkdir()
    for f in flight_frames[:4]:
        shutil.copy(f, images)
    out = tmp_path / "out"
    reports = []

    def convert(pk, run_id):
        reports.append(dji_thermal_cli.process(images, out, jobs=2))

    threaded_jobs.submit(convert, 1, "flight")
    threaded_jobs.join()
    assert len(reports) == 1
    assert reports[0].processed == 4
    assert len(list(out.rglob("*.tif*"))) == 4
    assert len(list(out.rglob("*.png"))) == 4


@pytest.mark.django_db(transaction=True)
def test_a_folder_dataset_is_analyzed_converted_and_made_into_mosaics_on_the_runner(threaded_jobs, flight_frames,
                                                                                   tmp_path):
    from dji_thermal_cli import api

    from dji_thermal_ui.analyzer import thermal_analysis, thermal_conversion
    from dji_thermal_ui.analyzer.models import ThermalConversion, ThermalDataset

    images = tmp_path / "images"
    images.mkdir()
    for f in flight_frames[:12]:
        shutil.copy(f, images)
    dataset = ThermalDataset.objects.create(name="flight", source="folder", folder=str(images), status="analyzing",
                                            run_id="a")
    threaded_jobs.submit(thermal_analysis.analyze_dataset, dataset.pk, "a")
    threaded_jobs.join()
    dataset.refresh_from_db()
    assert dataset.status == "ready", dataset.error
    assert len(dataset.analysis["files"]) == 12

    options, errors = thermal_conversion.parse_settings({"unit": "F"})
    assert errors == {}
    conversion = ThermalConversion.objects.create(dataset=dataset, name="F", options=options, run_id="b")
    threaded_jobs.submit(thermal_conversion.convert, conversion.pk, "b")
    threaded_jobs.join()
    conversion.refresh_from_db()
    assert conversion.status == "ready", conversion.error
    assert conversion.mosaic_status == "ready", conversion.mosaic_error
    for kind in ("as_converted", "harmonized"):
        m = conversion.mosaics["kinds"][kind]
        west, south, east, north = m["bounds"]
        assert west < east and south < north
        assert m["temperature"]["min"] < m["temperature"]["max"]
        assert os.path.isfile(os.path.join(conversion.data_dir(), m["raster"]))
        # dji-thermal-cli 1.5.0 keeps each frame's model beside the mosaic: its centre was seen by some frame
        models = api.read_frame_models(os.path.join(conversion.data_dir(), m["raster"]))
        assert models is not None and len(models.files) == 12
        assert models.covering((west + east) / 2, (south + north) / 2)
