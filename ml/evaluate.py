"""Evalúa el modelo como lo usaría la línea: detecciones → lectura → reglas → veredicto OK/NOK.

La métrica que importa sale de las fotos REALES de real_test/ (split test):
  - escapes: botellas NOK que el modelo deja pasar como OK (lo más grave);
  - falsos rechazos: botellas OK marcadas como NOK;
  - acierto del defecto puntual por clase.
También informa mAP del detector en ese split.

Uso:
  python evaluate.py                 # split test (fotos reales)
  python evaluate.py --split val     # si todavía no hay fotos de prueba
"""
from __future__ import annotations

import argparse
import collections
import json

import numpy as np
from PIL import Image
from ultralytics import YOLO

from common import CLASS_CAP_STATE, FOLDER_CLASSES, FOLDER_DEFECTS, judge, load_bands, load_config

CAP_CLASSES = set(CLASS_CAP_STATE)
DEFECT_TO_CLASS = [
    ("SIN_TAPA", "sin_tapa"),
    ("TAPA_ABIERTA", "abierta"),
    ("TAPA_MAL_COLOCADA", "mal_colocada"),
    ("NIVEL_BAJO", "nivel_bajo"),
    ("NIVEL_ALTO", "nivel_alto"),
]


def bottle_model_from_cap(img: Image.Image, box: dict) -> str:
    """Clásico tiene tapa roja y Stevia verde: se decide por el tono medio de la caja de la tapa."""
    crop = img.crop((box["x0"], box["y0"], box["x1"], box["y1"])).convert("HSV")
    hsv = np.asarray(crop).reshape(-1, 3).astype(float)
    hsv = hsv[(hsv[:, 1] > 60) & (hsv[:, 2] > 40)]  # solo píxeles con color
    if len(hsv) < 20:
        return "desconocido"
    hue = hsv[:, 0] * 360 / 255
    red = np.mean((hue < 25) | (hue > 335))
    green = np.mean((hue > 70) & (hue < 170))
    if max(red, green) < 0.3:
        return "desconocido"
    return "clasico" if red > green else "stevia"


def detections_to_reading(dets: list[tuple[str, float, dict]], img: Image.Image) -> dict:
    """Arma una lectura con la misma forma que VisionReading (src/lib/inspection.ts)."""
    bottles = sorted((d for d in dets if d[0] == "botella"), key=lambda d: -d[1])
    if not bottles:
        return {"bottle_model": "desconocido", "bottle_box": None, "cap_state": "ausente", "cap_box": None,
                "spout_box": None, "cap_gap_px": None, "liquid_surface_y": None, "confidence": 0.0,
                "evidence": "no se detectó la botella"}
    _, bconf, bbox = bottles[0]
    bh = bbox["y1"] - bbox["y0"]

    def inside(box: dict, top_margin: float = 0.15) -> bool:
        cx, cy = (box["x0"] + box["x1"]) / 2, (box["y0"] + box["y1"]) / 2
        return bbox["x0"] <= cx <= bbox["x1"] and bbox["y0"] - top_margin * bh <= cy <= bbox["y1"]

    caps = sorted((d for d in dets if d[0] in CAP_CLASSES and inside(d[2])), key=lambda d: -d[1])
    menis = sorted((d for d in dets if d[0] == "menisco" and inside(d[2], 0)), key=lambda d: -d[1])
    if caps:
        cls, _, cbox = caps[0]
        cap_state = CLASS_CAP_STATE[cls]
        evidence = f"{cls} ({caps[0][1]:.2f})"
    else:
        # Sin tapa ni pico detectados: se trata como ausente para no dejar pasar una botella dudosa.
        cls, cbox, cap_state, evidence = None, None, "ausente", "no se detectó tapa ni pico"
    return {
        "bottle_model": bottle_model_from_cap(img, cbox) if cbox and cap_state != "ausente" else "desconocido",
        "bottle_box": bbox,
        "cap_state": cap_state,
        "cap_box": cbox if cap_state != "ausente" else None,
        "spout_box": cbox if cap_state == "ausente" else None,
        "cap_gap_px": None,
        "liquid_surface_y": (menis[0][2]["y0"] + menis[0][2]["y1"]) / 2 if menis else None,
        "confidence": bconf,
        "evidence": evidence,
    }


