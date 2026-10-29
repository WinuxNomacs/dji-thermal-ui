"""The API's routes, mounted under /api/ (the plugin's mount points, without the ODM task route)"""

from django.urls import re_path

from . import api

C = r'^conversions/(?P<pk>[0-9]+)'
DATA = r'(?P<z>[0-9]+)/(?P<x>[0-9]+)/(?P<y>[0-9]+)$'

urlpatterns = [
    re_path(r'^projects$', api.ProjectListCreateView.as_view()),
    re_path(r'^projects/(?P<pk>[0-9]+)$', api.ProjectDetailView.as_view()),
    re_path(r'^projects/(?P<pk>[0-9]+)/export$', api.ProjectExportView.as_view()),
    re_path(r'^projects/(?P<pk>[0-9]+)/export\.tar$', api.ProjectArchiveView.as_view()),
    re_path(r'^imports$', api.ImportListView.as_view()),
    re_path(r'^imports/(?P<import_id>[0-9a-f]+)$', api.ImportDetailView.as_view()),
    re_path(r'^datasets$', api.DatasetListCreateView.as_view()),
    re_path(r'^datasets/(?P<pk>[0-9]+)$', api.DatasetDetailView.as_view()),
    re_path(r'^datasets/(?P<pk>[0-9]+)/upload$', api.DatasetUploadView.as_view()),
    re_path(r'^datasets/(?P<pk>[0-9]+)/analyze$', api.DatasetAnalyzeView.as_view()),
    re_path(r'^datasets/(?P<pk>[0-9]+)/cancel$', api.DatasetCancelView.as_view()),
    re_path(r'^datasets/(?P<pk>[0-9]+)/thumbnail$', api.DatasetThumbnailView.as_view()),
    re_path(r'^datasets/(?P<pk>[0-9]+)/findings$', api.FindingsView.as_view()),
    re_path(r'^datasets/(?P<pk>[0-9]+)/findings/(?P<fid>[0-9]+)$', api.FindingDetailView.as_view()),
    re_path(r'^datasets/(?P<pk>[0-9]+)/conversions$', api.ConversionListCreateView.as_view()),
    re_path(C + r'$', api.ConversionDetailView.as_view()),
    re_path(C + r'/cancel$', api.ConversionCancelView.as_view()),
    re_path(C + r'/download$', api.ConversionDownloadView.as_view()),
    re_path(C + r'/mosaics$', api.MosaicsView.as_view()),
    re_path(C + r'/mosaics/footprint$', api.MosaicFootprintView.as_view()),
    re_path(C + r'/mosaics/visual/tiles/' + DATA[:-1] + r'\.png$', api.VisualTileView.as_view()),
    re_path(C + r'/mosaics/(?P<tab>[a-z_]+)/data/' + DATA, api.MosaicDataView.as_view()),
    re_path(C + r'/mosaics/(?P<tab>[a-z_]+)/point$', api.MosaicPointView.as_view()),
    re_path(C + r'/mosaics/(?P<tab>[a-z_]+)/sources$', api.MosaicSourcesView.as_view()),
    re_path(C + r'/mosaics/(?P<tab>[a-z_]+)/curve$', api.MosaicCurveView.as_view()),
    re_path(C + r'/mosaics/(?P<tab>[a-z_]+)/difference/data/' + DATA, api.MosaicDifferenceDataView.as_view()),
    re_path(C + r'/mosaics/(?P<tab>[a-z_]+)/difference$', api.MosaicDifferenceView.as_view()),
    re_path(C + r'/comparable$', api.ComparableView.as_view()),
    re_path(C + r'/measure$', api.MeasureView.as_view()),
    re_path(C + r'/measurements$', api.MeasurementsView.as_view()),
    re_path(C + r'/measurements\.csv$', api.MeasurementsCsvView.as_view()),
    re_path(C + r'/measurements\.geojson$', api.MeasurementsGeoJsonView.as_view()),
    re_path(C + r'/measurements/(?P<mid>[0-9]+)$', api.MeasurementDetailView.as_view()),
    re_path(C + r'/frames$', api.FramesView.as_view()),
    re_path(C + r'/frame$', api.FrameView.as_view()),
    re_path(C + r'/frame/data$', api.FrameDataView.as_view()),
    re_path(C + r'/frame/visual$', api.FrameVisualView.as_view()),
    re_path(C + r'/frame/point$', api.FramePointView.as_view()),
    re_path(C + r'/frame/curve$', api.FrameCurveView.as_view()),
    re_path(r'^preferences$', api.PreferencesView.as_view()),
    re_path(r'^settings/mapbox$', api.MapboxTokenView.as_view()),
    re_path(r'^storage$', api.StorageView.as_view()),
    re_path(r'^storage/check$', api.StorageCheckView.as_view()),
    re_path(r'^storage/move$', api.StorageMoveView.as_view()),
    re_path(r'^file-filters$', api.FileFiltersView.as_view()),
    re_path(r'^places$', api.PlacesView.as_view()),
    re_path(r'^navigation$', api.NavigationView.as_view()),
]
