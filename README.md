# Centinela QC

**Control de calidad por visión con IA para la línea de envasado de Virginia.**
Shippe.ar Hackathon #3 · Rosario · 24-10-26 · Track **Vertical AI** · Desafío *Control de Calidad por Visión* (Virginia).

> Subís la foto de una botella de edulcorante y en segundos obtenés **OK / NOK**, el **defecto** detectado y las **cotas dibujadas sobre la imagen**.

- 🔗 **Demo:** _(URL HTTPS de Vercel)_
- ▶️ **Video (2 min):** _(link de YouTube)_

## El problema

Al final de la línea, cada botella (modelos **Clásico**, de tapa roja, y **Stevia**, de tapa verde) tiene que salir con la tapa bien colocada y el llenado dentro de tolerancia. Hoy esa inspección es visual y humana: es lenta, se cansa y no deja registro. Los defectos que hay que detectar son:

| # | Defecto | Qué se ve |
|---|---|---|
| 01 | Tapa mal colocada / apoyada | Tapa inclinada, con separación visible con el pico |
| 02 | Tapa abierta | Capuchón levantado, con separación sobre la tapa |
| 03 | Ausencia de tapa | Pico descubierto |
| 04 | Nivel fuera de banda | La superficie del líquido queda fuera de la banda mín/máx |

## Cómo lo resolvemos

Separamos **percepción** de **decisión**:

1. **La IA mide.** Un modelo de visión (Claude) recibe la foto y devuelve una medición estructurada: el modelo de botella, cajas de envase, pico y tapa en píxeles, el estado de la tapa, la separación tapa-pico, la altura del menisco y la evidencia en texto. La salida usa *structured outputs*, así que siempre llega un JSON que cumple el esquema.
2. **Las reglas deciden.** Un motor determinístico ([`src/lib/inspection.ts`](src/lib/inspection.ts)) convierte el nivel en una fracción de la altura del envase y lo compara contra la banda de cada modelo. El veredicto es auditable y reproducible.
3. **Calibración en un click.** Marcás una botella buena como referencia y la banda queda fijada en ±4%. Los veredictos de todo el lote se recalculan en el cliente sin volver a llamar a la IA.
4. **Trazabilidad.** Cada foto queda con sus cotas superpuestas y la evidencia. Podés procesar lotes de muchas fotos en paralelo y exportar todo a CSV.

El líquido es incoloro y el envase transparente, así que un umbral de píxeles clásico es frágil frente a reflejos e iluminación. El modelo de visión ubica el menisco por refracción y contexto. Las tolerancias, en cambio, quedan del lado de las reglas, donde el equipo de calidad las controla.

## Datos y entrenamiento

No usamos datasets públicos: ninguno tiene tapas a presión con capuchón ni nivel de líquido incoloro (el análisis está en [`docs/investigacion-vision-qc-botellas-tapas.md`](docs/investigacion-vision-qc-botellas-tapas.md)). El dataset es propio:

- **Fotos reales de producción** de los modelos Clásico y Stevia.
- **Variaciones generadas con Gemini** a partir de esas fotos, con cada defecto: unas 100 imágenes en total.
- **Un set de fotos reales reservado** para evaluar, que nunca se usa para entrenar.

La estructura y las reglas están en [`data/README.md`](data/README.md). Las imágenes no se suben al repo.

**Modelo local y maestro:**

1. **Modelo local:** un detector YOLO nano entrenado con [`ml/`](ml/README.md) y exportado a ONNX en `public/models/`. Corre en el servidor con `onnxruntime-node`, en [`src/lib/localModel.ts`](src/lib/localModel.ts).
2. **Modelo maestro:** Claude, en [`src/lib/teacher.ts`](src/lib/teacher.ts), con salida estructurada. Por defecto usa Haiku 5.5, el más barato; se cambia con `CLAUDE_MODEL` y `CLAUDE_EFFORT`. Para elegir con datos, comparar modelos sobre fotos etiquetadas con un tope de gasto:

   ```bash
   npx tsx --env-file=.env.local scripts/compare-teachers.ts --per-class 3 --max-usd 0.5
   ```

   El script imprime, por modelo, el acierto de tapa y de categoría, los escapes (NOK que pasan como OK) y el costo por foto.
3. **Modo de recolección:** un interruptor en la interfaz, desactivado por defecto. Cada foto se verifica con el maestro y se compara con el modelo local. Todo se guarda en SQLite: [`db/README.md`](db/README.md) tiene el esquema y la cola del dataset. Las muestras aprobadas vuelven al entrenamiento con `ml/export_feedback.py`.

## Cámara en vivo (`/camara`)

Analiza el video de la cámara cuadro por cuadro y **cuenta cada botella una sola vez**:

- **Fuente:** la cámara del dispositivo (elige la trasera en el celular) o un video de prueba.
- **Modelo:**
  - **YOLO local:** analiza cuadros sin parar, unos 8 a 10 por segundo en la notebook.
  - **Claude:** analiza 1 cuadro cada N segundos, porque tarda unos 8 s y cobra por llamada.
- **Conteo** ([`src/lib/bottleTracker.ts`](src/lib/bottleTracker.ts)):
  - Supone una botella por vez frente a la cámara.
  - Mientras la botella se ve, cada cuadro vota un código de clasificación.
  - Cuando deja de verse durante 4 cuadros, se cierra con el código más votado. En un empate gana el error.
  - Las apariciones de menos de 3 cuadros se descartan como ruido.
