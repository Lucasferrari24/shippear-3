-- 003: estado de cada botella en dos variables (tapa y nivel) y la categoría que sale de ellas.
-- Misma lógica que la clase Bottle (src/lib/bottle.ts):
--   tapa con error OR nivel con error → ERROR_TAPA / ERROR_NIVEL
--   tapa con error AND nivel con error → ERROR_COMBINADO
--   sin botella detectada, o tapa OK sin nivel medible → INDETERMINADO (inspección en REVIEW)

ALTER TABLE inspections ADD COLUMN cap_status TEXT
    CHECK (cap_status IN ('ok', 'mal_colocada', 'abierta', 'ausente'));
ALTER TABLE inspections ADD COLUMN level_status TEXT
    CHECK (level_status IN ('ok', 'bajo', 'alto', 'no_medido'));
ALTER TABLE inspections ADD COLUMN category TEXT
    CHECK (category IN ('OK', 'ERROR_TAPA', 'ERROR_NIVEL', 'ERROR_COMBINADO', 'INDETERMINADO'));
-- OK · TAPA:<estado> · NIVEL:<estado> · COMB:<tapa>+<nivel> · INDET:<motivo>
ALTER TABLE inspections ADD COLUMN classification_code TEXT;
CREATE INDEX idx_inspections_category ON inspections(category, captured_at DESC);

ALTER TABLE teacher_reviews ADD COLUMN level_status TEXT
    CHECK (level_status IN ('ok', 'bajo', 'alto', 'no_medido'));
ALTER TABLE teacher_reviews ADD COLUMN category TEXT
    CHECK (category IN ('OK', 'ERROR_TAPA', 'ERROR_NIVEL', 'ERROR_COMBINADO', 'INDETERMINADO'));
ALTER TABLE teacher_reviews ADD COLUMN classification_code TEXT;

ALTER TABLE feedback_comparisons ADD COLUMN category_match INTEGER CHECK (category_match IN (0, 1));

-- Inspecciones por línea, día y categoría.
CREATE VIEW v_line_categories AS
SELECT i.line_id, date(i.captured_at) AS day, i.category, COUNT(*) AS n
FROM inspections i
WHERE i.category IS NOT NULL
GROUP BY i.line_id, date(i.captured_at), i.category;

-- Detalle de cada combinación tapa × nivel (las "permutaciones" de errores).
CREATE VIEW v_state_matrix AS
SELECT i.line_id, i.cap_status, i.level_status, i.category, i.classification_code, COUNT(*) AS n
FROM inspections i
WHERE i.category IS NOT NULL
GROUP BY i.line_id, i.cap_status, i.level_status, i.category, i.classification_code;
