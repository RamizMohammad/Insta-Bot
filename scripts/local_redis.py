"""Run an in-memory Redis-compatible server for local development without Docker or Redis installed.

    uv run python scripts/local_redis.py            # listens on 127.0.0.1:6379

Backed by ``fakeredis`` (a dev dependency). Data is lost on exit. Not for production.
"""

from __future__ import annotations

import argparse

from fakeredis import TcpFakeServer


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=6379)
    args = parser.parse_args()
    server = TcpFakeServer((args.host, args.port), server_type="redis")
    print(f"redis://{args.host}:{args.port}/0", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
