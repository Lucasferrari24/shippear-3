-- Esquema v1 de quality_control.db (tal como lo entregó el equipo, 24/10/2026).
-- Lo aplica src/lib/db.ts al crear una base nueva.

CREATE TABLE product_recipes (
    id TEXT PRIMARY KEY,
    sku TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    cap_color TEXT,
    fill_min_mm REAL,
    fill_max_mm REAL,
    cap_max_angle_deg REAL,
    cap_max_gap_mm REAL,
    min_detection_confidence REAL NOT NULL DEFAULT 0.75
        CHECK (min_detection_confidence >= 0 AND min_detection_confidence <= 1),
    is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE capture_devices (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    source TEXT NOT NULL,
    resolution_width INTEGER,
    resolution_height INTEGER,
    notes TEXT,
    is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE model_versions (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    format TEXT NOT NULL CHECK (format IN ('onnx', 'pytorch', 'other')),
    relative_path TEXT NOT NULL,
    sha256 TEXT,
    classes_json TEXT NOT NULL DEFAULT '[]',
    is_active INTEGER NOT NULL DEFAULT 0 CHECK (is_active IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE inspection_runs (
    id TEXT PRIMARY KEY,
    started_at TEXT NOT NULL,
    ended_at TEXT,
    recipe_id TEXT REFERENCES product_recipes(id),
    capture_device_id TEXT REFERENCES capture_devices(id),
    model_version_id TEXT REFERENCES model_versions(id),
    operator_name TEXT,
    notes TEXT
);

CREATE TABLE inspections (
    id TEXT PRIMARY KEY,
    captured_at TEXT NOT NULL,
    processed_at TEXT NOT NULL,
    verdict TEXT NOT NULL CHECK (verdict IN ('OK', 'NOK', 'REVIEW', 'ERROR')),
    recipe_id TEXT REFERENCES product_recipes(id),
    capture_device_id TEXT REFERENCES capture_devices(id),
    model_version_id TEXT REFERENCES model_versions(id),
    run_id TEXT REFERENCES inspection_runs(id),
    processing_ms INTEGER CHECK (processing_ms >= 0),
    overall_confidence REAL CHECK (overall_confidence >= 0 AND overall_confidence <= 1),
    source TEXT NOT NULL DEFAULT 'camera' CHECK (source IN ('camera', 'upload', 'dataset', 'test')),
    error_message TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE image_assets (
    id TEXT PRIMARY KEY,
    inspection_id TEXT NOT NULL REFERENCES inspections(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('original', 'annotated', 'crop')),
    relative_path TEXT NOT NULL UNIQUE,
    mime_type TEXT NOT NULL,
    sha256 TEXT NOT NULL,
    bytes INTEGER NOT NULL CHECK (bytes >= 0),
    width INTEGER,
    height INTEGER,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE detections (
    id TEXT PRIMARY KEY,
    inspection_id TEXT NOT NULL REFERENCES inspections(id) ON DELETE CASCADE,
    yolo_class_id INTEGER,
    class_name TEXT NOT NULL,
    confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
    x REAL NOT NULL,
    y REAL NOT NULL,
    width REAL NOT NULL CHECK (width >= 0),
    height REAL NOT NULL CHECK (height >= 0),
    coordinate_space TEXT NOT NULL DEFAULT 'pixel' CHECK (coordinate_space IN ('pixel', 'normalized'))
);

CREATE TABLE defects (
    id TEXT PRIMARY KEY,
    inspection_id TEXT NOT NULL REFERENCES inspections(id) ON DELETE CASCADE,
    code TEXT NOT NULL CHECK (code IN (
        'CAP_MISSING', 'CAP_OPEN', 'CAP_MISALIGNED',
        'LEVEL_LOW', 'LEVEL_HIGH', 'LOW_CONFIDENCE',
        'BOTTLE_NOT_FOUND', 'IMAGE_QUALITY', 'PROCESSING_ERROR'
    )),
    confidence REAL CHECK (confidence >= 0 AND confidence <= 1),
    severity TEXT NOT NULL DEFAULT 'reject' CHECK (severity IN ('info', 'warning', 'reject')),
    details_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE inspection_measurements (
    id TEXT PRIMARY KEY,
    inspection_id TEXT NOT NULL REFERENCES inspections(id) ON DELETE CASCADE,
    metric TEXT NOT NULL,
    value REAL,
    unit TEXT NOT NULL,
    lower_limit REAL,
    upper_limit REAL,
    passed INTEGER CHECK (passed IN (0, 1)),
    UNIQUE (inspection_id, metric)
);

CREATE TABLE sync_outbox (
    id TEXT PRIMARY KEY,
    inspection_id TEXT NOT NULL UNIQUE REFERENCES inspections(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    last_error TEXT,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_defects_inspection_id ON defects(inspection_id);
CREATE INDEX idx_detections_inspection_id ON detections(inspection_id);
CREATE INDEX idx_image_assets_inspection_id ON image_assets(inspection_id);
CREATE INDEX idx_inspections_captured_at ON inspections(captured_at DESC);
CREATE INDEX idx_inspections_verdict ON inspections(verdict, captured_at DESC);

INSERT INTO product_recipes (id, sku, display_name, cap_color, min_detection_confidence) VALUES ('recipe-clasico', 'clasico', 'Clásico', 'roja', 0.75);
INSERT INTO product_recipes (id, sku, display_name, cap_color, min_detection_confidence) VALUES ('recipe-stevia', 'stevia', 'Stevia', 'verde', 0.75);
INSERT INTO schema_migrations (version) VALUES (1);
