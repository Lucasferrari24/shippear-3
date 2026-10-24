# Dataset y entrenamiento (YOLO)

El backend **no entrena**: carga el detector ya entrenado desde `backend/models/` (o lo descarga de `MODEL_URL`). El entrenamiento corre en la GPU de Colab con [`colab_train.ipynb`](colab_train.ipynb). En la PC solo se prepara el dataset.

```text
base del backend ──► export_feedback.py ──► data/feedback/
                                               │
data/ ──► autolabel.py ──► build_dataset.py ──► dataset.zip ──► Colab ──► centinela_model.zip ──► backend/models/
          (maestro:         (train/val/test +                   (entrena,   (centinela.onnx
           /api/inspect)     bands.json)                         exporta)    + centinela.json)
```

Las fotos que verifica el maestro en el modo recolección entran al dataset por `export_feedback.py`. Ese script trae las lecturas del maestro guardadas en la base, así que `autolabel.py` no vuelve a pagar la API por ellas. El esquema está en [`backend/db/README.md`](../backend/db/README.md).

## Clases del detector

| id | clase | de dónde sale la caja |
|---|---|---|
| 0 | `botella` | `bottle_box` del maestro |
| 1 | `tapa_ok` | `cap_box`, carpetas `ok`, `nivel_bajo` y `nivel_alto` |
| 2 | `tapa_mal_colocada` | `cap_box`, carpeta `mal_colocada` |
| 3 | `tapa_abierta` | `cap_box`, carpeta `abierta` |
| 4 | `pico_sin_tapa` | `spout_box`, carpeta `sin_tapa` |
| 5 | `menisco` | franja fina en `liquid_surface_y`, del ancho de la botella |

**La clase la decide la carpeta y las cajas las pone el maestro.** El veredicto no lo da el detector: sale de las mismas reglas que [`judge.ts`](../backend/src/lib/judge.ts). El nivel se compara contra la banda calibrada, y el modelo de botella (Clásico o Stevia) se deduce del color de la tapa.

## Preparación (una sola vez)

```powershell
py -3.12 -m venv ml\.venv
ml\.venv\Scripts\python -m pip install -r ml\requirements.txt
```

No hace falta PyTorch ni Ultralytics en la PC. Para el etiquetado automático hace falta el backend corriendo con la clave de Anthropic (ver [`backend/README.md`](../backend/README.md)):

```powershell
cd backend; npm run dev
```

`autolabel.inspect_url` en [`config.yaml`](config.yaml) apunta a `http://localhost:8000/api/inspect`; se puede cambiar por la URL de Render.

## Armar el dataset y entrenar

1. Copiar las imágenes en `data/<real|generated|real_test>/<clasico|stevia>/<clase>/`, siguiendo las reglas de [`data/README.md`](../data/README.md).
2. Desde la carpeta `ml/`:

```powershell
cd ml
.venv\Scripts\python export_feedback.py   # opcional: suma las muestras aprobadas en la app
.venv\Scripts\python autolabel.py
.venv\Scripts\python build_dataset.py
cd ..; Compress-Archive -Path ml\work\dataset -DestinationPath dataset.zip -Force
```

3. Abrir [`colab_train.ipynb`](colab_train.ipynb) en Colab con GPU, subir `dataset.zip` y ejecutar las celdas. Al final se descarga `centinela_model.zip`.
4. Descomprimirlo en `backend/models/` y hacer commit y push. Render lo carga al desplegar. Sin subir el ONNX al repo: publicar los dos archivos y poner sus URLs en `MODEL_URL` y `MODEL_META_URL` del servicio.

| Paso | Qué deja | Qué revisar |
|---|---|---|
| `export_feedback.py` | `data/feedback/`, lecturas en `work/readings/feedback/` | Cuántas muestras quedaron pendientes de revisión |
| `autolabel.py` | `work/labels/`, `work/readings/`, `work/bands.json` | `work/autolabel_report.csv`: las filas **revisar** (el maestro no coincide con la carpeta) y **descartada** |
| `build_dataset.py` | `work/dataset/` (con `bands.json`) | Que val y test tengan imágenes de todas las clases |
| Colab | `centinela.onnx` y `centinela.json` | mAP en val y que la salida sea `[1, N, 6]` |

`autolabel.py` guarda cada respuesta del maestro: volver a correrlo solo consulta las imágenes nuevas. Con `--relabel` regenera las etiquetas sin llamar a la API.

Una vez desplegado, la pantalla **Modelo** de la interfaz muestra cuánto coincide el detector con el maestro en las fotos verificadas, versión por versión.

## Notas

- **Licencia:** Ultralytics es AGPL-3.0. Para el hackathon no hay problema; para un producto comercial hay que migrar a RF-DETR o D-FINE (Apache 2.0) o comprar la licencia.
- **Aumentaciones:** el tono (`hsv_h`) está bajo a propósito para que el modelo no confunda la tapa roja con la verde.
