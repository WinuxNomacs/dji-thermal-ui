# Copied from WebODM, as forked in LuxODM (commit a2a81052): the file and zip stream downloads of app/api/tasks.py.
# Copyright (C) the WebODM authors (OpenDroneMap) and the LuxODM authors.
# Licensed under the GNU Affero General Public License v3.0 (see LICENSE).
import mimetypes
import os
import re
from wsgiref.util import FileWrapper

from django.http import FileResponse, HttpResponse, StreamingHttpResponse
from rest_framework import exceptions
from zipstream.ng import ZipStream


class RangeFileWrapper:
    def __init__(self, file, length, blksize=8192):
        self.file = file
        self.remaining = length
        self.blksize = blksize

    def close(self):
        if hasattr(self.file, 'close'):
            self.file.close()

    def __iter__(self):
        return self

    def __next__(self):
        if self.remaining <= 0:
            raise StopIteration()
        data = self.file.read(min(self.remaining, self.blksize))
        if not data:
            raise StopIteration()
        self.remaining -= len(data)
        return data


def download_file_response(request, filePath, content_disposition, download_filename=None, accept_ranges=False):
    filename = os.path.basename(filePath)
    if download_filename is None:
        download_filename = filename
    filesize = os.stat(filePath).st_size
    file = open(filePath, "rb")
    content_type = mimetypes.guess_type(filename)[0] or "application/zip"

    if accept_ranges:
        # Handle single part range requests
        range_match = re.match(r'^bytes=(\d+)-(\d*)$', request.META.get('HTTP_RANGE', ''))
        if range_match:
            start = int(range_match.group(1))
            end = int(range_match.group(2)) if range_match.group(2) else filesize - 1

            if start >= filesize:
                file.close()
                response = HttpResponse(status=416)
                response['Content-Range'] = 'bytes */{}'.format(filesize)
                return response

            end = min(end, filesize - 1)
            length = end - start + 1
            file.seek(start)

            response = StreamingHttpResponse(RangeFileWrapper(file, length), status=206, content_type=content_type)
            response['Content-Range'] = 'bytes {}-{}/{}'.format(start, end, filesize)
            response['Content-Disposition'] = "{}; filename={}".format(content_disposition, download_filename)
            response['Content-Length'] = length
            response['Accept-Ranges'] = 'bytes'
            return response

    # More than 100mb, normal http response, otherwise stream
    # Django docs say to avoid streaming when possible
    stream = filesize > 1e8 or request.GET.get('_force_stream', False)
    if stream:
        response = FileResponse(file)
    else:
        response = HttpResponse(FileWrapper(file),
                                content_type=content_type)

    response['Content-Type'] = content_type
    response['Content-Disposition'] = "{}; filename={}".format(content_disposition, download_filename)
    response['Content-Length'] = filesize

    if accept_ranges:
        response['Accept-Ranges'] = 'bytes'

    # For testing
    if stream:
        response['_stream'] = 'yes'

    return response


def download_file_stream(request, stream, content_disposition, download_filename=None):
    if not isinstance(stream, ZipStream):
        # This should never happen, but just in case..
        raise exceptions.ValidationError("stream not a zipstream instance")

    response = StreamingHttpResponse(stream, content_type=(mimetypes.guess_type(download_filename)[0] or "application/zip"))

    response['Content-Type'] = mimetypes.guess_type(download_filename)[0] or "application/zip"
    response['Content-Disposition'] = "{}; filename={}".format(content_disposition, download_filename)
    response['Content-Length'] = len(stream)

    # For testing
    response['_stream'] = 'yes'

    return response
