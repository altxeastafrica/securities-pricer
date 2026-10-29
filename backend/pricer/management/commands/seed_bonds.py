"""Load the UG and KE instrument seed carried over from the SPA."""
from datetime import date

from django.core.management.base import BaseCommand

from pricer.models import Bond, Panel

UG = [
    ("UGB08261662","UG12J2708269",16.625,"2026-08-27",0.102,0.1065,0,50000,None),
    ("UGB05271600","UG12J0605277",16,"2027-05-06",0.1135,0.12,0,50000,None),
    ("UGB01281412","UG12J1301280",14.125,"2028-01-13",0.1195,0.1235,20000,50000,None),
    ("UGB08291425","UG0000001327",14.25,"2029-08-23",0.1295,0.133,11838,50000,None),
    ("UGB04311700","UG12K0304317",17,"2031-04-03",0.144,0.15,20213,50000,None),
    ("UGB03321637","UG12K0403325",16.375,"2032-03-04",0.142,0.1465,0,50000,None),
    ("UGB05321500","UG12J2005328",15,"2032-05-20",0.143,0.148,0,50000,None),
    ("UGB02331437","UG12K0302337",14.375,"2033-02-03",0.1455,0.15,21941,50000,None),
    ("UGB06341425","UG12K2206346",14.25,"2034-06-22",0.15,0.155,0,50000,None),
    ("UGB11351625","UG12K0811352",16.25,"2035-11-08",0.153,0.158,0,50000,None),
    ("UGB05371600","UG12K1405378",15.8,"2037-05-14",0.153,0.16,11586,50000,None),
    ("UGB06391580","UG12K2306393",16.8,"2039-06-23",0.157,0.162,5882,50000,None),
    ("UGB11401750","UG12L0111405",17.8,"2040-11-01",0.157,0.162,21170,50000,None),
    ("UGB08421850","UG12L1308420",18.5,"2042-08-14",0.158,0.163,0,50000,None),
    ("UGB06431500","UG12L1806433",15,"2043-06-18",0.159,0.164,17174,50000,None),
]

KE = [
    ("GKB04281200","KE4000003808",12,"2028-04-10",0.182,0.187,0,50,"2026-04-14"),
    ("GKB12281250","KE5000009216",12.502,"2028-12-04",0.182,0.187,0,50,"2026-06-09"),
    ("GKB05331265","KE5000008325",12.65,"2033-05-09",0.169,0.174,100,50,"2025-05-19"),
    ("GKB10361393","KE8000005218",13.938,"2036-10-27",0.125,0.13,0,50,"2026-05-12"),
    ("GKB05401374","KE8000002322",13.742,"2040-05-21",0.12,0.13,100,50,"2026-06-09"),
    ("GKB01411296","KE7000007877",12.965,"2041-01-28",0.12,0.13,50,50,"2026-02-17"),
]


class Command(BaseCommand):
    help = "Seed the UG and KE panels with their instruments."

    def handle(self, *args, **options):
        ug, _ = Panel.objects.get_or_create(
            name="UG Bonds",
            defaults={"currency": "UGX", "is_base": True, "position": 0},
        )
        ke, _ = Panel.objects.get_or_create(
            name="KE Bonds",
            defaults={"currency": "KES", "is_base": False,
                      "fx_buy": 29.002, "fx_sell": 29.124, "position": 1},
        )

        created = 0
        for panel, rows in ((ug, UG), (ke, KE)):
            for sym, isin, cpn, mat, ask, bid, sq, bq, anchor in rows:
                _, made = Bond.objects.get_or_create(
                    symbol=sym,
                    defaults={
                        "panel": panel,
                        "isin": isin,
                        "coupon": cpn,
                        "maturity": date.fromisoformat(mat),
                        "last_coupon": date.fromisoformat(anchor) if anchor else None,
                        "ytm_ask": ask,
                        "ytm_bid": bid,
                        "sell_qty": sq,
                        "buy_qty": bq,
                    },
                )
                created += made

        self.stdout.write(self.style.SUCCESS(
            f"{created} instruments created, {Bond.objects.count()} total"
        ))
