"""URL Configuration

The `urlpatterns` list routes URLs to views. For more information please see:
    https://docs.djangoproject.com/en/4.2/topics/http/urls/
Examples:
Function views
    1. Add an import:  from my_app import views
    2. Add a URL to urlpatterns:  path('', views.home, name='home')
Class-based views
    1. Add an import:  from other_app.views import Home
    2. Add a URL to urlpatterns:  path('', Home.as_view(), name='home')
Including another URLconf
    1. Import the include() function: from django.urls import include, path
    2. Add a URL to urlpatterns:  path('blog/', include('blog.urls'))
"""

from django.contrib import admin
from django.urls import path, include, re_path
from django.views.generic import TemplateView
from django.views.decorators.cache import never_cache
from django.http import HttpResponse

urlpatterns = [
    # Health check (used by ALB)
    path("health/", lambda request: HttpResponse("ok"), name="health"),
    # Django URL patterns
    path("admin/", admin.site.urls),
    path("arango_api/", include("arango_api.urls")),
    path("api/", include("api.urls")),
    # React catch-all. never_cache marks the SPA shell non-cacheable
    # (no-store / no-cache) so browsers always fetch the current index.html and
    # its current hashed asset references. Without this the shell was served
    # with no cache headers, letting a stale index.html linger and pull old CSS/JS
    # (whitenoise still serves every previously collected hash).
    re_path(r"^.*$", never_cache(TemplateView.as_view(template_name="index.html"))),
]
