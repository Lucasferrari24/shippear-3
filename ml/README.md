# Pipeline de entrenamiento (YOLO)

Entrena el detector local de Centinela QC con las imágenes de [`data/`](../data/README.md) y lo exporta a ONNX para la app.

```text
base de la app ──► export_feedback.py ──► data/feedback/
                                              │
data/ ──► autolabel.py ──► build_dataset.py ──► train.py ──► evaluate.py ──► export.py ──► public/models/
          (maestro:         (train/val por        (YOLO nano,   (veredicto en     (centinela.onnx
           /api/inspect)     foto de origen)       CPU)          fotos reales)     + centinela.json)
```

Las fotos que verifica el maestro en el modo recolección de la app entran al entrenamiento por `export_feedback.py`. Ese script trae las lecturas del maestro guardadas en la base, así que `autolabel.py` no vuelve a pagar la API por ellas. El esquema está en [`db/README.md`](../db/README.md).

## Clases del detector

| id | clase | de dónde sale la caja |
|---|---|---|
| 0 | `botella` | `bottle_box` del maestro |
| 1 | `tapa_ok` | `cap_box`, carpetas `ok`, `nivel_bajo` y `nivel_alto` |
| 2 | `tapa_mal_colocada` | `cap_box`, carpeta `mal_colocada` |
| 3 | `tapa_abierta` | `cap_box`, carpeta `abierta` |
| 4 | `pico_sin_tapa` | `spout_box`, carpeta `sin_tapa` |
| 5 | `menisco` | franja fina en `liquid_surface_y`, del ancho de la botella |

**La clase la decide la carpeta y las cajas las pone el maestro.** El veredicto no lo da el detector: sale de las mismas reglas que [`inspection.ts`](../src/lib/inspection.ts). El nivel se compara contra la banda calibrada, y el modelo de botella (Clásico o Stevia) se deduce del color de la tapa.

## Preparación (una sola vez)

```powershell
py -3.12 -m venv ml\.venv
ml\.venv\Scripts\python -m pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu
ml\.venv\Scripts\python -m pip install -r ml\requirements.txt
```

Para el etiquetado automático hace falta la app corriendo con la clave de Anthropic:

```powershell
copy .env.example .env.local   # completar ANTHROPIC_API_KEY
npm run dev
```

## Entrenar

1. Copiar las imágenes en `data/<real|generated|real_test>/<clasico|stevia>/<clase>/`, siguiendo las reglas de [`data/README.md`](../data/README.md).
2. Desde la carpeta `ml/`, con la app corriendo:

```powershell
cd ml
.venv\Scripts\python pipeline.py
```

El pipeline corre los seis pasos en orden. Si uno falla, se retoma desde ahí con `--from`:

```powershell
.venv\Scripts\python pipeline.py --from train
```

| Paso | Qué deja | Qué revisar |
|---|---|---|
| `export_feedback.py` | `data/feedback/`, lecturas en `work/readings/feedback/` | Cuántas muestras quedaron pendientes de revisión |
| `autolabel.py` | `work/labels/`, `work/readings/`, `work/bands.json` | `work/autolabel_report.csv`: las filas **revisar** (el maestro no coincide con la carpeta) y **descartada** |
| `build_dataset.py` | `work/dataset/` | Que val y test tengan imágenes de todas las clases |
| `train.py` | `work/best.pt`, curvas en `work/runs/detect/` | Con unas 100 imágenes en CPU (Ryzen 5 7530U), 60 épocas tardan entre 35 y 45 minutos; con `--epochs 40`, unos 25 |
| `evaluate.py` | `work/eval_test.md` | **Escapes** y **falsos rechazos** en fotos reales |
| `export.py` | `public/models/centinela.onnx` y `.json` | Que `output_layout` sea `end2end_xyxy_score_class` |

`autolabel.py` guarda cada respuesta del maestro: volver a correrlo solo consulta las imágenes nuevas. Con `--relabel` regenera las etiquetas sin llamar a la API.

## Entrenar en Colab (GPU)

Para no esperar el entrenamiento en CPU, el paso `train` se puede correr en Colab con [`colab_train.ipynb`](colab_train.ipynb):

1. En la PC, con la app corriendo: `autolabel.py` y `build_dataset.py`.
2. Comprimir el dataset desde la raíz del repo: `Compress-Archive -Path ml\work\dataset -DestinationPath dataset.zip -Force`.
3. Abrir el notebook en Colab con GPU T4, subir `dataset.zip` y ejecutar las celdas. El notebook corrige la ruta del `dataset.yaml` y entrena con los parámetros de `config.yaml`, salvo `device: 0` y `batch: 32`.
4. Copiar el `best.pt` descargado en `ml/work/best.pt` y seguir con `pipeline.py --from evaluate`.

Si se cambian los parámetros de `train:` en `config.yaml`, hay que cambiarlos también en el notebook.

## Probar el entorno sin imágenes

```powershell
cd ml
.venv\Scripts\python smoke_test.py
```

Genera botellas sintéticas, entrena 2 épocas y exporta, todo dentro de `work/smoke/`. No llama a la API ni toca `data/` o `public/`. Sirve solo para confirmar que el entorno funciona; sus métricas no significan nada.

## Notas

- **Licencia:** Ultralytics es AGPL-3.0. Para el hackathon no hay problema; para un producto comercial hay que migrar a RF-DETR o D-FINE (Apache 2.0) o comprar la licencia.
- **CPU:** los parámetros de `config.yaml` (`batch: 8`, `workers: 2`) están pensados para una notebook sin GPU. Con GPU NVIDIA, cambiar `device: 0` y subir `batch`.
- **Aumentaciones:** el tono (`hsv_h`) está bajo a propósito para que el modelo no confunda la tapa roja con la verde.
