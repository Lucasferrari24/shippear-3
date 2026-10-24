"""Corre el pipeline completo: traer muestras de la base → etiquetar → armar dataset → entrenar → evaluar → exportar.

Uso:
  python pipeline.py                 # todo
  python pipeline.py --from train    # retomar desde un paso
  python pipeline.py --epochs 3      # corrida corta de prueba
"""
from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

from common import load_config

STEPS = ["export_feedback", "autolabel", "build_dataset", "train", "evaluate", "export"]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--from", dest="start", default=STEPS[0], choices=STEPS + ["build", "eval"])
    ap.add_argument("--epochs", type=int, default=None)
    args = ap.parse_args()
    start = {"build": "build_dataset", "eval": "evaluate"}.get(args.start, args.start)

    cfg = load_config()
    has_test = any((cfg["data_dir"] / "real_test").rglob("*.jp*g")) or any((cfg["data_dir"] / "real_test").rglob("*.png"))
    here = Path(__file__).parent
    for step in STEPS[STEPS.index(start):]:
        cmd = [sys.executable, str(here / f"{step}.py")]
        if step == "train" and args.epochs:
            cmd += ["--epochs", str(args.epochs)]
        if step == "evaluate" and not has_test:
            print("Aviso: real_test/ está vacío; se evalúa sobre val, que NO mide el desempeño con fotos reales.")
            cmd += ["--split", "val"]
        print(f"\n=== {step} ===", flush=True)
        if subprocess.call(cmd, cwd=here) != 0:
            raise SystemExit(f"Falló el paso {step}.")


if __name__ == "__main__":
    main()
