from django.conf import settings
from django.db import models


class Panel(models.Model):
    """A country/market grouping of instruments, e.g. UG Bonds."""

    KIND_BOND = "bond"
    KIND_EQUITY = "equity"
    KIND_CHOICES = [(KIND_BOND, "Bond"), (KIND_EQUITY, "Equity / DR")]

    name = models.CharField(max_length=64, unique=True)
    kind = models.CharField(max_length=16, choices=KIND_CHOICES, default=KIND_BOND)
    currency = models.CharField(max_length=8, default="UGX")
    is_base = models.BooleanField(default=False)
    fx_buy = models.DecimalField(max_digits=18, decimal_places=6, default=1)
    fx_sell = models.DecimalField(max_digits=18, decimal_places=6, default=1)
    position = models.PositiveSmallIntegerField(default=0)

    class Meta:
        ordering = ["position", "name"]

    def __str__(self):
        return self.name


class Bond(models.Model):
    """One instrument. Reference data plus the desk's current marks."""

    panel = models.ForeignKey(Panel, related_name="bonds", on_delete=models.PROTECT)
    symbol = models.CharField(max_length=32, unique=True)
    isin = models.CharField(max_length=12, unique=True)
    name = models.CharField(max_length=128, blank=True)
    issuer = models.CharField(max_length=16, default="ACL")

    coupon = models.DecimalField(
        max_digits=10, decimal_places=6,
        help_text="Annual coupon as a percent number, e.g. 16.625",
    )
    maturity = models.DateField()
    last_coupon = models.DateField(
        null=True, blank=True,
        help_text="Stated coupon date. Rolled forward automatically when stale.",
    )

    ytm_ask = models.DecimalField(max_digits=10, decimal_places=6, default=0)
    ytm_bid = models.DecimalField(max_digits=10, decimal_places=6, default=0)
    sell_qty = models.BigIntegerField(default=0)
    buy_qty = models.BigIntegerField(default=0)
    put_sell = models.BooleanField(default=True)
    put_buy = models.BooleanField(default=True)
    market_maker = models.CharField(max_length=32, blank=True)

    retired = models.BooleanField(
        default=False,
        help_text="Set once matured or delisted; excluded from runs.",
    )
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["panel__position", "maturity"]

    def __str__(self):
        return self.symbol


class PricingRun(models.Model):
    """One immutable pricing run. The unit of audit."""

    STATUS_DRAFT = "draft"
    STATUS_PUBLISHED = "published"
    STATUS_FAILED = "failed"
    STATUS_CHOICES = [
        (STATUS_DRAFT, "Draft"),
        (STATUS_PUBLISHED, "Published"),
        (STATUS_FAILED, "Failed"),
    ]

    REASON_CHOICES = [
        ("curve", "Curve moved"),
        ("correction", "Error correction"),
        ("mm", "Market maker instruction"),
        ("halt", "Trading halt"),
        ("sod", "Start of day"),
    ]

    created_at = models.DateTimeField(auto_now_add=True)
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="pricing_runs"
    )
    valuation_date = models.DateField()
    settlement_date = models.DateField()
    status = models.CharField(max_length=16, choices=STATUS_CHOICES, default=STATUS_DRAFT)
    reason = models.CharField(max_length=16, choices=REASON_CHOICES, blank=True)

    engine_version = models.CharField(
        max_length=32,
        help_text="So a historical price can be reproduced by the engine that made it.",
    )
    inputs = models.JSONField(
        default=dict,
        help_text="Complete input set: yields, quantities, MM assignments, settings.",
    )

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"run {self.pk} · {self.valuation_date} · {self.actor}"


class RunRow(models.Model):
    """One computed price within a run. Written once, never updated."""

    run = models.ForeignKey(PricingRun, related_name="rows", on_delete=models.CASCADE)
    symbol = models.CharField(max_length=32)
    isin = models.CharField(max_length=12)

    ytm_ask = models.DecimalField(max_digits=10, decimal_places=6)
    ytm_bid = models.DecimalField(max_digits=10, decimal_places=6)
    clean_ask = models.DecimalField(max_digits=18, decimal_places=6, null=True)
    clean_bid = models.DecimalField(max_digits=18, decimal_places=6, null=True)
    dirty_ask = models.DecimalField(max_digits=18, decimal_places=6, null=True)
    dirty_bid = models.DecimalField(max_digits=18, decimal_places=6, null=True)
    accrued = models.DecimalField(max_digits=18, decimal_places=6, null=True)
    mod_duration = models.DecimalField(max_digits=18, decimal_places=6, null=True)
    convexity = models.DecimalField(max_digits=18, decimal_places=6, null=True)

    last_coupon = models.DateField(null=True)
    next_coupon = models.DateField(null=True)
    warnings = models.JSONField(default=list)

    class Meta:
        unique_together = [("run", "symbol")]
        ordering = ["symbol"]

    def __str__(self):
        return f"{self.symbol} @ run {self.run_id}"


class MarkChange(models.Model):
    """Field-level before/after on bond marks. Append-only."""

    at = models.DateTimeField(auto_now_add=True)
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    bond = models.ForeignKey(Bond, related_name="changes", on_delete=models.CASCADE)
    field = models.CharField(max_length=32)
    old_value = models.CharField(max_length=64, blank=True)
    new_value = models.CharField(max_length=64, blank=True)
    intent = models.CharField(
        max_length=64, blank=True,
        help_text="Groups a bulk action so it reads as one deliberate act.",
    )

    class Meta:
        ordering = ["-at"]

    def __str__(self):
        return f"{self.bond_id}.{self.field}: {self.old_value} → {self.new_value}"
