from datetime import date

from django.contrib.auth import authenticate, login, logout
from django.middleware.csrf import get_token
from rest_framework import viewsets
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from .models import Bond, Panel, PricingRun
from .serializers import BondSerializer, PanelSerializer, PricingRunSerializer
from .services import build_run


class PanelViewSet(viewsets.ModelViewSet):
    queryset = Panel.objects.prefetch_related("bonds")
    serializer_class = PanelSerializer


class BondViewSet(viewsets.ModelViewSet):
    queryset = Bond.objects.select_related("panel")
    serializer_class = BondSerializer


class RunViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = PricingRun.objects.prefetch_related("rows")
    serializer_class = PricingRunSerializer


@api_view(["POST"])
def create_run(request):
    valuation = request.data.get("valuation_date")
    run = build_run(
        actor=request.user,
        valuation=date.fromisoformat(valuation) if valuation else date.today(),
        settle_days=int(request.data.get("settle_days", 0)),
        reason=request.data.get("reason", ""),
    )
    return Response(PricingRunSerializer(run).data, status=201)


@api_view(["GET"])
@permission_classes([AllowAny])
def whoami(request):
    """Also hands out the CSRF cookie, so the SPA can post straight after."""
    get_token(request)
    if not request.user.is_authenticated:
        return Response({"authenticated": False}, status=200)
    return Response({
        "authenticated": True,
        "username": request.user.username,
        "is_staff": request.user.is_staff,
    })


@api_view(["POST"])
@permission_classes([AllowAny])
def login_view(request):
    user = authenticate(
        request,
        username=request.data.get("username", ""),
        password=request.data.get("password", ""),
    )
    if user is None:
        return Response({"detail": "Incorrect username or password."}, status=401)

    login(request, user)
    return Response({
        "authenticated": True,
        "username": user.username,
        "is_staff": user.is_staff,
    })


@api_view(["POST"])
@permission_classes([AllowAny])
def logout_view(request):
    logout(request)
    return Response({"authenticated": False})
