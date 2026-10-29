from rest_framework import serializers

from .models import Bond, Panel, PricingRun, RunRow


class BondSerializer(serializers.ModelSerializer):
    class Meta:
        model = Bond
        fields = "__all__"


class PanelSerializer(serializers.ModelSerializer):
    bonds = BondSerializer(many=True, read_only=True)

    class Meta:
        model = Panel
        fields = "__all__"


class RunRowSerializer(serializers.ModelSerializer):
    class Meta:
        model = RunRow
        exclude = ["run"]


class PricingRunSerializer(serializers.ModelSerializer):
    rows = RunRowSerializer(many=True, read_only=True)
    actor = serializers.StringRelatedField()

    class Meta:
        model = PricingRun
        fields = "__all__"
