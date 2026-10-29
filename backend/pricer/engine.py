"""
ALTX securities pricer — bond pricing engine.

Ported from altx-bond-pricer.jsx (v4), which was itself ported cell-for-cell
from Workbook_20260707.xlsx.

Deliberate deviation from the JS version, see roll_anchor():
the JS couponDates() took an explicit coupon anchor and used it forever, so a
stale lastCpn produced accrued interest spanning more than one coupon period
and, via a negative daysToNext, negative tau in risk metrics. Here the anchor
is rolled forward in whole periods until it precedes the valuation date.
Set roll=False to reproduce the original behaviour exactly.
"""

from __future__ import annotations

from dataclasses import dataclass, asdict
from datetime import date, timedelta
from typing import Optional

PERIOD = 182  # fixed semi-annual period, per the workbook
DAYS_PER_YEAR = 365


def excel_pv(rate: float, nper: float, pmt: float, fv: float) -> float:
    """Excel's PV(), including its sign convention and fractional nper."""
    if rate == 0:
        return -(pmt * nper + fv)
    return -(
        pmt * (1 - (1 + rate) ** -nper) / rate
        + fv * (1 + rate) ** -nper
    )


def roll_anchor(anchor: date, valuation: date) -> date:
    """Advance a stated coupon date in whole 182-day periods to the one
    immediately preceding the valuation date."""
    rolled = anchor
    while rolled + timedelta(days=PERIOD) <= valuation:
        rolled += timedelta(days=PERIOD)
    return rolled


def coupon_dates(
    valuation: date,
    maturity: date,
    anchor: Optional[date] = None,
    roll: bool = True,
) -> tuple[date, date]:
    """Return (last_coupon, next_coupon)."""
    if anchor is not None:
        last = roll_anchor(anchor, valuation) if roll else anchor
        return last, last + timedelta(days=PERIOD)

    nxt = maturity
    while nxt - timedelta(days=PERIOD) > valuation:
        nxt -= timedelta(days=PERIOD)
    return nxt - timedelta(days=PERIOD), nxt


@dataclass
class Price:
    dtm: int
    periods: float
    accrued: float
    clean: float
    dirty: float
    last_coupon: date
    next_coupon: date
    days_to_next: int
    tenor: float
    periods_whole: int
    mod_duration: Optional[float] = None
    convexity: Optional[float] = None

    def as_dict(self) -> dict:
        d = asdict(self)
        d["last_coupon"] = self.last_coupon.isoformat()
        d["next_coupon"] = self.next_coupon.isoformat()
        return d


def price(
    valuation: date,
    maturity: date,
    coupon: float,
    ytm: float,
    anchor: Optional[date] = None,
    roll: bool = True,
) -> Optional[Price]:
    """Clean, dirty and accrued for one bond. None once matured.

    Units follow the app and the workbook: coupon is the annual rate as a
    percent number (16.625 for 16.625%), ytm is a decimal (0.102 for 10.2%).
    """
    if maturity <= valuation:
        return None

    dtm = (maturity - valuation).days
    periods = dtm / PERIOD
    last_coupon, next_coupon = coupon_dates(valuation, maturity, anchor, roll)

    accrued = ((valuation - last_coupon).days / PERIOD) * (coupon / 2)
    clean = -excel_pv(ytm / 2, periods, coupon / 2, 100)

    return Price(
        dtm=dtm,
        periods=periods,
        accrued=accrued,
        clean=clean,
        dirty=clean + accrued,
        last_coupon=last_coupon,
        next_coupon=next_coupon,
        days_to_next=(next_coupon - valuation).days,
        tenor=dtm / DAYS_PER_YEAR,
        periods_whole=int(dtm // PERIOD),
    )


def risk_metrics(
    valuation: date,
    maturity: date,
    coupon: float,
    ytm: float,
    anchor: Optional[date] = None,
    roll: bool = True,
) -> Optional[Price]:
    """price() plus modified duration and convexity."""
    p = price(valuation, maturity, coupon, ytm, anchor, roll)
    if p is None:
        return None

    r = ytm / 2
    c = coupon / 2
    tau = p.days_to_next / PERIOD
    n = p.periods_whole + 1

    pv = ds = cs = 0.0
    for i in range(n):
        t = tau + i
        cf = c + (100 if i == n - 1 else 0)
        x = cf * (1 + r) ** -t
        pv += x
        ds += t * x
        cs += t * (t + 1) * x

    if pv == 0:
        return p

    mac_years = (ds / pv) / 2
    p.mod_duration = mac_years / (1 + r)
    p.convexity = (cs / pv) / (1 + r) ** 2 / 4
    return p


def cashflows(valuation: date, maturity: date, coupon: float) -> list[dict]:
    """Remaining coupon and principal flows, earliest first."""
    dates = []
    d = maturity
    while d > valuation:
        dates.append(d)
        d -= timedelta(days=PERIOD)

    dates.sort()
    return [
        {
            "date": dt.isoformat(),
            "year": dt.year,
            "coupon": round(coupon / 2, 3),
            "principal": 100 if dt == maturity else 0,
        }
        for dt in dates
    ]
