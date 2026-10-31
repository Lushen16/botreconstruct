#!/usr/bin/env python3
import argparse
import os
from pathlib import Path
import subprocess
import sys


def main():
    parser = argparse.ArgumentParser(description="Abre o Catch integrado ao runtime Electron; nao envia inputs isolados.")
    parser.add_argument("--pid", type=int, required=True)
    parser.add_argument("--player", required=True)
    args = parser.parse_args()
    if args.pid <= 0 or not args.player.strip():
        parser.error("PID positivo e nome do jogador sao obrigatorios.")
    root = Path(__file__).resolve().parent.parent
    electron = root / "runtime" / "electron-v44.7.2" / "electron.exe"
    app = root / "reconstruction" / "app"
    if not electron.is_file():
        print("Runtime Electron ausente. Execute node tools/build_app.cjs.", file=sys.stderr)
        return 1
    environment = dict(os.environ, PKA_PID=str(args.pid), PKA_PLAYER_NAME=args.player.strip())
    environment.pop("ELECTRON_RUN_AS_NODE", None)
    print("Catch integrado: configure corpos, bolas e captureHotkeys; ative Walker ou Target na interface.", file=sys.stderr)
    try:
        return subprocess.call([str(electron), str(app)], cwd=root, env=environment)
    except OSError as error:
        print(str(error), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
