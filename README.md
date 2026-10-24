# LaVirshion (Centinela QC)

**Control de calidad por visión con IA para la línea de envasado de Virginia.**
Shippe.ar Hackathon #3 · Rosario · 24-10-26 · Track **Vertical AI** · Desafío *Control de Calidad por Visión* (Virginia).

> Subís la foto de una botella de edulcorante (o apuntás la cámara a la línea) y en segundos obtenés **OK / NOK**, el **defecto** detectado y las **cotas dibujadas sobre la imagen**.

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

1. **La IA mide.** Un detector YOLO entrenado con fotos propias (o Claude, el modelo maestro) devuelve una medición estructurada: el modelo de botella, cajas de envase, pico y tapa en píxeles, el estado de la tapa y la altura del menisco.
2. **Las reglas deciden.** Un motor determinístico ([`judge.ts`](src/lib/judge.ts)) convierte el nivel en una fracción de la altura del envase y lo compara contra la banda de cada modelo. El veredicto es auditable y reproducible, y el mismo archivo corre en el backend y en la interfaz.
3. **El maestro enseña.** En el modo recolección, Claude verifica cada foto, se compara con el YOLO y la muestra entra a una cola de revisión para el próximo entrenamiento.
4. **Trazabilidad.** Cada botella queda guardada con su foto, sus cotas, su estado y la decisión del modelo. El tablero muestra la pérdida por día, defecto y combinación tapa × nivel.

El líquido es incoloro y el envase transparente, así que un umbral de píxeles clásico es frágil frente a reflejos e iluminación. Las tolerancias quedan del lado de las reglas, donde el equipo de calidad las controla.

## Arquitectura

```text
 Navegador ──► Vercel: interfaz Next.js (raíz del repo)
                  │  NEXT_PUBLIC_API_URL
                  ▼
              Render: backend Node (backend/)
                  ├─ modelo YOLO ya entrenado: backend/models/centinela.onnx (onnxruntime-node)
                  ├─ maestro: Claude (Anthropic API)
                  └─ disco persistente /var/data: base SQLite + fotos guardadas

 Colab (GPU): ml/colab_train.ipynb entrena y exporta centinela.onnx ──► backend/models/
```

| Carpeta | Qué es | Dónde corre |
|---|---|---|
| [`src/`](src) | Interfaz: inspección por lote, cámara en vivo, recolección, dataset, tablero y salud del modelo | Vercel |
| [`backend/`](backend/README.md) | API: modelo local, maestro, base SQLite, fotos | Render ([`render.yaml`](render.yaml)) |
| [`ml/`](ml/README.md) | Preparación del dataset y cuaderno de Colab para entrenar | PC + Colab (no se despliega) |
| [`data/`](data/README.md) | Estructura del dataset propio (las fotos no se suben) | — |

**Datos.** No usamos datasets públicos: ninguno tiene tapas a presión con capuchón ni nivel de líquido incoloro (el análisis está en [`docs/investigacion-vision-qc-botellas-tapas.md`](docs/investigacion-vision-qc-botellas-tapas.md)). El dataset es propio: fotos reales de producción, variaciones generadas con Gemini a partir de ellas (unas 100 imágenes) y un set de fotos reales reservado para evaluar.

**El backend no entrena.** Carga el modelo ya entrenado al arrancar; para cambiarlo se reemplazan los archivos de `backend/models/` (o las URLs de `MODEL_URL`) y se vuelve a desplegar.

## Despliegue

### 1. Backend en Render

1. En Render: **New → Blueprint**, elegir este repositorio. Render lee [`render.yaml`](render.yaml) y crea el servicio `lavirshion-api` (Node 24, plan Starter, disco de 1 GB en `/var/data`).
2. Completar las variables que quedan pendientes:
   - `ANTHROPIC_API_KEY`: la clave de Anthropic (sin ella solo funciona el YOLO).
   - `CORS_ORIGINS`: los dominios de la interfaz, por ejemplo `https://lavirshion.vercel.app,https://*.vercel.app`.
   - `MODEL_URL` y `MODEL_META_URL`: solo si el modelo no está versionado en `backend/models/`.
3. Esperar el deploy y abrir `https://<servicio>.onrender.com/health`: tiene que responder `"ok": true` y, si el modelo está cargado, `"local": { "available": true, ... }`.

### 2. Interfaz en Vercel

El proyecto de Vercel ya está conectado al repositorio (raíz del repo, framework Next.js). Falta una variable:

- `NEXT_PUBLIC_API_URL` = `https://<servicio>.onrender.com` (sin barra final), en Production y Preview.

Después, volver a desplegar: las variables `NEXT_PUBLIC_*` se fijan en el build. `.vercelignore` deja afuera `backend/` y `ml/`.

### 3. Modelo entrenado

1. Entrenar en Colab con [`ml/colab_train.ipynb`](ml/colab_train.ipynb) (los pasos previos están en [`ml/README.md`](ml/README.md)).
2. Descomprimir `centinela_model.zip` en `backend/models/` (quedan `centinela.onnx` y `centinela.json`), commit y push. Render vuelve a desplegar y lo carga.

Sin modelo, todo sigue funcionando con el maestro; la pantalla **Modelo** dice "No integrado".

## Correr localmente

```bash
# backend (puerto 8000)
cd backend
npm install
cp .env.example .env        # completar ANTHROPIC_API_KEY
npm run dev
```

```bash
# interfaz (puerto 3000), en otra terminal desde la raíz
npm install
cp .env.example .env.local  # NEXT_PUBLIC_API_URL=http://localhost:8000
npm run dev
```

Abrí http://localhost:3000 y arrastrá fotos. En local, la base y las fotos quedan en `data/`.

## Pantallas

- **Inspeccionar:** lote de fotos analizado de a 2, con el selector **YOLO local / Claude**. Por defecto usa el YOLO si el backend lo tiene cargado, y las bandas arrancan en las calibradas al entrenar.
- **Cámara:** analiza el video cuadro por cuadro y cuenta cada botella una sola vez ([`bottleTracker.ts`](src/lib/bottleTracker.ts)): mientras la botella se ve, cada cuadro vota un código; cuando deja de verse durante 4 cuadros, se cierra con el más votado (en un empate gana el error). Puede guardar cada botella en la base sin costo, o verificarla con Claude. Necesita HTTPS, salvo en `localhost`.
- **Recolección:** con el interruptor encendido, cada foto inspeccionada también va a `POST /api/feedback`: Claude la verifica, se compara con el YOLO y queda en la cola del dataset.
- **Dataset:** cola de revisión humana, primero los desacuerdos; cobertura aprobada por clase.
- **Tablero:** producción, rechazos por categoría y por defecto, y mapa tapa × nivel por línea.
- **Modelo:** versión del YOLO cargado y cuánto coincide con el maestro.

## Stack

- Interfaz: Next.js 15 (App Router) + React 19 + Tailwind 4 + componentes de v0 (Radix, Recharts, Motion)
- Backend: Node 24 + Hono, `onnxruntime-node` y `sharp` para el YOLO, Anthropic SDK (Claude Haiku 5.5 por defecto, con salida estructurada) y SQLite con `node:sqlite`
- Modelo: YOLO nano (Ultralytics) entrenado en Colab y exportado a ONNX con NMS dentro del grafo

## Fuera de alcance (según el desafío)

La integración con la línea de producción (PLC, cámara en línea, expulsor) no entra en este hackathon. Los siguientes pasos serían:

- señal al expulsor desde la cámara en vivo;
- reentrenar por lotes con las fotos revisadas del modo de recolección;
- un tablero de tendencias por turno.

## Equipo

_(nombres)_
