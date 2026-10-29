from django.contrib import admin

from .models import Bond, MarkChange, Panel, PricingRun, RunRow


@admin.register(Panel)
class PanelAdmin(admin.ModelAdmin):
    list_display = ["name", "kind", "currency", "is_base", "position"]


@admin.register(Bond)
class BondAdmin(admin.ModelAdmin):
    list_display = ["symbol", "isin", "panel", "coupon", "maturity",
                    "last_coupon", "ytm_ask", "ytm_bid", "retired"]
    list_filter = ["panel", "retired"]
    search_fields = ["symbol", "isin"]


@admin.register(PricingRun)
class PricingRunAdmin(admin.ModelAdmin):
    list_display = ["id", "created_at", "actor", "valuation_date", "status", "reason"]
    list_filter = ["status", "reason"]


@admin.register(RunRow)
class RunRowAdmin(admin.ModelAdmin):
    list_display = ["run", "symbol", "dirty_ask", "dirty_bid", "accrued"]
    search_fields = ["symbol"]


@admin.register(MarkChange)
class MarkChangeAdmin(admin.ModelAdmin):
    list_display = ["at", "actor", "bond", "field", "old_value", "new_value"]
