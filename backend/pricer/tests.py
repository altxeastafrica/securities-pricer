from datetime import date, timedelta

from django.contrib.auth.models import User
from django.test import TestCase

from .engine import PERIOD, price, risk_metrics
from .models import Bond, Panel, PricingRun
from .services import STALE_ANCHOR, build_run

V = date(2026, 9, 7)


class EngineParityTests(TestCase):
    """Values below come from running the original JSX engine."""

    def test_matches_js_unanchored(self):
        p = risk_metrics(V, date(2027, 5, 6), 16, 0.1135)
        self.assertAlmostEqual(p.accrued, 5.406593406593407, places=9)
        self.assertAlmostEqual(p.clean, 102.88770137678223, places=9)
        self.assertAlmostEqual(p.dirty, 108.29429478337563, places=9)
        self.assertAlmostEqual(p.mod_duration, 0.5921838828371656, places=9)
        self.assertAlmostEqual(p.convexity, 0.6459449098387161, places=9)

    def test_matches_js_long_dated(self):
        p = risk_metrics(V, date(2043, 6, 18), 15, 0.159)
        self.assertAlmostEqual(p.dirty, 97.24290272564555, places=9)
        self.assertAlmostEqual(p.mod_duration, 5.7139123506639375, places=9)

    def test_matches_js_fresh_anchor(self):
        p = risk_metrics(V, date(2028, 4, 10), 12, 0.182, date(2026, 4, 14))
        self.assertAlmostEqual(p.dirty, 96.54442236876072, places=9)

    def test_matured_returns_none(self):
        self.assertIsNone(price(V, date(2026, 8, 27), 16.625, 0.102))


class AnchorRollTests(TestCase):
    def test_stale_anchor_is_rolled(self):
        p = risk_metrics(V, date(2033, 5, 9), 12.65, 0.169, date(2025, 5, 19))
        self.assertGreater(p.days_to_next, 0)
        self.assertLess(p.accrued, 12.65 / 2)

    def test_roll_removes_whole_coupons(self):
        args = (V, date(2033, 5, 9), 12.65, 0.169, date(2025, 5, 19))
        old = risk_metrics(*args, roll=False)
        new = risk_metrics(*args, roll=True)
        self.assertAlmostEqual(old.dirty - new.dirty, 12.65, places=6)

    def test_fresh_anchor_unchanged_by_roll(self):
        args = (V, date(2028, 4, 10), 12, 0.182, date(2026, 4, 14))
        self.assertAlmostEqual(
            risk_metrics(*args, roll=False).dirty,
            risk_metrics(*args, roll=True).dirty,
            places=9,
        )

    def test_days_to_next_never_negative(self):
        for anchor in (date(2024, 1, 1), date(2025, 5, 19), date(2026, 8, 1)):
            p = price(V, date(2035, 1, 1), 12, 0.15, anchor)
            self.assertGreater(p.days_to_next, 0, anchor)


class EngineProperties(TestCase):
    def test_price_falls_as_yield_rises(self):
        last = None
        for y in (0.10, 0.12, 0.14, 0.16, 0.18):
            p = price(V, date(2035, 1, 1), 15, y)
            if last is not None:
                self.assertLess(p.clean, last)
            last = p.clean

    def test_accrued_within_one_period(self):
        for anchor in (date(2026, 3, 1), date(2025, 1, 1), None):
            p = price(V, date(2035, 1, 1), 14, 0.15, anchor)
            self.assertGreaterEqual(p.accrued, 0)
            self.assertLess(p.accrued, 14 / 2)

    def test_duration_and_convexity_positive(self):
        p = risk_metrics(V, date(2040, 1, 1), 15, 0.15)
        self.assertGreater(p.mod_duration, 0)
        self.assertGreater(p.convexity, 0)

    def test_longer_bond_has_more_duration(self):
        short = risk_metrics(V, date(2029, 1, 1), 15, 0.15)
        long = risk_metrics(V, date(2043, 1, 1), 15, 0.15)
        self.assertGreater(long.mod_duration, short.mod_duration)


class RunTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user("ej", password="x")
        self.panel = Panel.objects.create(name="UG Bonds", is_base=True)

    def _bond(self, **kw):
        defaults = dict(
            panel=self.panel, symbol="UGB05271600", isin="UG12J0605277",
            coupon=16, maturity=date(2027, 5, 6), ytm_ask=0.1135, ytm_bid=0.12,
        )
        defaults.update(kw)
        return Bond.objects.create(**defaults)

    def test_run_records_actor_inputs_and_engine(self):
        self._bond()
        run = build_run(self.user, V, reason="curve")
        self.assertEqual(run.actor, self.user)
        self.assertEqual(run.reason, "curve")
        self.assertTrue(run.engine_version)
        self.assertIn("UGB05271600", run.inputs)
        self.assertEqual(run.rows.count(), 1)

    def test_bid_above_ask_is_flagged_crossed(self):
        self._bond(ytm_ask=0.20, ytm_bid=0.10)
        run = build_run(self.user, V)
        self.assertTrue(any("crossed" in w for w in run.rows.first().warnings))

    def test_stale_anchor_raises_a_warning(self):
        self._bond(symbol="GKB05331265", isin="KE5000008325", coupon=12.65,
                   maturity=date(2033, 5, 9), last_coupon=date(2025, 5, 19))
        run = build_run(self.user, V)
        row = run.rows.get(symbol="GKB05331265")
        self.assertIn(STALE_ANCHOR, row.warnings)

    def test_matured_bond_is_flagged_not_dropped(self):
        self._bond(symbol="UGB08261662", isin="UG12J2708269",
                   coupon=16.625, maturity=date(2026, 8, 27))
        run = build_run(self.user, V)
        row = run.rows.get(symbol="UGB08261662")
        self.assertIsNone(row.dirty_ask)
        self.assertTrue(any("matured" in w for w in row.warnings))

    def test_retired_bonds_excluded(self):
        self._bond(retired=True)
        run = build_run(self.user, V)
        self.assertEqual(run.rows.count(), 0)

    def test_settlement_offset_moves_accrual(self):
        self._bond()
        t0 = build_run(self.user, V, settle_days=0)
        t2 = build_run(self.user, V, settle_days=2)
        self.assertEqual(t2.settlement_date, V + timedelta(days=2))
        self.assertGreater(t2.rows.first().accrued, t0.rows.first().accrued)

    def test_normal_market_not_flagged_crossed(self):
        self._bond(ytm_ask=0.1135, ytm_bid=0.12)
        run = build_run(self.user, V)
        self.assertFalse(any("crossed" in w for w in run.rows.first().warnings))


class AuthEndpointTests(TestCase):
    def setUp(self):
        User.objects.create_user("ej", password="correct-horse-staple")

    def test_whoami_anonymous_is_not_an_error(self):
        r = self.client.get("/api/whoami/")
        self.assertEqual(r.status_code, 200)
        self.assertFalse(r.json()["authenticated"])

    def test_login_succeeds_and_session_persists(self):
        r = self.client.post("/api/login/",
                             {"username": "ej", "password": "correct-horse-staple"})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["username"], "ej")
        self.assertTrue(self.client.get("/api/whoami/").json()["authenticated"])

    def test_bad_password_is_401(self):
        r = self.client.post("/api/login/", {"username": "ej", "password": "wrong"})
        self.assertEqual(r.status_code, 401)
        self.assertFalse(self.client.get("/api/whoami/").json()["authenticated"])

    def test_logout_ends_the_session(self):
        self.client.post("/api/login/",
                         {"username": "ej", "password": "correct-horse-staple"})
        self.client.post("/api/logout/")
        self.assertFalse(self.client.get("/api/whoami/").json()["authenticated"])

    def test_bonds_require_authentication(self):
        self.assertEqual(self.client.get("/api/bonds/").status_code, 403)
        self.client.post("/api/login/",
                         {"username": "ej", "password": "correct-horse-staple"})
        self.assertEqual(self.client.get("/api/bonds/").status_code, 200)
