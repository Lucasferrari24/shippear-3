"""Configuración, rutas y reglas compartidas por los scripts del pipeline.

Las reglas de veredicto replican `judge()` de src/lib/inspection.ts: si se cambia una, hay que cambiar la otra.
"""
from __future__ import annotations

import json
import os
import statistics
from dataclasses import dataclass
from pathlib import Path

import yaml

ML_DIR = Path(__file__).resolve().parent
IMG_EXT = {".jpg", ".jpeg", ".png", ".webp"}
BOTTLE_MODELS = ("clasico", "stevia")
SOURCES = ("real", "generated", "feedback", "real_test")

# Clase de la carpeta → estado de tapa esperado (como CapState en inspection.ts).
FOLDER_CAP_STATE = {
    "ok": "ok",
    "mal_colocada": "mal_colocada",
    "abierta": "abierta",
    "sin_tapa": "ausente",
    "nivel_bajo": "ok",
    "nivel_alto": "ok",
}

# Estado de tapa → clase del detector que va en la caja de tapa/pico.
CAP_STATE_CLASS = {
    "ok": "tapa_ok",
    "mal_colocada": "tapa_mal_colocada",
    "abierta": "tapa_abierta",
    "ausente": "pico_sin_tapa",
}
CLASS_CAP_STATE = {v: k for k, v in CAP_STATE_CLASS.items()}

# Clase de la carpeta → defectos esperados (como DefectCode en inspection.ts).
FOLDER_DEFECTS = {
    "ok": set(),
    "mal_colocada": {"TAPA_MAL_COLOCADA"},
    "abierta": {"TAPA_ABIERTA"},
    "sin_tapa": {"SIN_TAPA"},
    "nivel_bajo": {"NIVEL_BAJO"},
    "nivel_alto": {"NIVEL_ALTO"},
}
FOLDER_CLASSES = list(FOLDER_DEFECTS)

# Clase de la carpeta → categoría esperada (como BottleCategory en src/lib/bottle.ts).
FOLDER_CATEGORY = {
    "ok": "OK",
    "mal_colocada": "ERROR_TAPA",
    "abierta": "ERROR_TAPA",
    "sin_tapa": "ERROR_TAPA",
    "nivel_bajo": "ERROR_NIVEL",
    "nivel_alto": "ERROR_NIVEL",
}
CATEGORIES = ["OK", "ERROR_TAPA", "ERROR_NIVEL", "ERROR_COMBINADO", "INDETERMINADO"]


def load_config(path: str | Path | None = None) -> dict:
    """Lee ml/config.yaml, o el archivo de la variable CENTINELA_CONFIG (lo usa smoke_test.py)."""
    path = Path(path or os.environ.get("CENTINELA_CONFIG") or ML_DIR / "config.yaml")
    cfg = yaml.safe_load(open(path, encoding="utf-8"))
    for key in ("data_dir", "work_dir", "export_dir"):
        cfg[key] = (path.parent / cfg[key]).resolve()
    return cfg


@dataclass
class Sample:
    """Una imagen del dataset con su ubicación en data/<source>/<bottle_model>/<folder_class>/."""

    path: Path
    source: str
    bottle_model: str
    folder_class: str

    @property
    def rel(self) -> Path:
        return Path(self.source, self.bottle_model, self.folder_class, self.path.name)

    @property
    def origin(self) -> str:
        """Foto real de la que sale la imagen: las variaciones se llaman <origen>__<clase>_<n>.jpg."""
        return self.path.stem.split("__")[0]


def iter_samples(data_dir: Path, sources=SOURCES) -> list[Sample]:
    out = []
    for source in sources:
        for model in BOTTLE_MODELS:
            for cls in FOLDER_CLASSES:
                folder = data_dir / source / model / cls
                if folder.is_dir():
                    for p in sorted(folder.iterdir()):
                        if p.suffix.lower() in IMG_EXT:
                            out.append(Sample(p, source, model, cls))
    return out


