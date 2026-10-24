"""Pasa las muestras aprobadas de la base (dataset_samples) a data/feedback/ para reentrenar.

Por cada muestra aprobada:
  - copia la foto a data/feedback/<modelo>/<clase>/<inspection_id>.<ext>;
  - guarda la lectura del maestro en work/readings/feedback/..., así autolabel.py no vuelve a llamar a la API;
  - la marca como 'exported' en la base.

Uso: python export_feedback.py [--db ../data/quality_control.db] [--dry-run]
"""
from __future__ import annotations

import argparse
import json
import shutil
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

from common import BOTTLE_MODELS, FOLDER_CLASSES, Sample, load_config, reading_path

QUERY = """
SELECT s.id, s.inspection_id, s.bottle_model, s.label_class, a.relative_path, t.reading_json
FROM dataset_samples s
JOIN image_assets a ON a.id = s.image_asset_id
JOIN teacher_reviews t ON t.inspection_id = s.inspection_id
WHERE s.status = 'approved' AND s.label_class IS NOT NULL AND t.status = 'ok'
ORDER BY s.created_at
"""


def main() -> None:
    cfg = load_config()
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default=str(cfg["data_dir"] / "quality_control.db"))
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    db_path = Path(args.db)
    if not db_path.exists():
        print(f"No hay base en {db_path}: nada para exportar.")
        return
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    rows = conn.execute(QUERY).fetchall()

    exported, skipped = 0, []
    now = datetime.now(timezone.utc).isoformat()
    for r in rows:
        if r["bottle_model"] not in BOTTLE_MODELS or r["label_class"] not in FOLDER_CLASSES:
            skipped.append(f"{r['id']}: modelo '{r['bottle_model']}' o clase '{r['label_class']}' no válidos")
            continue
        src = cfg["data_dir"] / r["relative_path"]
        if not src.exists():
            skipped.append(f"{r['id']}: falta la imagen {src}")
            continue
        dst = cfg["data_dir"] / "feedback" / r["bottle_model"] / r["label_class"] / f"{r['inspection_id']}{src.suffix}"
        sample = Sample(dst, "feedback", r["bottle_model"], r["label_class"])
        if not args.dry_run:
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(src, dst)
            rp = reading_path(cfg, sample)
            rp.parent.mkdir(parents=True, exist_ok=True)
            reading = json.loads(r["reading_json"])
            reading["_teacher_model"] = reading.get("_teacher_model", "feedback")
            rp.write_text(json.dumps(reading, ensure_ascii=False, indent=1), encoding="utf-8")
            conn.execute("UPDATE dataset_samples SET status = 'exported', exported_at = ? WHERE id = ?", (now, r["id"]))
        exported += 1
    conn.commit()

    pending = conn.execute("SELECT COUNT(*) FROM dataset_samples WHERE status = 'pending'").fetchone()[0]
    print(f"{'(simulación) ' if args.dry_run else ''}exportadas: {exported} · omitidas: {len(skipped)} · pendientes de revisión: {pending}")
    for s in skipped:
        print("  -", s)


if __name__ == "__main__":
    main()
