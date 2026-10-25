"""A small API view, for the CSRF tests"""

from django.urls import path
from rest_framework.response import Response
from rest_framework.views import APIView


class Echo(APIView):
    def get(self, request):
        return Response({"ok": True})

    def post(self, request):
        return Response({"ok": True})


urlpatterns = [path("echo/", Echo.as_view())]