def reading_path(cfg: dict, s: Sample) -> Path:
    return cfg["work_dir"] / "readings" / s.rel.with_suffix(".json")


def label_path(cfg: dict, s: Sample) -> Path:
    return cfg["work_dir"] / "labels" / s.rel.with_suffix(".txt")


def load_reading(cfg: dict, s: Sample) -> dict | None:
    p = reading_path(cfg, s)
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else None


def judge(reading: dict, band: dict) -> dict:
    """Mismo motor de reglas que judge() en src/lib/inspection.ts."""
    defects = []
    b = reading.get("bottle_box")
    h = (b["y1"] - b["y0"]) if b else 0
    if h <= 0 or reading.get("confidence", 0) < 0.15:
        defects.append("BOTELLA_NO_DETECTADA")
    cap = reading.get("cap_state")
    if cap == "mal_colocada":
        defects.append("TAPA_MAL_COLOCADA")
    if cap == "abierta":
        defects.append("TAPA_ABIERTA")
    if cap == "ausente":
        defects.append("SIN_TAPA")
    level = None
    level_status = "no_medido"
    if reading.get("liquid_surface_y") is None or h <= 0:
        defects.append("NIVEL_NO_DETECTADO")
    else:
        level = (reading["liquid_surface_y"] - b["y0"]) / h
        level_status = "bajo" if level > band["max"] else "alto" if level < band["min"] else "ok"
        if level_status == "bajo":
            defects.append("NIVEL_BAJO")
        if level_status == "alto":
            defects.append("NIVEL_ALTO")
    bottle = bottle_state(cap or "ok", level_status, "BOTELLA_NO_DETECTADA" not in defects)
    return {"status": "OK" if not defects else "NOK", "defects": defects, "levelFraction": level, "bottle": bottle}


def bottle_state(cap: str, level: str, detected: bool = True) -> dict:
    """Misma lógica que la clase Bottle (src/lib/bottle.ts): tapa OR nivel → error; tapa AND nivel → combinado."""
    cap_error = cap != "ok"
    level_error = level in ("bajo", "alto")
    if not detected:
        category, code = "INDETERMINADO", "INDET:botella_no_detectada"
    elif cap_error and level_error:
        category, code = "ERROR_COMBINADO", f"COMB:{cap}+{level}"
    elif cap_error:
        category, code = "ERROR_TAPA", f"TAPA:{cap}"
    elif level_error:
        category, code = "ERROR_NIVEL", f"NIVEL:{level}"
    elif level == "no_medido":
        category, code = "INDETERMINADO", "INDET:nivel_no_medido"
    else:
        category, code = "OK", "OK"
    return {"cap": cap, "level": level, "category": category, "code": code}


def level_fraction(reading: dict) -> float | None:
    b = reading.get("bottle_box")
    y = reading.get("liquid_surface_y")
    if not b or y is None or b["y1"] <= b["y0"]:
        return None
    return (y - b["y0"]) / (b["y1"] - b["y0"])


def calibrate_bands(cfg: dict, samples: list[Sample]) -> dict:
    """Banda por modelo de botella: mediana del nivel en las fotos 'ok' (no de prueba) ± margen."""
    bands = {}
    for model in BOTTLE_MODELS:
        levels = []
        for s in samples:
            if s.bottle_model == model and s.folder_class == "ok" and s.source != "real_test":
                r = load_reading(cfg, s)
                lf = level_fraction(r) if r else None
                if lf is not None:
                    levels.append(lf)
        if levels:
            med = statistics.median(levels)
            m = cfg["band"]["margin"]
            bands[model] = {"min": round(med - m, 4), "max": round(med + m, 4), "n": len(levels)}
        else:
            bands[model] = {**cfg["band"]["default"], "n": 0}
    return bands


def load_bands(cfg: dict) -> dict:
    p = cfg["work_dir"] / "bands.json"
    if p.exists():
        return json.loads(p.read_text(encoding="utf-8"))
    return {m: dict(cfg["band"]["default"]) for m in BOTTLE_MODELS}
