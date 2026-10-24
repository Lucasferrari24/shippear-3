"""Prueba de humo del pipeline completo con imágenes sintéticas, sin llamar a la API.

Dibuja botellas falsas (tapa roja o verde, con defectos y niveles distintos), escribe lecturas
como las que devolvería el maestro y corre: autolabel --relabel → build_dataset → train (2 épocas)
→ evaluate → export. Todo queda en work/smoke/ y no toca data/ ni public/.

Uso: python smoke_test.py
"""
from __future__ import annotations

import json
import os
import random
import shutil
import subprocess
import sys
from pathlib import Path

import yaml
from PIL import Image, ImageDraw

from common import BOTTLE_MODELS, FOLDER_CLASSES, ML_DIR

ROOT = ML_DIR / "work" / "smoke"
CAP_COLOR = {"clasico": (200, 30, 35), "stevia": (40, 160, 60)}


def draw(model: str, cls: str, rng: random.Random) -> tuple[Image.Image, dict]:
    W, H = 480, 640
    img = Image.new("RGB", (W, H), tuple(rng.randint(150, 200) for _ in range(3)))
    d = ImageDraw.Draw(img)
    bw, bh = rng.randint(130, 170), rng.randint(380, 440)
    x0, y0 = (W - bw) // 2 + rng.randint(-30, 30), 140 + rng.randint(-20, 20)
    bottle = {"x0": x0, "y0": y0 - 60, "x1": x0 + bw, "y1": y0 + bh}
    d.rectangle([x0, y0, x0 + bw, y0 + bh], fill=(225, 230, 235), outline=(120, 120, 130), width=3)
    sx0, sx1 = x0 + bw // 2 - 18, x0 + bw // 2 + 18
    spout = {"x0": sx0, "y0": y0 - 60, "x1": sx1, "y1": y0}
    d.rectangle([sx0, y0 - 40, sx1, y0], fill=(225, 230, 235), outline=(120, 120, 130), width=2)
    level = {"nivel_bajo": 0.45, "nivel_alto": 0.12}.get(cls, 0.28) + rng.uniform(-0.02, 0.02)
    surface = bottle["y0"] + level * (bottle["y1"] - bottle["y0"])
    d.rectangle([x0 + 3, surface, x0 + bw - 3, y0 + bh - 3], fill=(205, 215, 225))
    d.line([x0 + 3, surface, x0 + bw - 3, surface], fill=(90, 100, 110), width=3)
    cap = None
    if cls != "sin_tapa":
        lift = {"mal_colocada": 14, "abierta": 0}.get(cls, 0)
        tilt = 8 if cls == "mal_colocada" else 0
        cap = {"x0": sx0 - 8, "y0": y0 - 62 - lift, "x1": sx1 + 8, "y1": y0 - 30 - lift}
        d.polygon([(cap["x0"], cap["y0"] + tilt), (cap["x1"], cap["y0"] - tilt),
                   (cap["x1"], cap["y1"] - tilt), (cap["x0"], cap["y1"] + tilt)], fill=CAP_COLOR[model])
        if cls == "abierta":
            d.polygon([(cap["x0"], cap["y0"]), (cap["x0"] - 30, cap["y0"] - 30), (cap["x0"] - 22, cap["y0"] - 38),
                       (cap["x0"] + 8, cap["y0"])], fill=CAP_COLOR[model])
            cap["x0"] -= 30
            cap["y0"] -= 38
    reading = {
        "bottle_model": model, "bottle_box": bottle,
        "cap_state": {"sin_tapa": "ausente", "mal_colocada": "mal_colocada", "abierta": "abierta"}.get(cls, "ok"),
        "cap_box": cap, "spout_box": spout, "cap_gap_px": None, "liquid_surface_y": surface,
        "confidence": 0.9, "evidence": "sintética", "_width": W, "_height": H, "_teacher_model": "smoke",
    }
    return img, reading


def main() -> None:
    if ROOT.exists():
        shutil.rmtree(ROOT)
    data, work = ROOT / "data", ROOT / "work"
    rng = random.Random(0)
    n = 0
    for source, per_class in (("real", 3), ("generated", 2), ("real_test", 1)):
        for model in BOTTLE_MODELS:
            for cls in FOLDER_CLASSES:
                for i in range(per_class):
                    name = f"{model}{cls}{i}" if source != "generated" else f"{model}{cls}{i % 3}__{cls}_{i}"
                    img, reading = draw(model, cls, rng)
                    p = data / source / model / cls / f"{name}.jpg"
                    p.parent.mkdir(parents=True, exist_ok=True)
                    img.save(p, quality=92)
                    rp = work / "readings" / source / model / cls / f"{name}.json"
                    rp.parent.mkdir(parents=True, exist_ok=True)
                    rp.write_text(json.dumps(reading), encoding="utf-8")
                    n += 1
    print(f"{n} imágenes sintéticas en {data}")

    cfg = yaml.safe_load(open(ML_DIR / "config.yaml", encoding="utf-8"))
    cfg.update(data_dir="data", work_dir="work", export_dir="export")
    cfg_path = ROOT / "config.yaml"
    cfg_path.write_text(yaml.safe_dump(cfg, allow_unicode=True), encoding="utf-8")

    env = {**os.environ, "CENTINELA_CONFIG": str(cfg_path)}
    steps = [
        ["autolabel.py", "--relabel"],
        ["build_dataset.py"],
        ["train.py", "--epochs", "2", "--imgsz", "320"],
        ["evaluate.py", "--split", "test"],
        ["export.py"],
    ]
    for step in steps:
        print(f"\n=== {' '.join(step)} ===", flush=True)
        if subprocess.call([sys.executable, str(ML_DIR / step[0]), *step[1:]], cwd=ML_DIR, env=env) != 0:
            raise SystemExit(f"Falló {step[0]}")
    print("\nPrueba de humo OK. Salida en", ROOT)


if __name__ == "__main__":
    main()
