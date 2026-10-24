"""Exporta work/best.pt a ONNX para correr en el navegador y lo deja en public/models/.

Genera:
  public/models/centinela.onnx   el detector
  public/models/centinela.json   clases, tamaño de entrada, forma de la salida y bandas calibradas

Uso: python export.py
"""
from __future__ import annotations

import json
import shutil

import numpy as np
import onnxruntime as ort
from ultralytics import YOLO

from common import load_bands, load_config


def main() -> None:
    cfg = load_config()
    weights = cfg["work_dir"] / "best.pt"
    if not weights.exists():
        raise SystemExit("Faltan los pesos: correr antes train.py.")
    imgsz = cfg["train"]["imgsz"]

    # nms=True deja la supresión de cajas dentro del grafo: el navegador recibe [1, N, 6] listo para usar.
    onnx_path = YOLO(str(weights)).export(format="onnx", imgsz=imgsz, opset=17, simplify=True, dynamic=False, nms=True)
    dst_dir = cfg["export_dir"]
    dst_dir.mkdir(parents=True, exist_ok=True)
    dst = dst_dir / "centinela.onnx"
    shutil.copyfile(onnx_path, dst)

    # Verificar que carga y ver la forma real de la salida.
    sess = ort.InferenceSession(str(dst), providers=["CPUExecutionProvider"])
    inp = sess.get_inputs()[0]
    out = sess.run(None, {inp.name: np.zeros((1, 3, imgsz, imgsz), dtype=np.float32)})[0]
    n_cls = len(cfg["classes"])
    # yolo26 (end2end): [1, N, 6] = x1, y1, x2, y2, score, clase. yolo11: [1, 4 + clases, N] y necesita NMS.
    if out.ndim == 3 and out.shape[2] == 6:
        layout = "end2end_xyxy_score_class"
    elif out.ndim == 3 and out.shape[1] == 4 + n_cls:
        layout = "raw_cxcywh_scores_needs_nms"
    else:
        layout = f"desconocido {list(out.shape)}"

    meta = {
        "classes": cfg["classes"],
        "imgsz": imgsz,
        "input": inp.name,
        "input_shape": inp.shape,
        "output_shape": list(out.shape),
        "output_layout": layout,
        "letterbox_pad_value": 114,
        "conf": cfg["predict"]["conf"],
        "bands": load_bands(cfg),
        "weights": weights.name,
    }
    (dst_dir / "centinela.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"ONNX: {dst} ({dst.stat().st_size / 1e6:.1f} MB), salida {list(out.shape)} → {layout}")
    print("metadatos:", dst_dir / "centinela.json")


if __name__ == "__main__":
    main()
