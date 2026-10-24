"""Entrena el detector YOLO con work/dataset/ y deja los mejores pesos en work/best.pt.

Uso:
  python train.py                  # usa ml/config.yaml
  python train.py --epochs 3       # corrida corta para probar
"""
from __future__ import annotations

import argparse
import shutil

from ultralytics import YOLO

from common import load_config

AUG_KEYS = (
    "fliplr", "flipud", "degrees", "translate", "scale",
    "hsv_h", "hsv_s", "hsv_v", "mosaic", "close_mosaic",
)


def main() -> None:
    cfg = load_config()
    t = cfg["train"]
    ap = argparse.ArgumentParser()
    ap.add_argument("--epochs", type=int, default=t["epochs"])
    ap.add_argument("--model", default=t["model"])
    ap.add_argument("--imgsz", type=int, default=t["imgsz"])
    args = ap.parse_args()

    data = cfg["work_dir"] / "dataset" / "dataset.yaml"
    if not data.exists():
        raise SystemExit("Falta el dataset: correr antes build_dataset.py.")

    model = YOLO(args.model)
    model.train(
        data=str(data),
        epochs=args.epochs,
        patience=t["patience"],
        imgsz=args.imgsz,
        batch=t["batch"],
        workers=t["workers"],
        device=t["device"],
        project=str(cfg["work_dir"] / "runs"),
        name="detect",
        exist_ok=True,
        plots=True,
        **{k: t[k] for k in AUG_KEYS},
    )
    best = cfg["work_dir"] / "runs" / "detect" / "weights" / "best.pt"
    shutil.copyfile(best, cfg["work_dir"] / "best.pt")
    print("pesos:", cfg["work_dir"] / "best.pt")


if __name__ == "__main__":
    main()