- **Panel:**
  - el estado actual (categoría, código, tapa y nivel);
  - las botellas contadas por categoría;
  - la **pérdida**: cantidad y porcentaje de botellas que no son OK;
  - el historial.
- **Guardar cada botella en la base** (activado por defecto, sin costo): al cerrarse cada botella, guarda su mejor foto, el estado votado entre todos sus cuadros y la decisión del modelo con `POST /api/inspections`. Así el tablero (`/api/stats`) cuenta todo lo que pasa por la línea.
- **Verificar cada botella con Claude** (opcional, con costo): en vez de lo anterior, la manda a `/api/feedback`. Claude la revisa, se compara con el YOLO y queda en la cola del dataset. Cuesta una llamada por botella, unos US$0,0007 con Haiku.

La cámara necesita HTTPS, salvo en `localhost`. Desde un celular conviene usar la URL de Vercel. Si el YOLO no detecta una botella en ningún cuadro, esa botella no se cuenta: la calidad del conteo depende del modelo entrenado.

## API

Las tres rutas reciben `{ "image": "data:image/jpeg;base64,...", "width": 1280, "height": 960 }`. `band` (`{ "min", "max" }`) es opcional.

| Ruta | Modelo | Devuelve |
|---|---|---|
| `POST /api/predict` | YOLO local (ONNX) | Lectura, veredicto con el estado de la botella y las detecciones crudas. Si no hay modelo entrenado, responde 503 |
| `POST /api/inspect` | Claude (maestro) | Lectura y veredicto con el estado de la botella |
| `POST /api/feedback` | Los dos en paralelo | Guarda la foto, las dos decisiones y la comparación en la base. Si el cliente no manda `local`, el servidor corre el YOLO |
| `GET /api/feedback` | — | Resumen de la cola del dataset y coincidencia del YOLO con el maestro |
| `PATCH /api/dataset/<id>` | — | Revisión humana de una muestra |
| `GET /api/stats` | — | Tablero de pérdidas: total, OK, errores, a revisar, % de pérdida, por categoría, por código, por día y línea, matriz tapa × nivel y recorrido por etapas |
| `POST /api/inspections` | — | Guarda una botella con la decisión de un solo modelo, **sin llamar a Claude**. Recibe `image`, `width`, `height`, `engine` (`local`/`teacher`) y `reading`. Opcionales: `detections`, `latencyMs`, `modelVersion`, `state` (el estado votado, que manda sobre el del cuadro), `track` (`{ frames, votes }`), `source` (`camera`/`upload`) y `lineId`. Devuelve `{ inspectionId, state }` |
| `GET /api/inspections` | — | Historial de botellas guardadas, más nuevas primero, con la verificación del maestro, la comparación y la muestra. `limit` (máximo 200) y `offset` |
| `GET /api/inspections/<id>` | — | Detalle de una botella: lo anterior, más las cajas de los dos modelos, los defectos y la lectura completa del maestro |
| `GET /api/images/<id>` | — | Foto guardada (el `image.url` del historial) |

`/api/stats` e `/api/inspections` aceptan los mismos filtros por query string: `from` y `to` (`YYYY-MM-DD`), `line`, `model` (`clasico`/`stevia`), `category`, `code` y `engine` (`local`/`teacher`). Por ejemplo, `/api/stats?from=2026-10-24&category=ERROR_TAPA`.

Las botellas entran a la base por dos caminos:
- **`POST /api/inspections`**: la cámara guarda cada botella del YOLO, sin costo.
- **`POST /api/feedback`**: la pantalla de fotos con "Recolectar datos", o la cámara con "Verificar con Claude". Además de guardar la botella, Claude la verifica.

En el tablero, `funnel.teacher_verified` dice cuántas pasaron por Claude.

Ejemplo:

```bash
curl -s localhost:3000/api/predict -H "content-type: application/json" \
  -d "{\"image\":\"data:image/jpeg;base64,$(base64 -w0 foto.jpg)\",\"width\":1280,\"height\":960}"
```

`width` y `height` son las medidas de la imagen enviada: las cajas vuelven en esos píxeles.

## Stack

- Next.js 15 (App Router) + React 19 + Tailwind 4
- Anthropic SDK: Claude (Haiku 5.5 por defecto) con visión y salida estructurada, en [`src/lib/teacher.ts`](src/lib/teacher.ts)
- SQLite con `node:sqlite` (Node 22.5 o superior), en [`src/lib/db.ts`](src/lib/db.ts) y [`db/`](db/README.md)
- YOLO (Ultralytics) para el modelo local, en [`ml/`](ml/README.md)
- Overlay en Canvas, en [`src/components/Overlay.tsx`](src/components/Overlay.tsx)
- `onnxruntime-node` y `sharp` para correr el YOLO en el servidor
- Deploy en Vercel (la recolección de datos necesita correr en local: el disco de Vercel no persiste). `onnxruntime-node` pesa unos 300 MB con binarios de todas las plataformas: si la función de Vercel supera el límite de tamaño, `/api/predict` tiene que correr en local o en un servidor propio

## Correr localmente

```bash
npm install
cp .env.example .env.local   # completar ANTHROPIC_API_KEY
npm run dev
```

Abrí http://localhost:3000 y arrastrá fotos.

## Fuera de alcance (según el desafío)

La integración con la línea de producción (PLC, cámara en línea, expulsor) no entra en este hackathon. Los siguientes pasos serían:

- procesar video directamente, inspeccionando una vez cada botella que pasa;
- reentrenar por lotes con las fotos revisadas del modo de recolección;
- un tablero de tendencias por turno.

## Equipo

_(nombres)_
