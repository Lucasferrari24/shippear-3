"""Etiqueta las imágenes de data/ con el modelo maestro (la ruta /api/inspect de la app) y genera labels YOLO.

- La CLASE sale de la carpeta (el defecto que se pidió al generar la imagen); el maestro aporta las CAJAS.
- Si el maestro ve otro estado de tapa que el de la carpeta, la imagen queda marcada en el reporte para revisión.
- Las respuestas se guardan en work/readings/: volver a correr no vuelve a llamar a la API.

Requiere la app corriendo (npm run dev) con ANTHROPIC_API_KEY.

Uso:
  python autolabel.py                # etiqueta lo que falta
  python autolabel.py --relabel      # regenera los .txt desde las lecturas guardadas, sin llamar a la API
  python autolabel.py --refresh      # vuelve a consultar al maestro para todas las imágenes
"""
from __future__ import annotations

import argparse
import base64
import concurrent.futures as cf
import csv
import io
import json

import requests
from PIL import Image, ImageOps

from common import (
    CAP_STATE_CLASS,
    FOLDER_CAP_STATE,
    Sample,
    calibrate_bands,
    iter_samples,
    label_path,
    load_config,
    load_reading,
    reading_path,
)


def ask_teacher(cfg: dict, s: Sample) -> dict:
    im = ImageOps.exif_transpose(Image.open(s.path)).convert("RGB")
    im.thumbnail((cfg["autolabel"]["max_side"],) * 2)
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=90)
    payload = {
        "image": "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode(),
        "width": im.width,
        "height": im.height,
    }
    r = requests.post(cfg["autolabel"]["inspect_url"], json=payload, timeout=120)
    if r.status_code != 200:
        raise RuntimeError(f"HTTP {r.status_code}: {r.text[:200]}")
    res = r.json()
    reading = res["reading"]
    reading["_width"], reading["_height"] = res["width"], res["height"]
    reading["_teacher_model"] = res.get("model")
    return reading


def yolo_line(cls_id: int, box: dict, w: float, h: float) -> str:
    x0, x1 = sorted((max(0.0, box["x0"]), min(w, box["x1"])))
    y0, y1 = sorted((max(0.0, box["y0"]), min(h, box["y1"])))
    return f"{cls_id} {(x0 + x1) / 2 / w:.6f} {(y0 + y1) / 2 / h:.6f} {(x1 - x0) / w:.6f} {(y1 - y0) / h:.6f}"


def build_label(cfg: dict, s: Sample, r: dict) -> tuple[list[str], list[str]]:
    """Devuelve (líneas YOLO, problemas). Sin líneas = la imagen no entra al dataset."""
    classes = cfg["classes"]
    w, h = r["_width"], r["_height"]
    problems = []
    bottle = r.get("bottle_box")
    if not bottle or bottle["y1"] <= bottle["y0"] or bottle["x1"] <= bottle["x0"]:
        return [], ["sin caja de botella"]

    expected = FOLDER_CAP_STATE[s.folder_class]
    if r.get("cap_state") != expected:
        problems.append(f"maestro ve tapa '{r.get('cap_state')}', la carpeta dice '{expected}'")

    lines = [yolo_line(classes.index("botella"), bottle, w, h)]
    cap_box = r.get("spout_box") if expected == "ausente" else r.get("cap_box")
    cap_box = cap_box or (r.get("cap_box") if expected == "ausente" else r.get("spout_box"))
    if not cap_box:
        return [], problems + ["sin caja de tapa/pico"]
    lines.append(yolo_line(classes.index(CAP_STATE_CLASS[expected]), cap_box, w, h))

    y = r.get("liquid_surface_y")
    if y is None:
        problems.append("sin menisco")
    else:
        half = max(3.0, cfg["autolabel"]["menisco_half_height"] * (bottle["y1"] - bottle["y0"]))
        men = {"x0": bottle["x0"], "x1": bottle["x1"], "y0": y - half, "y1": y + half}
        lines.append(yolo_line(classes.index("menisco"), men, w, h))
    return lines, problems


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--refresh", action="store_true", help="volver a consultar al maestro aunque haya lectura guardada")
    ap.add_argument("--relabel", action="store_true", help="solo regenerar etiquetas desde las lecturas guardadas")
    args = ap.parse_args()
    cfg = load_config()
    samples = iter_samples(cfg["data_dir"])
    if not samples:
        raise SystemExit(f"No hay imágenes en {cfg['data_dir']} (ver data/README.md).")

    todo = [] if args.relabel else [s for s in samples if args.refresh or load_reading(cfg, s) is None]
    print(f"{len(samples)} imágenes; consultando al maestro por {len(todo)}")
    errors = {}

    def work(s: Sample):
        try:
            r = ask_teacher(cfg, s)
            p = reading_path(cfg, s)
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(json.dumps(r, ensure_ascii=False, indent=1), encoding="utf-8")
        except Exception as e:  # noqa: BLE001 - se informa en el reporte
            errors[s.rel] = str(e)

    with cf.ThreadPoolExecutor(cfg["autolabel"]["workers"]) as ex:
        for i, _ in enumerate(ex.map(work, todo), 1):
            if i % 5 == 0 or i == len(todo):
                print(f"  {i}/{len(todo)}")

    report = cfg["work_dir"] / "autolabel_report.csv"
    report.parent.mkdir(parents=True, exist_ok=True)
    ok = flagged = skipped = 0
    with open(report, "w", newline="", encoding="utf-8") as f:
        wr = csv.writer(f)
        wr.writerow(["imagen", "estado", "detalle"])
        for s in samples:
            lp = label_path(cfg, s)
            r = load_reading(cfg, s)
            if r is None:
                wr.writerow([s.rel.as_posix(), "error", errors.get(s.rel, "sin lectura")])
                lp.unlink(missing_ok=True)
                skipped += 1
                continue
            lines, problems = build_label(cfg, s, r)
            if not lines:
                wr.writerow([s.rel.as_posix(), "descartada", "; ".join(problems)])
                lp.unlink(missing_ok=True)
                skipped += 1
                continue
            lp.parent.mkdir(parents=True, exist_ok=True)
            lp.write_text("\n".join(lines) + "\n", encoding="utf-8")
            if problems:
                wr.writerow([s.rel.as_posix(), "revisar", "; ".join(problems)])
                flagged += 1
            else:
                wr.writerow([s.rel.as_posix(), "ok", ""])
                ok += 1

    bands = calibrate_bands(cfg, samples)
    (cfg["work_dir"] / "bands.json").write_text(json.dumps(bands, indent=1), encoding="utf-8")
    print(f"etiquetadas: {ok} ok, {flagged} para revisar, {skipped} descartadas -> {report}")
    print("banda de llenado calibrada:", bands)


if __name__ == "__main__":
    main()
