import pytest
from django.middleware.csrf import get_token
from django.test import RequestFactory
from rest_framework.test import APIClient

pytestmark = pytest.mark.urls("tests.csrf_urls")


@pytest.fixture
def client():
    return APIClient(enforce_csrf_checks=True)


def test_a_get_needs_no_token(client):
    assert client.get("/echo/").status_code == 200


def test_a_post_without_the_csrf_token_is_refused(client):
    r = client.post("/echo/", {"a": 1}, format="json")
    assert r.status_code == 403
    assert "CSRF" in r.json()["detail"]


def test_a_post_with_the_csrf_token_is_accepted(client):
    request = RequestFactory().get("/")
    token = get_token(request)
    client.cookies["csrftoken"] = request.META["CSRF_COOKIE"]
    r = client.post("/echo/", {"a": 1}, format="json", HTTP_X_CSRFTOKEN=token)
    assert r.status_code == 200
