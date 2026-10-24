# Prompt para v0 — LaVirshion

> Copiá todo lo que está debajo de la línea y pegalo en v0 (v0.app). Si v0 lo corta, mandalo en dos partes: hasta "Pantallas" y después el resto.

---

Diseñá y construí la interfaz web de **LaVirshion**, una app de control de calidad por visión con IA para la línea de envasado de edulcorante líquido **Virginia** (proyecto del Shippe.ar Hackathon #3, Rosario). Antes se llamaba "Centinela QC": ese nombre no debe aparecer en ningún lado.

## Qué hace la app

Al final de la línea, cada botella transparente con líquido incoloro tiene que salir con la tapa bien puesta y el llenado dentro de tolerancia. Hay dos modelos de botella: **Clásico** (tapa roja) y **Stevia** (tapa verde).

1. El operario sube o saca una foto (o muchas a la vez).
2. **La IA mide**: un modelo de visión (el "maestro", Claude) devuelve cajas en píxeles del envase, pico y tapa, el estado de la tapa, la separación tapa-pico, la altura del menisco, una confianza 0–1 y una frase de evidencia.
3. **Las reglas deciden**: un motor determinístico convierte el nivel en fracción de la altura del envase y lo compara con la banda mín/máx de cada modelo. El veredicto es auditable.
4. **Calibración en un click**: marcar una botella buena fija la banda en ±4 %. Los veredictos de todo el lote se recalculan al instante en el cliente, sin volver a llamar a la IA.
5. **Trazabilidad**: cada foto queda con sus cotas dibujadas encima y la evidencia; el lote se exporta a CSV.
6. **Modo recolección** (opcional, apagado por defecto): cada foto se guarda en una base con la lectura del maestro, se compara con el modelo local (YOLO, todavía no integrado en el navegador) y entra a una cola del dataset para reentrenar, con revisión humana.

## Estilo visual

- **Oscuro, redondeado, estilo Apple** (macOS Sonoma / visionOS / Apple Health en dark mode): fondos casi negros con capas de gris (`#000`, `#0B0B0F`, `#1C1C1E`, `#2C2C2E`), tarjetas con radio grande (20–28 px), botones tipo pill, bordes de 1 px muy sutiles (`white/8%`), materiales translúcidos con `backdrop-blur` en barras y paneles flotantes, sombras suaves, mucho aire.
- Tipografía: **Geist** (ya está en el proyecto) con jerarquía tipo SF Pro: títulos grandes y apretados (`tracking-tight`), números en **Geist Mono** con `tabular-nums`. Nada de mayúsculas gritonas salvo etiquetas mínimas.
- Movimiento sutil con **motion** (framer-motion): resortes suaves al entrar tarjetas, conteo animado de números, transición del veredicto, skeletons con shimmer mientras inspecciona. Respetar `prefers-reduced-motion`.
- Iconos **lucide-react**, trazo fino.
- Impactante pero sobrio: el veredicto OK/NOK es el protagonista, grande, con un glow suave del color correspondiente. Nada de gradientes chillones ni estética genérica de "IA".

### Color por analítica (regla principal)

Cada dominio de análisis tiene su color principal, usado en su icono, sus gráficos, el acento de sus tarjetas y su pestaña. Usá los colores de sistema de Apple en dark mode:

| Dominio | Color | Uso |
|---|---|---|
| **Tapa** | Ámbar/naranja `#FF9F0A` | estado de tapa, defectos de tapa, gap tapa-pico, caja de tapa en el overlay |
| **Nivel** | Cian `#64D2FF` | nivel de llenado, banda mín/máx, menisco, calibración |
| **Dataset / Maestro** | Violeta `#BF5AF2` | modo recolección, cola de revisión, muestras, comparación local vs maestro |
| **Línea / Tendencias** | Índigo `#5E5CE6` | tablero por línea y día, volumen, tiempos |
| **Pico** (solo overlay) | Lavanda `#A78BFA` | caja del pico |

Los colores de **estado** son independientes y no se usan para otra cosa:

| Estado | Color |
|---|---|
| OK | Verde `#30D158` |
| NOK | Rojo `#FF453A` |
| Indeterminado / Revisar | Amarillo `#FFD60A` |
| Error de proceso | Gris `#8E8E93` |

Clásico y Stevia se muestran como un **chip chico** con un punto rojo o verde (el color real de la tapa), nunca como color de fondo, para no confundirse con OK/NOK. Todo color tiene que pasar contraste AA sobre el fondo, y el estado nunca depende solo del color: siempre va con icono y texto.

Definí los colores como tokens CSS (variables de shadcn/ui en Tailwind 4: `--background`, `--card`, `--primary`, más `--cap`, `--level`, `--dataset`, `--line`, `--ok`, `--nok`, `--review`).

## Stack y restricciones

- **Next.js 15 App Router, React 19, TypeScript, Tailwind CSS 4, shadcn/ui.** Gráficos con los charts de shadcn (Recharts). Toasts con `sonner`. Hojas inferiores en móvil con `vaul` (Drawer de shadcn).
- Todo el texto en **español rioplatense con voseo** ("Arrastrá", "Subí", "Calibrá", "Revisá").
- **Desktop y móvil.** En desktop: sidebar o barra superior translúcida con las secciones. En móvil: tab bar inferior estilo iOS, botón grande "Sacar foto" (input con `capture="environment"`), y el veredicto a pantalla casi completa.
- Accesible: foco visible, navegación con teclado en la grilla de fotos (flechas), `aria-live` para anunciar el veredicto, objetivos táctiles de al menos 44 px.
- Usá **datos mock** que respeten exactamente los tipos de abajo, en un archivo `lib/mock.ts`, y separá la capa de datos (`lib/api.ts`) para que después se conecte a las rutas reales sin tocar componentes.

## Contrato de datos (no cambiar nombres ni valores)

```ts
type Box = { x0: number; y0: number; x1: number; y1: number }; // píxeles, origen arriba-izquierda
type CapState = "ok" | "mal_colocada" | "abierta" | "ausente";
type BottleModel = "clasico" | "stevia" | "desconocido";

type VisionReading = {
  bottle_model: BottleModel;
  bottle_box: Box;
  cap_state: CapState;
  cap_box: Box | null;
  spout_box: Box | null;
  cap_gap_px: number | null;
  liquid_surface_y: number | null; // Y del menisco, null si no se ve
  confidence: number;              // 0..1
  evidence: string;                // 1-2 frases en español
};

type LevelBand = { min: number; max: number }; // fracción de la altura desde ARRIBA: menor = más lleno. Default 0.22–0.34

type DefectCode =
  | "TAPA_MAL_COLOCADA" | "TAPA_ABIERTA" | "SIN_TAPA"
  | "NIVEL_BAJO" | "NIVEL_ALTO" | "NIVEL_NO_DETECTADO" | "BOTELLA_NO_DETECTADA";

type LevelStatus = "ok" | "bajo" | "alto" | "no_medido";
type BottleCategory = "OK" | "ERROR_TAPA" | "ERROR_NIVEL" | "ERROR_COMBINADO" | "INDETERMINADO";

type BottleState = {
  model: BottleModel; detected: boolean; cap: CapState; level: LevelStatus;
  levelFraction: number | null; category: BottleCategory;
  code: string; // "OK" | "TAPA:<cap>" | "NIVEL:<level>" | "COMB:<cap>+<level>" | "INDET:nivel_no_medido" | "INDET:botella_no_detectada"
};

type Verdict = {
  status: "OK" | "NOK"; defects: DefectCode[]; levelFraction: number | null;
  band: LevelBand; bandPx: { min: number; max: number }; bottle: BottleState;
};

type InspectionResult = {
  id: string; createdAt: string; width: number; height: number;
  reading: VisionReading; verdict: Verdict; model: string; latencyMs: number;
};

type Comparison = {
  outcome: "agree" | "disagree" | "teacher_only";
  verdictMatch: boolean | null; capStateMatch: boolean | null; defectsMatch: boolean | null;
  categoryMatch: boolean | null; bottleIou: number | null; capIou: number | null; levelDelta: number | null;
};

type Sample = { id: string; status: "pending" | "approved" | "rejected" | "exported"; labelClass: string | null; reason: string | null };

// Cada foto en la cola del cliente
type Item = {
  key: string; name: string; src: string; width: number; height: number;
  status: "pending" | "running" | "done" | "error";
  result?: InspectionResult;
  feedback?: { comparison: Comparison; sample: Sample };
  error?: string;
};
```

Reglas de veredicto (replicalas en `lib/judge.ts` para que la recalibración sea instantánea):
- `levelFraction = (liquid_surface_y - bottle_box.y0) / altura`. Si `> band.max` → nivel **bajo**; si `< band.min` → **alto**; si no, ok.
- Altura ≤ 0 o confianza < 0,15 → `BOTELLA_NO_DETECTADA`.
- Categoría: tapa con error **y** nivel con error → `ERROR_COMBINADO`; solo tapa → `ERROR_TAPA` (aunque falte el nivel); solo nivel → `ERROR_NIVEL`; botella no detectada o tapa ok sin nivel → `INDETERMINADO`; si no, `OK`.
- **`INDETERMINADO` nunca pasa como OK**: se muestra como NOK con la etiqueta amarilla "Revisar".

Etiquetas visibles:
- Categorías: OK · Error de tapa · Error de nivel · Error combinado (tapa + nivel) · Indeterminado (revisar)
- Tapa: correcta · desnivelada / mal colocada · destapada (capuchón abierto) · ausente
- Nivel: dentro de banda · bajo · alto · no medido
- Defectos: Tapa mal colocada / apoyada · Tapa abierta (capuchón levantado) · Ausencia de tapa · Nivel de líquido bajo · Nivel de líquido alto · No se pudo medir el nivel · No se detectó una botella
- Muestras: aprobada · pendiente de revisión · rechazada · exportada
- Clases del dataset: ok · mal_colocada · abierta · sin_tapa · nivel_bajo · nivel_alto

## Pantallas

### 1. Inspeccionar (inicio)

- **Encabezado**: logo y nombre "LaVirshion", subtítulo "Control de calidad por visión · para Virginia". A la derecha, tres contadores animados: Inspeccionadas, OK (verde), NOK (rojo), más un mini anillo de % de aprobación.
- **Zona de carga**: tarjeta grande redondeada con borde punteado suave. "Arrastrá fotos de botellas o tocá para elegir / sacar una foto" · "Clásico (tapa roja) y Stevia (tapa verde) · varias a la vez". Acepta múltiples imágenes. Estado **arrastrando**: borde y fondo con glow cian, icono que sube. En móvil, botón primario "Sacar foto".
- **Estado vacío** (sin fotos): cuatro tarjetas "Cómo funciona", cada una con el color de su dominio: 1 · Foto, 2 · La IA mide (tapa, ámbar), 3 · Reglas (nivel, cian), 4 · Veredicto (verde/rojo). Con una ilustración simple de botella.
- **Visor principal**: la foto con el **overlay** de cotas dibujado en canvas encima:
  - caja del envase: blanca punteada, etiqueta "envase";
  - caja del pico: lavanda, "pico";
  - caja de la tapa: color según estado (ok verde `#30D158`, mal_colocada ámbar `#FF9F0A`, abierta naranja `#FF6B2C`, ausente rojo `#FF453A`), etiqueta "tapa <estado> · gap Npx";
  - banda MÁX/MÍN: dos líneas cian punteadas con relleno cian al 12 %;
  - línea del nivel: verde si está en banda, roja si no, etiqueta "nivel 27,4%".
  - Etiquetas en pastillas oscuras translúcidas, tipografía mono. Toggle para mostrar u ocultar capas (envase / pico / tapa / banda / nivel) y zoom con pellizco o rueda.
  - Mientras inspecciona: la foto atenuada con un barrido de escaneo animado y el texto "Inspeccionando…".
- **Tira de miniaturas** (grilla 4–8 columnas, proporción 3:4) con un badge por foto: **OK** verde, **NOK** rojo, **Revisar** amarillo, **ERROR** gris, **…** pulsando (pendiente o en curso, distinguir "En cola" de "Analizando"). Seleccionada con anillo blanco. Filtros por categoría arriba de la tira (chips con contador).
- **Panel de detalle** (columna derecha de 380 px en desktop, hoja inferior en móvil):
  - Veredicto gigante OK / NOK con glow, debajo la categoría y el código en mono (`COMB:abierta+bajo`).
  - Dos tarjetas lado a lado: **Tapa** (ámbar) con el estado y el gap en px, y **Nivel** (cian) con un medidor vertical tipo botella que muestra el % medido sobre la banda mín–máx.
  - Lista de defectos con icono.
  - Datos: Modelo (chip Clásico/Stevia/Desconocido), Confianza (barra; amarilla si < 0,7), Latencia en s, Motor (maestro o local).
  - La evidencia del modelo como cita en itálica.
  - Si el modo recolección está activo, tarjeta violeta: "Verificada por el maestro." / "El modelo local coincide con el maestro." / "El modelo local NO coincide con el maestro." + clase de la muestra y su estado (con el motivo si quedó pendiente).
  - Botón **"Calibrar banda con esta foto (es OK)"**, deshabilitado si no hay nivel medido (con tooltip que explica por qué). Al usarlo: toast "Banda de Stevia fijada en 23–31 %. 12 veredictos recalculados."
  - Estado **error**: tarjeta con borde rojo, el mensaje y botón "Reintentar". Mensajes posibles: "Falta ANTHROPIC_API_KEY en el servidor.", "El modelo maestro rechazó la imagen.", "La respuesta del maestro quedó cortada.", "El maestro no devolvió una medición.", errores HTTP.
  - Estado **cargando**: skeleton.
- **Resumen del lote** (debajo del detalle o en una pestaña):
  - Clasificación del lote: barra apilada o donut con las 5 categorías y sus contadores.
  - Defectos del lote: barras horizontales; las de tapa en ámbar y las de nivel en cian.
  - Botón "Exportar reporte CSV" (columnas: archivo, modelo, veredicto, categoria, codigo, estado_tapa, estado_nivel, defectos, nivel_pct, confianza, evidencia; archivo `lavirshion-qc.csv`).

### 2. Calibración de banda (acento cian)

Panel o hoja con un bloque por modelo (Clásico y Stevia): inputs mín y máx (0–1, paso 0,01) y además un **slider de rango doble** sobre una ilustración vertical de la botella, mostrando la banda y los puntos de nivel de las fotos del lote (verdes dentro, rojos fuera). Texto: "Los veredictos se recalculan al instante. Usá «Calibrar» sobre una botella OK para fijar la banda ±4 %." Botón "Restablecer (22–34 %)". Advertencia si mín ≥ máx.

### 3. Modo recolección (acento violeta)

Switch estilo iOS "Recolectar datos para el dataset", apagado por defecto y recordado en el navegador (clave `lavirshion.collect`). Debajo, aviso de privacidad visible: "Cada foto se envía al modelo maestro (Claude, API externa), se compara con el modelo local y se guarda en la base para reentrenar. Activalo solo con fotos que la empresa autorizó a compartir." Al encenderlo por primera vez, diálogo de confirmación con ese mismo texto. Con el modo activo: badge violeta "Recolectando" fijo en la barra superior y una línea de resumen "Dataset: 34 aprobada · 6 pendiente de revisión · comparaciones: 40 teacher_only". Nota: "La recolección solo funciona corriendo la app en local."

### 4. Dataset · Revisión (acento violeta)

- Contadores por estado: pendientes, aprobadas, rechazadas, exportadas.
- **Cobertura del dataset**: matriz 2 × 6 (Clásico/Stevia × las 6 clases) con la cantidad aprobada o exportada por celda contra la meta de ~8 por celda (anillo de progreso por celda, total meta ~100).
- **Cola de revisión** (las pendientes, hasta 50, ordenadas por prioridad y fecha): tarjetas con la foto, el modelo, la clase propuesta por el maestro, el motivo ("el maestro no pudo medir la botella o el nivel", "confianza del maestro 0.62", "el modelo local no coincide con el maestro") y fecha. Las de **prioridad 1** (desacuerdo con el modelo local) llevan una marca "Desacuerdo" y van primero.
- Revisar una muestra: vista grande con el overlay, selector segmentado para **corregir la clase** (6 clases), campo "Revisor", botones **Aprobar** (verde) y **Rechazar** (rojo). Atajos de teclado A / R / ←→ y swipe en móvil. Si se corrige la clase, mostrar "Etiqueta humana". No se puede aprobar sin clase. Errores: "No existe la muestra.", "Para aprobar hace falta la clase.", "Clase inválida".
- Estado vacío: "No hay muestras pendientes 🎉" (sin emoji si queda mejor).

### 5. Tablero de línea (acento índigo)

Datos de las vistas de la base (mock por ahora):
- Selector de línea (default "Línea 1") y rango de fechas.
- `v_line_daily`: por día total, ok, nok, other (REVIEW/ERROR) y tiempo medio de proceso en ms → gráfico de área apilada OK/NOK/Revisar y tarjetas KPI (total, % aprobación, tiempo medio).
- `v_line_defects`: defectos por día y código (CAP_MISALIGNED, CAP_OPEN, CAP_MISSING en ámbar; LEVEL_LOW, LEVEL_HIGH, LEVEL_NOT_FOUND en cian; BOTTLE_NOT_FOUND en gris) → barras apiladas.
- `v_line_categories`: categorías por día.
- `v_state_matrix`: **mapa de calor tapa × nivel** (filas: ok, mal_colocada, abierta, ausente; columnas: ok, bajo, alto, no_medido) con el conteo y el código en cada celda; la celda ok×ok en verde, las de solo tapa en ámbar, solo nivel en cian, combinadas en rojo, indeterminadas en amarillo.

### 6. Salud del modelo (acento violeta, secundario índigo)

- Estado del modelo local: tarjeta "YOLO nano · ONNX — todavía no integrado en el navegador" con estado *Próximamente*; cuando exista, versión y sha.
- `v_model_agreement` por versión: comparadas, coincidencia de veredicto, coincidencia de tapa, IoU medio de botella, IoU medio de tapa, diferencia media de nivel → anillos y barras.
- Resultado de comparaciones: agree / disagree / teacher_only en donut.

## Estados que tienen que estar diseñados

- Sin fotos · arrastrando · en cola · analizando · OK · NOK por cada categoría (tapa, nivel, combinado) · indeterminado/revisar · error con reintento.
- Botella **desconocida** (ni Clásico ni Stevia): chip gris y la banda de Clásico por defecto.
- Nivel no medido: el medidor muestra "—" y el botón de calibrar queda deshabilitado.
- Confianza baja (< 0,7): aviso amarillo sutil.
- Modo recolección apagado / encendido / sin muestras todavía.
- Cola de revisión vacía, tablero sin datos, carga de cada sección (skeletons).
- Lote grande (más de 50 fotos): la tira de miniaturas virtualizada o paginada.

## Recursos de diseño que podés usar

- shadcn/ui — https://github.com/shadcn-ui/ui (componentes base, charts, Drawer, Sonner)
- Magic UI — https://github.com/magicuidesign/magicui (number ticker, border beam, shimmer; compatible con el registry de shadcn)
- Aceternity UI — https://ui.aceternity.com (efectos de spotlight y glow, con moderación)
- Origin UI — https://github.com/origin-space/originui (inputs, sliders de rango, switches)
- Tremor — https://github.com/tremorlabs/tremor (patrones de tablero y KPIs)
- motion — https://github.com/motiondivision/motion
- Vaul — https://github.com/emilkowalski/vaul · Sonner — https://github.com/emilkowalski/sonner
- Lucide — https://github.com/lucide-icons/lucide
- Apple Human Interface Guidelines (colores de sistema, dark mode, materiales) — https://developer.apple.com/design/human-interface-guidelines/color
- Vercel Web Interface Guidelines — https://github.com/vercel-labs/web-interface-guidelines

Pautas de calidad a seguir (vienen de skills de diseño de agentes):
- anthropics/skills · `frontend-design` — https://github.com/anthropics/skills/tree/main/skills/frontend-design : evitar la estética genérica de IA, una dirección visual clara y coherente, tipografía y espaciado con intención.
- vercel-labs/agent-skills · `web-design-guidelines` y `react-best-practices` — https://github.com/vercel-labs/agent-skills : accesibilidad, foco, estados de carga, rendimiento en React/Next.

## Entregable

Una app Next.js navegable con las 6 secciones, datos mock realistas (unas 24 fotos de lote con todos los estados y categorías, 30 días de tablero, 12 muestras pendientes), componentes reutilizables (`VerdictBadge`, `CategoryChip`, `ModelChip`, `CapCard`, `LevelGauge`, `Overlay`, `BandEditor`, `StateMatrix`, `ReviewCard`) y los tokens de color definidos una sola vez. Que se vea premium en desktop a 1440 px y en un iPhone a 390 px.
