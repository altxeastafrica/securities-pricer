# securities-pricer backend

Django API behind the ALTX securities pricer. Holds the shared bond master,
the marks, and an immutable record of every pricing run.

## Why it exists

The SPA kept all state in browser local storage, so two people logging in got
two private copies and nothing was auditable. This moves panels, bonds, yields
and runs into Postgres.

## Engine

`pricer/engine.py` is pure Python with no Django imports, so it can be tested
on its own and reused elsewhere. It reproduces the JSX engine exactly, verified
field-by-field to 1e-9 (see `EngineParityTests`), with one deliberate change:

A stated coupon date is now rolled forward in whole 182-day periods until it
precedes the valuation date. The JS version used the stated date forever, so a
stale `lastCpn` produced accrued interest spanning several coupon periods and a
negative `daysToNext`, which in turn gave a discount factor above 1 and wrong
duration and convexity. Pass `roll=False` to reproduce the old behaviour.

On the seed data this changes two instruments and leaves four untouched:

| symbol | anchor | old dirty | new dirty | diff |
|---|---|---|---|---|
| GKB05331265 | 2025-05-19 | 99.8856 | 87.2356 | −12.6500 |
| GKB01411296 | 2026-02-17 | 113.7424 | 107.2599 | −6.4825 |

Both differences are exactly whole half-coupons, which is the signature of
removing surplus accrual rather than shifting prices arbitrarily.

## Setup

    python3 -m venv venv && source venv/bin/activate
    pip install -r requirements.txt
    cp .env.example .env     # then edit
    python manage.py migrate
    python manage.py seed_bonds
    python manage.py createsuperuser
    python manage.py test pricer

## API

| route | purpose |
|---|---|
| `GET /api/panels/` | panels with their instruments |
| `GET/POST /api/bonds/` | instrument master and marks |
| `POST /api/run/` | price everything live, persist a run |
| `GET /api/runs/` | run history with rows |
| `GET /api/whoami/` | current user |

## Not done yet

- Auth against Algomax users; currently Django's own user table
- `MarkChange` is modelled but not yet written on bond edits
- Batch file generation and the Algomax order path
- Equities / DR panel
- Ex-coupon, tax, amortisation, holiday calendars — see the technical document
