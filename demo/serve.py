#!/usr/bin/env python3
"""Serve the Inclusion production build on 127.0.0.1 only. Not for Hosting."""
from __future__ import annotations

import argparse
import functools
import http.server
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_ROOT = os.path.abspath(os.path.join(HERE, "..", "dist"))


def main() -> int:
    parser = argparse.ArgumentParser(description="Serve the Inclusion demo on localhost.")
    parser.add_argument("--host", default="127.0.0.1", help="Bind address. Keep this on 127.0.0.1.")
    parser.add_argument("--port", type=int, default=4173)
    parser.add_argument("--root", default=DEFAULT_ROOT)
    args = parser.parse_args()
    root = os.path.abspath(args.root)
    if not os.path.isdir(root):
        print(f"Build folder not found: {root}", file=sys.stderr)
        print("Run npm run build from the Inclusion repo first.", file=sys.stderr)
        return 1
    if args.host not in {"127.0.0.1", "localhost"}:
        print("Refusing to bind on a non-loopback address. This demo stays on this computer.", file=sys.stderr)
        return 2
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=root)
    server = http.server.ThreadingHTTPServer((args.host, args.port), handler)
    print(f"Serving {root} at http://{args.host}:{args.port}/")
    print("This is a local demo only. Do not deploy this folder to Firebase Hosting.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
