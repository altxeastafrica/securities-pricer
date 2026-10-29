from datetime import date

from rest_framework import viewsets
from rest_framework.decorators import api_view
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
def whoami(request):
    return Response({
        "username": request.user.username,
        "is_staff": request.user.is_staff,
    })