def predicted_class(verdict: dict) -> str:
    for code, cls in DEFECT_TO_CLASS:
        if code in verdict["defects"]:
            return cls
    return "ok" if verdict["status"] == "OK" else "indeterminado"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--split", default="test", choices=["test", "val"])
    ap.add_argument("--weights", default=None)
    args = ap.parse_args()
    cfg = load_config()
    weights = args.weights or cfg["work_dir"] / "best.pt"
    img_dir = cfg["work_dir"] / "dataset" / "images" / args.split
    images = sorted(img_dir.glob("*.jpg")) if img_dir.exists() else []
    if not images:
        raise SystemExit(f"No hay imágenes en el split {args.split}.")

    model = YOLO(str(weights))
    names = model.names
    bands = load_bands(cfg)
    rows, conf_m = [], collections.defaultdict(collections.Counter)
    for p in images:
        _, bottle_model, folder_class, _ = p.stem.split("__", 3)
        img = Image.open(p).convert("RGB")
        res = model.predict(img, conf=cfg["predict"]["conf"], device=cfg["train"]["device"], verbose=False)[0]
        dets = [
            (names[int(c)], float(s), dict(zip(("x0", "y0", "x1", "y1"), map(float, xyxy))))
            for xyxy, c, s in zip(res.boxes.xyxy.tolist(), res.boxes.cls.tolist(), res.boxes.conf.tolist())
        ]
        reading = detections_to_reading(dets, img)
        band = bands.get(reading["bottle_model"]) or bands[bottle_model]
        verdict = judge(reading, band)
        pred = predicted_class(verdict)
        conf_m[folder_class][pred] += 1
        rows.append({
            "imagen": p.name, "esperado": folder_class, "predicho": pred, "veredicto": verdict["status"],
            "defectos": verdict["defects"], "nivel": verdict["levelFraction"], "modelo_detectado": reading["bottle_model"],
        })

    n = len(rows)
    exp_nok = [r for r in rows if FOLDER_DEFECTS[r["esperado"]]]
    exp_ok = [r for r in rows if not FOLDER_DEFECTS[r["esperado"]]]
    escapes = sum(r["veredicto"] == "OK" for r in exp_nok)
    false_rej = sum(r["veredicto"] == "NOK" for r in exp_ok)
    verdict_ok = n - escapes - false_rej
    exact = sum(r["esperado"] == r["predicho"] for r in rows)

    metrics = model.val(data=str(cfg["work_dir"] / "dataset" / "dataset.yaml"), split=args.split,
                        device=cfg["train"]["device"], verbose=False, plots=False)
    per_class_map = {names[i]: round(float(m), 3) for i, m in enumerate(metrics.box.maps)}

    cols = FOLDER_CLASSES + ["indeterminado"]
    lines = [
        f"# Evaluación ({args.split}, {n} imágenes)",
        "",
        f"- **Veredicto OK/NOK correcto:** {verdict_ok}/{n} ({verdict_ok / n:.0%})",
        f"- **Escapes** (NOK que pasan como OK): {escapes}/{len(exp_nok)}" + (f" ({escapes / len(exp_nok):.0%})" if exp_nok else ""),
        f"- **Falsos rechazos** (OK marcadas NOK): {false_rej}/{len(exp_ok)}" + (f" ({false_rej / len(exp_ok):.0%})" if exp_ok else ""),
        f"- **Defecto exacto:** {exact}/{n} ({exact / n:.0%})",
        f"- **mAP50 detector:** {metrics.box.map50:.3f} · mAP50-95: {metrics.box.map:.3f}",
        f"- mAP50-95 por clase: {per_class_map}",
        f"- Bandas usadas: {bands}",
        "",
        "## Matriz de confusión (filas = esperado, columnas = predicho)",
        "",
        "| esperado | " + " | ".join(cols) + " |",
        "|---|" + "---|" * len(cols),
    ]
    for c in FOLDER_CLASSES:
        if conf_m[c]:
            lines.append(f"| {c} | " + " | ".join(str(conf_m[c][k]) for k in cols) + " |")
    report = cfg["work_dir"] / f"eval_{args.split}.md"
    report.write_text("\n".join(lines) + "\n", encoding="utf-8")
    (cfg["work_dir"] / f"eval_{args.split}.json").write_text(json.dumps(rows, ensure_ascii=False, indent=1), encoding="utf-8")
    print("\n".join(lines))
    print("\nreporte:", report)


if __name__ == "__main__":
    main()
