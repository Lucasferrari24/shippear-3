"""Arma el dataset YOLO en work/dataset/ a partir de data/ y las etiquetas de autolabel.py.

- real_test/ → split test (solo para evaluar).
- real/ + generated/ → train/val, separados por FOTO DE ORIGEN: una foto real y sus variaciones
  quedan del mismo lado para que val no mida memoria.
- Las imágenes se reescriben con la orientación EXIF aplicada, igual que se las mandó al maestro.

Uso: python build_dataset.py
"""
from __future__ import annotations

import collections
import random
import shutil

import yaml
from PIL import Image, ImageOps

from common import iter_samples, label_path, load_config


def main() -> None:
    cfg = load_config()
    out = cfg["work_dir"] / "dataset"
    if out.exists():
        shutil.rmtree(out)

    samples = [s for s in iter_samples(cfg["data_dir"]) if label_path(cfg, s).exists()]
    if not samples:
        raise SystemExit("No hay imágenes etiquetadas: correr antes autolabel.py.")

    # Agrupar train/val por (modelo, foto de origen) y repartir los grupos por clase dominante.
    groups = collections.defaultdict(list)
    for s in samples:
        if s.source != "real_test":
            groups[(s.bottle_model, s.origin)].append(s)
    rng = random.Random(cfg["split"]["seed"])
    by_class = collections.defaultdict(list)
    for key, items in groups.items():
        dominant = collections.Counter(i.folder_class for i in items).most_common(1)[0][0]
        by_class[(items[0].bottle_model, dominant)].append(key)
    val_keys = set()
    for keys in by_class.values():
        rng.shuffle(keys)
        n_val = round(len(keys) * cfg["split"]["val_fraction"])
        if len(keys) >= 3:
            n_val = max(1, n_val)
        val_keys.update(keys[:n_val])

    counts = collections.defaultdict(collections.Counter)
    for s in samples:
        if s.source == "real_test":
            split = "test"
        else:
            split = "val" if (s.bottle_model, s.origin) in val_keys else "train"
        name = f"{s.source}__{s.bottle_model}__{s.folder_class}__{s.path.stem}"
        img_dst = out / "images" / split / f"{name}.jpg"
        lbl_dst = out / "labels" / split / f"{name}.txt"
        img_dst.parent.mkdir(parents=True, exist_ok=True)
        lbl_dst.parent.mkdir(parents=True, exist_ok=True)
        ImageOps.exif_transpose(Image.open(s.path)).convert("RGB").save(img_dst, "JPEG", quality=95)
        shutil.copyfile(label_path(cfg, s), lbl_dst)
        counts[split][f"{s.bottle_model}/{s.folder_class}"] += 1

    if not counts["val"]:
        raise SystemExit("El split val quedó vacío: hacen falta más fotos de origen distintas.")

    data_yaml = {
        "path": out.as_posix(),
        "train": "images/train",
        "val": "images/val",
        "names": dict(enumerate(cfg["classes"])),
    }
    if counts["test"]:
        data_yaml["test"] = "images/test"
    (out / "dataset.yaml").write_text(yaml.safe_dump(data_yaml, allow_unicode=True, sort_keys=False), encoding="utf-8")
    # La banda calibrada viaja dentro del zip: Colab la escribe en centinela.json al exportar el modelo.
    bands = cfg["work_dir"] / "bands.json"
    if bands.exists():
        shutil.copyfile(bands, out / "bands.json")

    for split in ("train", "val", "test"):
        total = sum(counts[split].values())
        print(f"{split}: {total} imágenes  " + ", ".join(f"{k}={v}" for k, v in sorted(counts[split].items())))
    print("dataset:", out / "dataset.yaml")


if __name__ == "__main__":
    main()
