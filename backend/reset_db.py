#!/usr/bin/env python
"""Drop, recreate, reseed.

This is the migration story for the next five days, and it is the right one:
the schema is moving every day, and over that horizon reset_db.py is cheaper
than Alembic (SD-6). Alembic is the first post-MVP task. The trigger to write
it is not 22 July -- it is the hosted database starting to hold data we would
mind losing. Until then, nothing in here is precious: it is all in seed.py.

    docker compose up -d
    export DATABASE_URL=postgresql+psycopg://gateway:gateway@localhost:5432/gateway
    python reset_db.py
"""

from __future__ import annotations

import sys

from app.db import DATABASE_URL, SessionLocal, create_all, drop_all
from app.seed import seed_postgres


def main() -> int:
    # The connection string is the only thing that differs between the local
    # Docker database and a hosted one. Print it so a mistake here is loud.
    print(f"target: {DATABASE_URL}")
    if "--yes" not in sys.argv:
        reply = input("this DROPS every table. type 'yes' to continue: ")
        if reply.strip().lower() != "yes":
            print("aborted.")
            return 1

    print("dropping...")
    drop_all()
    print("creating...")
    create_all()
    print("seeding...")
    with SessionLocal() as session:
        seed_postgres(session)

    with SessionLocal() as session:
        from app.repo.postgres import PgAuditRepo, PgRuleRepo, PgToolRepo
        _, total = PgAuditRepo(session).list(limit=1, offset=0)
        print(f"  audit_logs   {total}")
        print(f"  policy_rules {len(PgRuleRepo(session).all())}")
        print(f"  ai_tools     {len(PgToolRepo(session).all())}")
    print("done.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
