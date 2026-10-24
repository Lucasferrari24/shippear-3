-- 002: líneas de producción, verificación con el modelo maestro y cola del dataset.
--
-- Flujo: cada foto genera una inspección (modelo local), el maestro (Claude) la vuelve a medir,
-- se comparan las dos lecturas y la foto entra a dataset_samples para reentrenar.

-- Líneas de producción: dan contexto a cada inspección para los tableros por línea.
CREATE TABLE production_lines (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    location TEXT,
    notes TEXT,
    is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO production_lines (id, name) VALUES ('line-1', 'Línea 1');

ALTER TABLE capture_devices ADD COLUMN line_id TEXT REFERENCES production_lines(id);
ALTER TABLE inspection_runs ADD COLUMN line_id TEXT REFERENCES production_lines(id);
ALTER TABLE inspections ADD COLUMN line_id TEXT REFERENCES production_lines(id);

-- Qué motor dio el veredicto de la inspección y qué botella se vio.
ALTER TABLE inspections ADD COLUMN engine TEXT NOT NULL DEFAULT 'local' CHECK (engine IN ('local', 'teacher'));
ALTER TABLE inspections ADD COLUMN bottle_model TEXT CHECK (bottle_model IN ('clasico', 'stevia', 'desconocido'));
ALTER TABLE inspections ADD COLUMN level_fraction REAL;

-- Las detecciones pueden venir del modelo local, del maestro o de una corrección humana.
ALTER TABLE detections ADD COLUMN source TEXT NOT NULL DEFAULT 'model' CHECK (source IN ('model', 'teacher', 'human'));

-- Banda de llenado en la unidad que usa la app: fracción de la altura de la botella desde arriba.
-- fill_min_mm / fill_max_mm quedan para cuando haya calibración px→mm.
ALTER TABLE product_recipes ADD COLUMN fill_band_min REAL CHECK (fill_band_min >= 0 AND fill_band_min <= 1);
ALTER TABLE product_recipes ADD COLUMN fill_band_max REAL CHECK (fill_band_max >= 0 AND fill_band_max <= 1);
UPDATE product_recipes SET fill_band_min = 0.22, fill_band_max = 0.34;

-- defects: se agrega LEVEL_NOT_FOUND (la app lo informa cuando no ve el menisco).
-- SQLite no permite cambiar un CHECK, así que se recrea la tabla.
CREATE TABLE defects_new (
    id TEXT PRIMARY KEY,
    inspection_id TEXT NOT NULL REFERENCES inspections(id) ON DELETE CASCADE,
    code TEXT NOT NULL CHECK (code IN (
        'CAP_MISSING', 'CAP_OPEN', 'CAP_MISALIGNED',
        'LEVEL_LOW', 'LEVEL_HIGH', 'LEVEL_NOT_FOUND', 'LOW_CONFIDENCE',
        'BOTTLE_NOT_FOUND', 'IMAGE_QUALITY', 'PROCESSING_ERROR'
    )),
    confidence REAL CHECK (confidence >= 0 AND confidence <= 1),
    severity TEXT NOT NULL DEFAULT 'reject' CHECK (severity IN ('info', 'warning', 'reject')),
    details_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO defects_new SELECT * FROM defects;
DROP TABLE defects;
ALTER TABLE defects_new RENAME TO defects;
CREATE INDEX idx_defects_inspection_id ON defects(inspection_id);

-- Respuesta del modelo maestro para una inspección.
CREATE TABLE teacher_reviews (
    id TEXT PRIMARY KEY,
    inspection_id TEXT NOT NULL UNIQUE REFERENCES inspections(id) ON DELETE CASCADE,
    provider TEXT NOT NULL DEFAULT 'anthropic',
    model TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('ok', 'error')),
    verdict TEXT CHECK (verdict IN ('OK', 'NOK')),
    cap_state TEXT CHECK (cap_state IN ('ok', 'mal_colocada', 'abierta', 'ausente')),
    bottle_model TEXT CHECK (bottle_model IN ('clasico', 'stevia', 'desconocido')),
    defect_codes_json TEXT NOT NULL DEFAULT '[]',
    level_fraction REAL,
    confidence REAL CHECK (confidence >= 0 AND confidence <= 1),
    reading_json TEXT,
    latency_ms INTEGER CHECK (latency_ms >= 0),
    error_message TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Comparación modelo local vs. maestro.
CREATE TABLE feedback_comparisons (
    id TEXT PRIMARY KEY,
    inspection_id TEXT NOT NULL UNIQUE REFERENCES inspections(id) ON DELETE CASCADE,
    teacher_review_id TEXT NOT NULL REFERENCES teacher_reviews(id) ON DELETE CASCADE,
    model_version_id TEXT REFERENCES model_versions(id),
    outcome TEXT NOT NULL CHECK (outcome IN ('agree', 'disagree', 'teacher_only')),
    verdict_match INTEGER CHECK (verdict_match IN (0, 1)),
    cap_state_match INTEGER CHECK (cap_state_match IN (0, 1)),
    defects_match INTEGER CHECK (defects_match IN (0, 1)),
    bottle_iou REAL CHECK (bottle_iou >= 0 AND bottle_iou <= 1),
    cap_iou REAL CHECK (cap_iou >= 0 AND cap_iou <= 1),
    level_delta REAL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_feedback_outcome ON feedback_comparisons(outcome, created_at DESC);

-- Cola del dataset: cada foto verificada con su etiqueta, lista para exportar a ml/.
CREATE TABLE dataset_samples (
    id TEXT PRIMARY KEY,
    inspection_id TEXT NOT NULL UNIQUE REFERENCES inspections(id) ON DELETE CASCADE,
    image_asset_id TEXT NOT NULL REFERENCES image_assets(id) ON DELETE CASCADE,
    bottle_model TEXT NOT NULL CHECK (bottle_model IN ('clasico', 'stevia', 'desconocido')),
    label_class TEXT CHECK (label_class IN ('ok', 'mal_colocada', 'abierta', 'sin_tapa', 'nivel_bajo', 'nivel_alto')),
    label_source TEXT NOT NULL CHECK (label_source IN ('teacher', 'human')),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'exported')),
    priority INTEGER NOT NULL DEFAULT 0,
    review_reason TEXT,
    reviewed_by TEXT,
    reviewed_at TEXT,
    exported_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_dataset_samples_status ON dataset_samples(status, priority DESC, created_at);
CREATE INDEX idx_inspections_line ON inspections(line_id, captured_at DESC);

-- Tablero por línea y día.
CREATE VIEW v_line_daily AS
SELECT
    i.line_id,
    date(i.captured_at) AS day,
    COUNT(*) AS total,
    SUM(i.verdict = 'OK') AS ok,
    SUM(i.verdict = 'NOK') AS nok,
    SUM(i.verdict IN ('REVIEW', 'ERROR')) AS other,
    ROUND(AVG(i.processing_ms)) AS avg_processing_ms
FROM inspections i
GROUP BY i.line_id, date(i.captured_at);

-- Defectos por línea y día.
CREATE VIEW v_line_defects AS
SELECT i.line_id, date(i.captured_at) AS day, d.code, COUNT(*) AS n
FROM defects d JOIN inspections i ON i.id = d.inspection_id
GROUP BY i.line_id, date(i.captured_at), d.code;

-- Qué tanto coincide cada versión del modelo local con el maestro.
CREATE VIEW v_model_agreement AS
SELECT
    f.model_version_id,
    COUNT(*) AS compared,
    ROUND(AVG(f.verdict_match), 3) AS verdict_agreement,
    ROUND(AVG(f.cap_state_match), 3) AS cap_agreement,
    ROUND(AVG(f.bottle_iou), 3) AS mean_bottle_iou,
    ROUND(AVG(f.cap_iou), 3) AS mean_cap_iou,
    ROUND(AVG(ABS(f.level_delta)), 4) AS mean_level_delta
FROM feedback_comparisons f
WHERE f.outcome != 'teacher_only'
GROUP BY f.model_version_id;
