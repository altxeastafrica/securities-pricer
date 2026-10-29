from django.urls import include, path
from rest_framework.routers import DefaultRouter

from . import views

router = DefaultRouter()
router.register("panels", views.PanelViewSet)
router.register("bonds", views.BondViewSet)
router.register("runs", views.RunViewSet)

urlpatterns = [
    path("", include(router.urls)),
    path("run/", views.create_run),
    path("whoami/", views.whoami),
    path("login/", views.login_view),
    path("logout/", views.logout_view),
]
