"""CSRF for the API. Django REST Framework only checks it for a logged-in session, and there are no logins here."""

from rest_framework.authentication import SessionAuthentication


class CsrfCheck(SessionAuthentication):
    """Authenticates no one, but refuses an unsafe request without a valid CSRF token"""

    def authenticate(self, request):
        self.enforce_csrf(request)
        return None
