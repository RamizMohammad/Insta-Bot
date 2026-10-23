"""Run a throwaway local PostgreSQL without Docker (uses the ``pgserver`` dev dependency).

    uv run python scripts/local_postgres.py            # prints a DATABASE_URL and keeps running
    uv run python scripts/local_postgres.py --once     # prints the URL and exits (server may stop)

Data lives in ``~/.cache/instaflow/pgdata`` (override with --data-dir; the path must not contain
spaces, a pg_ctl limitation). Intended for local development and tests only.
"""

from __future__ import annotations

import argparse
import asyncio
import signal
from pathlib import Path

DEFAULT_DIR = Path.home() / ".cache" / "instaflow" / "pgdata"


def start(data_dir: Path = DEFAULT_DIR, database: str = "instaflow") -> str:
    import asyncpg
    import pgserver

    if " " in str(data_dir):
        raise SystemExit(f"Data directory must not contain spaces: {data_dir}")
    data_dir.parent.mkdir(parents=True, exist_ok=True)
    server = pgserver.get_server(str(data_dir), cleanup_mode=None)  # type: ignore[attr-defined]
    uri = server.get_uri()  # postgresql://postgres:@/postgres?host=<socket dir>
    host = uri.split("host=", 1)[1]

    async def _ensure() -> None:
        conn = await asyncpg.connect(user="postgres", database="postgres", host=host)
        try:
            if not await conn.fetchval("SELECT 1 FROM pg_database WHERE datname = $1", database):
                await conn.execute(f'CREATE DATABASE "{database}"')
        finally:
            await conn.close()

    asyncio.run(_ensure())
    return f"postgresql+asyncpg://postgres@/{database}?host={host}"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--database", default="instaflow")
    parser.add_argument("--data-dir", type=Path, default=DEFAULT_DIR)
    parser.add_argument("--once", action="store_true")
    args = parser.parse_args()
    print(start(args.data_dir, args.database), flush=True)
    if not args.once:
        signal.sigwait({signal.SIGINT, signal.SIGTERM})


if __name__ == "__main__":
    main()
