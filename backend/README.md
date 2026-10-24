# Backend (Render)

API de LaVirshion: corre el detector YOLO ya entrenado (ONNX), llama al maestro (Claude), guarda cada botella en SQLite y sirve las fotos. La interfaz (Vercel) lo llama con `NEXT_PUBLIC_API_URL`.

- Node 24 + [Hono](https://hono.dev), ejecutado con `tsx` (sin paso de build).
- `onnxruntime-node` + `sharp` para el modelo local: [`src/lib/localModel.ts`](src/lib/localModel.ts).
- Maestro: [`src/lib/teacher.ts`](src/lib/teacher.ts), Haiku 5.5 por defecto (`CLAUDE_MODEL`, `CLAUDE_EFFORT`).
- Reglas: [`src/lib/judge.ts`](src/lib/judge.ts) y el contrato de datos [`src/lib/types.ts`](src/lib/types.ts) son copia de los de la interfaz (`src/lib/`): si se cambia uno, hay que cambiar el otro.
- Base: SQLite con `node:sqlite`, migraciones en [`db/`](db/README.md). En Render vive en el disco persistente (`DATA_DIR=/var/data`).

## Correr

```bash
npm install
cp .env.example .env   # completar ANTHROPIC_API_KEY
npm run dev            # http://localhost:8000
```

Las variables están explicadas en [`.env.example`](.env.example). El despliegue en Render lo define [`render.yaml`](../render.yaml) en la raíz del repo.

## Modelo entrenado

Al arrancar carga `models/centinela.onnx` y `models/centinela.json` (ver [`models/README.md`](models/README.md)). Si faltan y están `MODEL_URL` y `MODEL_META_URL`, los descarga. Sin modelo, `POST /api/predict` responde 503 y todo lo demás sigue andando con el maestro.

## API

Las rutas de inspección reciben `{ "image": "data:image/jpeg;base64,...", "width": 1280, "height": 960 }`. `band` (`{ "min", "max" }`) es opcional. `width` y `height` son las medidas de la imagen enviada: las cajas vuelven en esos píxeles.

| Ruta | Modelo | Devuelve |
|---|---|---|
| `GET /health` | — | Estado: base, modelo local cargado (versión y bandas calibradas) y si hay clave del maestro. Lo usa Render como health check |
| `POST /api/predict` | YOLO local (ONNX) | Lectura, veredicto con el estado de la botella y las detecciones crudas. Si no hay modelo entrenado, responde 503 |
| `POST /api/inspect` | Claude (maestro) | Lectura y veredicto con el estado de la botella |
| `POST /api/feedback` | Los dos en paralelo | Guarda la foto, las dos decisiones y la comparación en la base. Si el cliente no manda `local`, el servidor corre el YOLO |
| `GET /api/feedback` | — | Resumen crudo de la cola del dataset y coincidencia del YOLO con el maestro |
| `GET /api/dataset` | — | Cola de revisión (pendientes con la lectura del maestro) y resumen, con la forma que usa la pantalla Dataset |
| `PATCH /api/dataset/<id>` | — | Revisión humana de una muestra: `{ status: "approved" \| "rejected", labelClass?, reviewer? }` |
| `GET /api/lines` | — | Líneas con inspecciones guardadas |
| `GET /api/dashboard?line=&days=` | — | Tablero de una línea: producción diaria, defectos y categorías por día y matriz tapa × nivel |
| `GET /api/model` | — | Modelo local cargado y coincidencia con el maestro por versión |
| `GET /api/stats` | — | Tablero de pérdidas: total, OK, errores, a revisar, % de pérdida, por categoría, por código, por día y línea, matriz tapa × nivel y recorrido por etapas |
| `POST /api/inspections` | — | Guarda una botella con la decisión de un solo modelo, **sin llamar a Claude**. Recibe `image`, `width`, `height`, `engine` (`local`/`teacher`) y `reading`. Opcionales: `detections`, `latencyMs`, `modelVersion`, `state` (el estado votado, que manda sobre el del cuadro), `track` (`{ frames, votes }`), `source` (`camera`/`upload`) y `lineId`. Devuelve `{ inspectionId, state }` |
| `GET /api/inspections` | — | Historial de botellas guardadas, más nuevas primero, con la verificación del maestro, la comparación y la muestra. `limit` (máximo 200) y `offset` |
| `GET /api/inspections/<id>` | — | Detalle de una botella: lo anterior, más las cajas de los dos modelos, los defectos y la lectura completa del maestro |
| `GET /api/images/<id>` | — | Foto guardada (el `image.url` del historial) |

`/api/stats` e `/api/inspections` aceptan los mismos filtros por query string: `from` y `to` (`YYYY-MM-DD`), `line`, `model` (`clasico`/`stevia`), `category`, `code` y `engine` (`local`/`teacher`). Por ejemplo, `/api/stats?from=2026-10-24&category=ERROR_TAPA`.

Ejemplo:

```bash
curl -s localhost:8000/api/predict -H "content-type: application/json" \
  -d "{\"image\":\"data:image/jpeg;base64,$(base64 -w0 foto.jpg)\",\"width\":1280,\"height\":960}"
```

## Elegir el maestro

Para comparar modelos de Claude sobre fotos etiquetadas de `data/`, con un tope de gasto:

```bash
npm run compare-teachers -- --per-class 3 --max-usd 0.5
```

Imprime, por modelo, el acierto de tapa y de categoría, los escapes (NOK que pasan como OK) y el costo por foto.

## Seguridad

La API no tiene autenticación: `CORS_ORIGINS` solo evita que otras páginas la usen desde el navegador. Cada llamada a `/api/inspect` y `/api/feedback` cuesta tokens de Anthropic, así que conviene poner un tope de gasto en la consola de Anthropic.
