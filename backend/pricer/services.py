"""Turning stored bonds into a priced, audited run."""
from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal

from .engine import PERIOD, price, risk_metrics
from .models import Bond, PricingRun, RunRow

ENGINE_VERSION = "2.0.0-anchor-roll"

CROSSED = "crossed market: bid price below ask price"
STALE_ANCHOR = "stated coupon date was stale and has been rolled forward"
WIDE_MOVE = "price moved more than {bp}bp against the previous run"


def _d(x):
    return None if x is None else Decimal(repr(round(x, 6)))


def price_bond(bond: Bond, valuation: date):
    """Ask and bid metrics for one bond, plus any warnings raised."""
    anchor = bond.last_coupon
    warnings = []

    if anchor is not None and anchor + timedelta(days=PERIOD) <= valuation:
        warnings.append(STALE_ANCHOR)

    ask = risk_metrics(valuation, bond.maturity, float(bond.coupon),
                       float(bond.ytm_ask), anchor)
    bid = price(valuation, bond.maturity, float(bond.coupon),
                float(bond.ytm_bid), anchor)

    # Higher yield means lower price, so the ask price normally sits above
    # the bid price. Crossed is the bid price exceeding the ask price.
    if ask and bid and bid.dirty > ask.dirty:
        warnings.append(CROSSED)

    return ask, bid, warnings


def build_run(actor, valuation: date, settle_days: int = 0, reason: str = "") -> PricingRun:
    """Price every live bond and persist the run immutably."""
    settlement = valuation + timedelta(days=settle_days)

    bonds = list(Bond.objects.filter(retired=False).select_related("panel"))
    inputs = {
        b.symbol: {
            "ytm_ask": str(b.ytm_ask),
            "ytm_bid": str(b.ytm_bid),
            "coupon": str(b.coupon),
            "maturity": b.maturity.isoformat(),
            "last_coupon": b.last_coupon.isoformat() if b.last_coupon else None,
            "sell_qty": b.sell_qty,
            "buy_qty": b.buy_qty,
            "market_maker": b.market_maker,
        }
        for b in bonds
    }

    run = PricingRun.objects.create(
        actor=actor,
        valuation_date=valuation,
        settlement_date=settlement,
        reason=reason,
        engine_version=ENGINE_VERSION,
        inputs=inputs,
    )

    rows = []
    for b in bonds:
        ask, bid, warnings = price_bond(b, settlement)

        if ask is None:
            # matured between runs: say so rather than dropping it silently
            warnings.append("matured on or before the settlement date")

        rows.append(RunRow(
            run=run,
            symbol=b.symbol,
            isin=b.isin,
            ytm_ask=b.ytm_ask,
            ytm_bid=b.ytm_bid,
            clean_ask=_d(ask.clean) if ask else None,
            clean_bid=_d(bid.clean) if bid else None,
            dirty_ask=_d(ask.dirty) if ask else None,
            dirty_bid=_d(bid.dirty) if bid else None,
            accrued=_d(ask.accrued) if ask else None,
            mod_duration=_d(ask.mod_duration) if ask else None,
            convexity=_d(ask.convexity) if ask else None,
            last_coupon=ask.last_coupon if ask else None,
            next_coupon=ask.next_coupon if ask else None,
            warnings=warnings,
        ))

    RunRow.objects.bulk_create(rows)
    return run
