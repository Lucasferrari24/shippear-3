# Visión computacional para control de calidad de botellas y tapas

Investigación técnica: enfoques, modelos gratuitos que corren en local y relevamiento de datasets.
Fecha: 24/10/2026. Repo: [Lucasferrari24/shippear-3](https://github.com/Lucasferrari24/shippear-3).

> **Cómo leer las licencias.** Todo lo marcado ✅ permite uso comercial. ⚠️ es no comercial, solo académico o desconocido.
> Las cifras de Roboflow Universe y Kaggle salen de las fichas públicas; revisá cada página antes de entrenar un modelo para producción.
> Listas completas en bruto: [`datasets/kaggle_botellas_tapas.csv`](datasets/kaggle_botellas_tapas.csv) (69 datasets) y
> [`datasets/huggingface_botellas_anomalias.csv`](datasets/huggingface_botellas_anomalias.csv) (106 datasets).

---

## 1. Resumen y recomendación

1. **No existe un dataset público grande, de uso comercial y específico de tapas.** Lo que hay son muchos datasets chicos (100 a 1.000 imágenes) en Roboflow Universe y Kaggle. Sirven para arrancar y validar, pero **para producción hay que capturar imágenes propias de la línea**, con la misma cámara y la misma iluminación.
2. **Conviene combinar dos modelos:**
   - **Detector supervisado** (RF-DETR o D-FINE/DEIM, Apache 2.0) para defectos conocidos y con nombre: tapa ausente, floja, torcida, nivel bajo, etiqueta faltante.
   - **Detector de anomalías no supervisado** (Anomalib: PatchCore, EfficientAD o Dinomaly) entrenado **solo con piezas buenas**, que agarra los defectos raros que nadie etiquetó.
3. **Cuidado con Ultralytics YOLO (YOLO26/YOLO11/YOLOv8):** está bajo **AGPL-3.0**. Un producto comercial o un equipo embebido necesita la licencia Enterprise paga. Si Shippear se va a vender o embeber, la base debería ser RF-DETR, D-FINE/DEIM o RT-DETR, que son Apache 2.0.
4. **La iluminación y la óptica pesan más que el modelo.** Usar luz difusa o de domo para tapas, retroiluminación para el nivel de llenado y el contorno, y un trigger por sensor sincronizado con la cinta.

---

## 2. Qué se inspecciona en botellas y tapas

| Zona | Defectos típicos | Vista / iluminación sugerida | Enfoque |
|---|---|---|---|
| Tapa, presencia y asiento | Ausente, alta, torcida ("cocked"), floja | Lateral, luz frontal difusa | Detección (clases: ok / missing / loose / tilted) |
| Tapa, superficie | Rayas, manchas, agujeros, deformación, color incorrecto | Superior, domo o anillo difuso | Anomalía + detección |
| Anillo de seguridad / tethered cap | Banda rota, puente roto, tethered abierto | Lateral 360° (2 a 4 cámaras o espejos) | Detección / segmentación |
| Interior de tapa (liner) | Junta faltante o arrugada, manchas | Superior, luz de ángulo bajo | Segmentación / anomalía |
| Nivel de llenado | Sobrellenado, subllenado | Lateral, **retroiluminación** | Detección de línea + regla geométrica |
| Etiqueta | Ausente, torcida, rota, arrugada, despegada | Lateral, luz frontal | Detección + geometría (ángulo) |
| Código / fecha de vencimiento | Ilegible, faltante, incorrecto | Superior o lateral, luz difusa | OCR (PaddleOCR / VLM) |
| Cuerpo / cuello / boca | Grietas, burbujas, contaminación, abolladuras | Retroiluminación (vidrio y PET transparente) | Anomalía + detección |

Las máquinas comerciales (KHS Innocheck TSI, Verista CAPQ, KeyeTech) cubren estas mismas categorías. Las cifras de "99,9 %" y ">1.000 botellas/min" son de marketing y no tienen validación independiente ([KHS](https://competence.khs.com/en/technology/ai-sees-more), [KeyeTech](https://en.keyetech.com/display.php?id=262)).

---

## 3. Enfoques técnicos

| Enfoque | Cuándo usarlo | Datos necesarios | Pros | Contras |
|---|---|---|---|---|
| **Visión clásica** (OpenCV: umbrales, contornos, Hough, color HSV) | Nivel de llenado, presencia de tapa, color, altura | Ninguno o muy pocos | Muy rápida, explicable, corre en CPU | Frágil ante cambios de luz o de producto |
| **Detección supervisada** (DETR / YOLO) | Defectos con nombre y frecuentes | 200 a 2.000 imágenes etiquetadas por clase | Localiza y clasifica, estándar de la industria | Hay que etiquetar; no ve defectos nuevos |
| **Clasificación** (OK / NG) | Una cámara, una pieza por imagen | ~500 por clase | Lo más simple | No localiza el defecto |
| **Segmentación** | Medir área de defectos, liner, etiqueta | Máscaras (caras de etiquetar) | Precisión de píxel | Costo de anotación |
| **Anomalía no supervisada** (PatchCore, EfficientAD, Dinomaly) | Defectos raros o desconocidos | **Solo piezas buenas** (50 a 300) | No hay que etiquetar defectos | Más falsos positivos si la luz o la posición varían |
| **Zero/few-shot** (AnomalyCLIP, WinCLIP, Grounding DINO, SAM 3) | Prototipos, pre-etiquetado automático | 0 a 10 | Arranque inmediato | Menos preciso, más lento |
| **VLM local** (Qwen3-VL, Florence-2, Moondream) | Auditoría, OCR difícil, explicar defectos, pre-etiquetado | 0 (o fine-tuning) | Flexible, se pregunta en lenguaje natural | Lento para la línea (cientos de ms a segundos) |

En la práctica conviene combinarlos: geometría clásica para el nivel, un detector para tapa y etiqueta, anomalía como red de seguridad y OCR para la fecha.

---

## 4. Modelos gratuitos para correr en local

### 4.1 Detección de objetos y defectos (supervisado)

| Modelo | Licencia | Notas |
|---|---|---|
| **RF-DETR** (Roboflow, 2025) | ✅ Apache 2.0 (código y pesos COCO). ⚠️ las variantes XL/2XL podrían estar bajo "PML 1.0", verificar | Backbone DINOv2, detección y segmentación. Según Roboflow es el primer modelo real-time con más de 60 mAP en COCO, y RF-DETR-N supera a YOLO11-N por unos 10 mAP ([blog](https://blog.roboflow.com/rf-detr/), [docs](https://rfdetr.roboflow.com/)) |
| **D-FINE** (ICLR 2025) / **DEIM** (CVPR 2025) / **DEIMv2** (sep 2025) | ✅ Apache 2.0 | DEIM+D-FINE: 54,7 a 56,5 AP a 124 y 78 FPS en una T4. DEIMv2 suma backbones DINOv3 y variantes ultralivianas (Pico, Femto, Atto) para edge ([Roboflow](https://roboflow.com/model/deim)) |
| **RT-DETR / RT-DETRv2** (Baidu) | ✅ Apache 2.0 | Base de DEIM y D-FINE, muy probado |
| **YOLO26 / YOLO11 / YOLOv8** (Ultralytics) | ⚠️ **AGPL-3.0** o Enterprise pago | El ecosistema más cómodo (export a ONNX, OpenVINO, TensorRT). YOLO26 es NMS-free. La licencia exige liberar el código o pagar para productos comerciales y embebidos ([licencia](https://www.ultralytics.com/license)) |
| YOLOX, RTMDet (MMDetection) | ✅ Apache 2.0 | Alternativas YOLO-like sin AGPL, algo más viejas |

**Recomendación:** RF-DETR-S/M o D-FINE-S. Para prototipar rápido sirve YOLO26 en interno, pero hay que migrar antes de comercializar.

### 4.2 Detección de anomalías no supervisada

Librería: **[Anomalib](https://github.com/open-edge-platform/anomalib)** (Intel / Open Edge Platform, ✅ Apache 2.0). Desde la v2.x incluye:

| Modelo | Fortaleza |
|---|---|
| **PatchCore** | Referencia histórica en MVTec. Se entrena en minutos con pocas imágenes buenas. El banco de memoria crece con el dataset |
| **EfficientAD** | Latencias de milisegundos y memoria fija. Ideal para la línea ([paper](https://arxiv.org/pdf/2303.14535)) |
| **PaDiM**, FastFlow, STFPM | Livianos y clásicos |
| **Dinomaly** (CVPR 2025), **UniNet** (CVPR 2025) | Agregados en Anomalib v2.1. Estado del arte multi-clase |
| **AnomalyDINO**, **SuperSimpleNet** | Agregados en v2.3. AnomalyDINO usa features DINOv2 y anda bien con muy pocas muestras |
| **WinCLIP** | Zero/few-shot con CLIP |

Anomalib exporta a OpenVINO y ONNX y trae datamodules para MVTec AD, MVTec AD 2, MVTec LOCO, VisA y Real-IAD ([release notes](https://pypi.org/project/anomalib)).
Otro zero-shot: **AnomalyCLIP** (ICLR 2024), código en [zqhang/AnomalyCLIP](https://github.com/zqhang/AnomalyCLIP).

### 4.3 Open-vocabulary y segmentación (pre-etiquetado, prototipos)

| Modelo | Licencia | Uso |
|---|---|---|
| **SAM 3** (Meta, nov 2025; SAM 3.1 en mar 2026) | ⚠️ "SAM License" propia de Meta, leer antes de uso comercial | Segmenta todas las instancias a partir de un texto ("bottle cap") → **pre-etiquetado automático** ([repo](https://github.com/facebookresearch/sam3)) |
| SAM 2 | ✅ Apache 2.0 | Segmentación con clicks y cajas |
| Grounding DINO, OWLv2 | ✅ Apache 2.0 | Detección por texto para auto-etiquetar |
| YOLO-World | ⚠️ GPL/AGPL | Open-vocab rápido |

### 4.4 Modelos visión-lenguaje (VLM) locales

| Modelo | Tamaño | Licencia | Cómo correrlo |
|---|---|---|---|
| **Florence-2** (Microsoft) | 0,23B / 0,77B | ✅ MIT | transformers. Hace caption, detección, OCR y grounding, y es fácil de fine-tunear |
| **Qwen3-VL** | 2B a 235B (30B-A3B MoE) | ✅ Apache 2.0 (la mayoría de los tamaños) | Ollama, llama.cpp, vLLM |
| **Moondream 2** | ~1,9B | ✅ Apache 2.0 | Ollama. API de "point" y localización |
| Gemma 3, MiniCPM-V, Granite Vision | varios | ver cada una | Ollama |

En la línea no reemplazan al detector por latencia. Sirven para **auditar rechazos, leer fechas difíciles y generar etiquetas** ([comparativa Ollama](https://www.promptquorum.com/power-local-llm/ollama-vision-models-review)).

### 4.5 OCR de fechas y lotes

- **PaddleOCR** (✅ Apache 2.0): lo más usado para fechas impresas. Un paper de 2025 informa 97,7 % en fechas de vencimiento ([ExpirySense](https://www.ijraset.com/best-journal/expirysense-expiry-date-detection-and-proactive-alerts)); es una cifra autoinformada.
- Benchmark específico: **Preussenquelle Bottle-Cap Date Stamps** (dataset más abajo). Tapas de aluminio curvas y reflectivas, ideal para comparar PaddleOCR, Florence-2 y Qwen3-VL.

### 4.6 Herramientas de soporte (todas gratuitas)

- **Etiquetado:** CVAT (MIT), Label Studio (Apache), X-AnyLabeling (integra SAM y Grounding DINO para auto-etiquetar).
- **Curaduría:** FiftyOne (Apache), para encontrar duplicados, errores de etiqueta y analizar fallos.
- **Inferencia:** ONNX Runtime (CPU, CUDA, **DirectML para GPUs AMD en Windows**), OpenVINO (CPU x86, incluido Ryzen), TensorRT (NVIDIA, Jetson).
- **Pipeline:** Roboflow `supervision` (MIT) para tracking, conteo por línea y zonas.

---

## 5. Hardware y captura

| Elemento | Recomendación |
|---|---|
| Cámara | Industrial con **global shutter** (las botellas se mueven), USB3 o GigE, 1,3 a 5 MP. Para prototipo sirve una webcam, pero no para producción |
| Trigger | Sensor fotoeléctrico → disparo por hardware, con 1 imagen por botella |
| Luz | Domo o anillo difuso (tapas), retroiluminación LED (nivel, vidrio, PET), luz de ángulo bajo (relieves e interior de tapa). Luz estroboscópica si la cinta es rápida |
| Cómputo | PC con GPU NVIDIA (RTX 3060 o superior) o Jetson Orin. Sin GPU NVIDIA: OpenVINO en CPU Ryzen, o ONNX+DirectML en GPU AMD. EfficientAD y D-FINE-S entran en tiempo real |
| Rechazo | Salida digital o PLC (Modbus/S7) → expulsor neumático. Ejemplo open source: [plc-bottle-inspection-yolo](https://github.com/batatablhm/plc-bottle-inspection-yolo) (YOLO + Siemens S7) |

---

## 6. Datasets: relevamiento masivo

Fuentes barridas: Kaggle (API pública, 28 términos de búsqueda, ~300 resultados → 69 relevantes), Hugging Face (API, 13 términos, ~400 → 106 relevantes), Roboflow Universe, Mendeley Data, Zenodo, GitHub, MVTec, AWS Open Data y papers.

### 6.1 Tapas (cap / closure)

| Dataset | Fuente | Tamaño | Clases / tarea | Licencia |
|---|---|---|---|---|
| **Can-BottleCap Defect Detection** | [Roboflow](https://universe.roboflow.com/zefanyas-workspace/can-bottlecap-defect-detection) | **11.262 imgs** | Defectos de lata (crítico, mayor, menor) + defectos de tapa | Ver ficha |
| **Bottle Cap Defects** (Diss) | [Roboflow](https://universe.roboflow.com/diss-rij37/bottle-cap-defects) | 1.001 imgs (v5) | scratch, hole, stain, melted… | ✅ CC BY 4.0 |
| bottle cap defect 2 (VisionPack) | [Roboflow](https://universe.roboflow.com/visionpack/bottle-cap-defect-2-sjpjq) | — | good, defect, loose-cap | ✅ CC BY 4.0 |
| bottle-cap (VisionPack) | [Roboflow](https://universe.roboflow.com/visionpack/bottle-cap-iuzcs-szcov) | — | inspección de tapas | Ver ficha |
| Project Bottle Cap | [Roboflow](https://universe.roboflow.com/computervisionki/project-bottle-cap-6ypo9) | 150 | Deckel_Gut / Schief / Weg (ok / torcida / ausente) | Ver ficha |
| Bottle_cap_segmentation | [Roboflow](https://universe.roboflow.com/sweetlove/bottle_cap_segmentation-ahgrr) | — | Segmentación | Ver ficha |
| bottle_cap_ai | [Roboflow](https://universe.roboflow.com/gangwayyyyy/bottle_cap_ai) | 111 | Tipo/marca de tapa | Ver ficha |
| GoodCap, no cap, bootle cap detection, bottle-cap-2, bottle-caps | [Roboflow](https://universe.roboflow.com/bottle-defect/goodcap) | chicos | presencia de tapa | Ver ficha |
| **Color Cap** | [Kaggle](https://www.kaggle.com/datasets/artemsmetanin/color-cap) | 908 MB | Tapas plásticas de 10 colores sobre cinta transportadora, detección | ✅ Apache 2.0 |
| bottle-cap | [Kaggle](https://www.kaggle.com/datasets/uzairahmad1434/bottle-cap) | 17 MB (sep 2026) | Detección de tapa | ✅ Apache 2.0 |
| BOTTLE CAP DATASET | [Kaggle](https://www.kaggle.com/datasets/magapuabhijit/bottle-cap-dataset) | **15 GB** | Sin descripción | ⚠️ Desconocida |
| bottle cap classification | [Kaggle](https://www.kaggle.com/datasets/tahuuanh/bottle-cap-classification) | 1,4 GB (768 archivos) | Clasificación train/val | ⚠️ Desconocida |
| Bottles, Caps and Bottlenecks | [Kaggle](https://www.kaggle.com/datasets/aimerlover/bottles-caps-and-bottlenecks) | 697 MB | Botella, tapa, cuello | ⚠️ Desconocida |
| **Bottle-Cap Date Stamps** (Preussenquelle / HPI) | [Hugging Face](https://huggingface.co/datasets/aihpi/bottle-cap-date-stamps) | 438 imgs, 1.082 fechas | **OCR de fechas** en tapas de aluminio | ✅ CC BY 4.0 |
| ImageNet-D bottle_cap | [Hugging Face](https://huggingface.co/datasets/zcs15/ImageNet-D/tree/main/material/bottle_cap) | — | Tapas genéricas (robustez) | Ver ficha |
| Defectos interior de tapa (PLOS ONE 2024) | [paper](https://pmc.ncbi.nlm.nih.gov/articles/PMC11142609/) | 300 imgs | blending, dark spots, scratches, junta faltante o arrugada | Parcial vía figshare |
| Tianchi tapas de licor (2021) | Alibaba Tianchi, citado en [paper 2026](https://www.sciencedirect.com/science/article/abs/pii/S0952197626016027) | 2.969 imgs | Defectos de tapa | ⚠️ No verificado (requiere cuenta Tianchi) |
| Repos GitHub con datos | [yolov5_bottleCap_defect_detection](https://github.com/raychiu0202/yolov5_bottleCap_defect_detection), [BottleCapDetection](https://github.com/anilbayramgogebakan/BottleCapDetection) (good/loose/missing) | chicos | VOC/YOLO | GPL-3.0 / sin licencia |

### 6.2 Defectos de botellas (cuerpo, vidrio, PET)

| Dataset | Fuente | Tamaño | Clases / tarea | Licencia |
|---|---|---|---|---|
| **MVTec AD, categoría "bottle"** | [MVTec](https://www.mvtec.com/company/research/datasets/mvtec-ad), [HF](https://huggingface.co/datasets/Voxel51/mvtec-ad) | ~5.000 imgs en total (15 categorías) | broken_large, broken_small, contamination (boca de botella vista desde arriba) + máscaras | ⚠️ CC BY-NC-SA 4.0 |
| **Defect Spectrum** (DS-MVTec bottle) | [HF](https://huggingface.co/datasets/DefectSpectrum/Defect_Spectrum) | 10K a 100K | Re-anotación fina de MVTec + sintéticos | Ver ficha |
| **Big Cola Bottles for YOLO Quality Control** | [Kaggle](https://www.kaggle.com/datasets/youssefeldemerdashh/big-cola-bottles-dataset-for-yolo-quality-control) | 1,9 GB (may 2026) | Control de calidad de botellas de cola, YOLO | ✅ Apache 2.0 |
| **Industrial Inspection System** | [Kaggle](https://www.kaggle.com/datasets/dhiaalhemdani/industrial-inspection-system) | 223 MB (oct 2026) | QC de botellas plásticas transparentes | ✅ MIT |
| **Water Bottle Defect-Level Detection** | [Kaggle](https://www.kaggle.com/datasets/jihadakbr/water-bottle-defect-level-detection-dataset) | 334 MB (feb 2026) | Defectos de botella de agua | ✅ MIT |
| **Plastic Bottle Dataset (PBD)** | [GitHub lzy-coder/pbd](https://github.com/lzy-coder/pbd) | 500 cuerpo + 3.463 hombro | stain, concave, score, squeeze, no_burr | ⚠️ Solo académico |
| **Plastic Shampoo Bottle Surface Defects** | [Mendeley](https://data.mendeley.com/datasets/kthmmbsh8t/1) | — (nov 2025) | 5 defectos × marginal/inaceptable: adhesión de etiqueta, abolladura, raspón, residuo, etiqueta rota | ✅ CC BY 4.0 |
| Coke Bottle Defects Detection | [Roboflow](https://universe.roboflow.com/machinevisionfinalproject/coke-bottle-defects-detection-fy8mp) | 512 | Segmentación | Ver ficha |
| Bottle Defect Detection | [Roboflow](https://universe.roboflow.com/object-detections-yolo/bottle-defect-detection-xmsco) | — | label, cap, crumbled | ✅ CC BY 4.0 |
| Gin Bilog Bottle Defect (vidrio) | [Roboflow](https://universe.roboflow.com/thesis-2fdkj/gin-bilog-bottle-defect-detection) | 55 | crack, scratch, chip, ok | ✅ CC BY 4.0 |
| bottle_defects (AIDL / robo-lupdk), Bottle Defects Detection (117) | [Roboflow](https://universe.roboflow.com/aidl/bottle_defects) | chicos | good / defective | Ver ficha |
| bottle_defect1 | [Roboflow](https://universe.roboflow.com/fairoz-b/bottle_defect1) | — | Incluye cap-misalignment | ✅ CC BY 4.0 |
| Bottle defects | [Kaggle](https://www.kaggle.com/datasets/mendemukesh/bottle-defects) | 134 MB | — | ⚠️ Desconocida |
| Glass bottle mouth detection | [HF](https://huggingface.co/datasets/EthanCao/glass-bottle-mouth-detection) | — | Boca de botella de vidrio | Ver ficha |
| Can-Bottle Defect (610 imgs), Glass bottle crack | GitHub "nextcombo"/"lonlonago" | 565 a 610 | VOC/YOLO | ⚠️ Pago ("sponsor"), solo preview |

### 6.3 Nivel de llenado

| Dataset | Fuente | Tamaño | Clases | Licencia |
|---|---|---|---|---|
| **Water Bottle Image Classification** | [Kaggle](https://www.kaggle.com/datasets/chethuhn/water-bottle-dataset) | 67 MB | Clasificación por nivel de agua | ✅ CC0 |
| **Liquid Level Detection (YOLOv11)** | [Kaggle](https://www.kaggle.com/datasets/goktani/liquid-level-detection-dataset-yolov11) | 7 MB (ene 2026) | Nivel de llenado | ✅ CC BY 4.0 |
| Bottle liquid level | [Roboflow](https://universe.roboflow.com/aisut/bottle-liquid-level) | 801 | Nivel | Ver ficha |
| Bottle fill level | [Roboflow](https://universe.roboflow.com/yescheffood/bottle-fill-level-ysluw) | 290 | empty, half, 3/4, full | ✅ CC BY 4.0 |
| Bottlefilldetection | [Roboflow](https://universe.roboflow.com/decentdee/bottlefilldetection) | 267 | normal, overfilled, underfilled | Ver ficha |
| Bottle fill level (nourhen) | [Roboflow](https://universe.roboflow.com/nourhen-chaaoui/bottle-fill-level-ethhf) | 290 | similar | Ver ficha |

### 6.4 Línea de embotellado / etiquetas / empaque

| Dataset | Fuente | Tamaño | Clases | Licencia |
|---|---|---|---|---|
| **Wine packaging defects** (Caballero y Tlapa) | [Mendeley](https://data.mendeley.com/datasets/vk4hms8m6c/1) (mar 2026) | **9.651 imgs**, YOLO, split 70/20/10 | missing cap, missing bottle, wrong bottle (línea real de vino) | ⚠️ CC BY-NC 3.0 |
| Wine packaging (versión Kaggle, mismo autor) | [Kaggle](https://www.kaggle.com/datasets/diegocaballeror/wine-packaging) | 593 MB (2024) | Detección de problemas de empaque | ✅ CC BY 4.0 |
| Dataset for Bottle Label Detection | [Kaggle](https://www.kaggle.com/datasets/yashvisave/dataset-for-bottle-label-detection) | 15 MB | Botellas con o sin etiqueta (YOLOv8) | ✅ Apache 2.0 |
| A dataset of label printing defects | [Kaggle](https://www.kaggle.com/datasets/amor000/a-dataset-of-label-printing-defects) | 33 MB | Defectos de impresión de etiqueta | ✅ Apache 2.0 |
| bottle label detection | [Roboflow](https://universe.roboflow.com/detection-lebi4/bottle-label-detection) | — | imperfect, missing, perfect | ✅ CC BY 4.0 |
| Juice Box Straw Defects | [Kaggle](https://www.kaggle.com/datasets/jhamilgutierrez/juice-box-straw-defects) | 7,4 GB | Empaque con pajita defectuosa | ⚠️ CC BY-NC-SA 4.0 |
| Industrial Quality Control of Packages | [Kaggle](https://www.kaggle.com/datasets/christianvorhemus/industrial-quality-control-of-packages) | — | Paquetes ok/dañados | Ver ficha |

### 6.5 Detección y clasificación general de botellas (pre-entrenamiento y robustez)

| Dataset | Fuente | Tamaño | Licencia |
|---|---|---|---|
| Plastic Bottles in the wild | [Kaggle](https://www.kaggle.com/datasets/siddharthkumarsah/plastic-bottles-image-dataset) | 8.000 imgs anotadas YOLO | ✅ CC BY 4.0 |
| Drinking Waste Classification | [Kaggle](https://www.kaggle.com/datasets/arkadiyhacks/drinking-waste-classification) | 4.816 imgs (lata, vidrio, PET, HDPE), YOLO | ✅ CC0 |
| Bottles Synthetic Images | [Kaggle](https://www.kaggle.com/datasets/vencerlanz09/bottle-synthetic-images-dataset) | 1,3 GB | ⚠️ CC BY-SA 3.0 |
| Glass and Plastic Bottles | [Kaggle](https://www.kaggle.com/datasets/antonpivnenko/glass-and-plastic-bottles) | 318 MB, multi-dispositivo | ✅ CC0 |
| Alcohol Bottle Images (vidrio) | [Kaggle](https://www.kaggle.com/datasets/dataclusterlabs/alcohol-bottle-images-glass-bottles) | 302 MB | ✅ CC0 |
| Bottles and Cans | [Kaggle](https://www.kaggle.com/datasets/moezabid/bottles-and-cans) | 156 MB | ✅ CC0 |
| Plastic Bottle Images 70k+ | [Kaggle](https://www.kaggle.com/datasets/md8habibullah/plastic-bottle-images-70k-for-ml-training) | 8,6 GB | ⚠️ CC BY-NC-SA 4.0 |
| Matenet (13 tipos de botella, sintético) | [Kaggle](https://www.kaggle.com/datasets/sezepardus/matenet) | 50 GB | ⚠️ Desconocida |
| Bottle (YOLO) | [Kaggle](https://www.kaggle.com/datasets/samuelayman/bottle) | 152 MB | ✅ Apache 2.0 |
| Bottle Detection Latest | [Kaggle](https://www.kaggle.com/datasets/kyawhtetlinn/bottle-detection-latest) | 399 MB (ago 2026) | ✅ Apache 2.0 |
| Soda bottles (Roboflow100) | [HF Francesco/soda-bottles](https://huggingface.co/datasets/Francesco/soda-bottles), [LibreYOLO/soda-bottles](https://huggingface.co/datasets/LibreYOLO/soda-bottles) | — | ✅ CC BY 4.0 |
| WaRP – Waste Recycling Plant | [Kaggle](https://www.kaggle.com/datasets/parohod/warp-waste-recycling-plant-dataset) | 845 MB, **cinta industrial real** | ✅ CC0 |
| Water bottle detection | [Roboflow](https://universe.roboflow.com/thesis-aas9p/water-bottle-detection-dshok) | 1.876 | Ver ficha |
| TACO (Trash Annotations in Context) | [GitHub](https://github.com/pedropro/TACO) | ~1.500, COCO, incluye botellas y tapas | ✅ CC BY 4.0 |

### 6.6 Benchmarks de anomalías industriales (para elegir modelo y pre-entrenar)

| Dataset | Tamaño | ¿Botellas o tapas? | Licencia |
|---|---|---|---|
| **MVTec AD** | ~5.000, 15 categorías | Sí, categoría *bottle* | ⚠️ CC BY-NC-SA 4.0 |
| **MVTec AD 2** (2025) | >8.000 alta resolución, 8 escenarios, ~30 GB | Objetos transparentes, defectos mínimos | ⚠️ CC BY-NC-SA 4.0 (según HF) |
| MVTec LOCO AD | — | Anomalías lógicas (incluye "juice bottle") | ⚠️ CC BY-NC-SA 4.0 |
| **VisA** (Amazon) | 10.821 (1.200 anómalas), 12 objetos | No (PCB, cápsulas, etc.) | Fuentes en conflicto: CC BY 4.0 ([AWS](https://registry.opendata.aws/visa)) vs CC BY-NC-SA (Anomalib) |
| **Real-IAD** | 151.050 imgs, 30 objetos, 5 vistas | Multi-vista, útil para la idea de 360° | ⚠️ CC BY-NC-SA 4.0 ([HF](https://huggingface.co/datasets/Real-IAD/Real-IAD)) |
| DAGM 2007, NEU, Severstal, Casting | varios | No (superficies) | variadas |

> Los benchmarks NC (no comerciales) sirven para **investigar y elegir el modelo**. El modelo final de producción conviene entrenarlo con datos propios y datasets ✅.

---

## 7. Plan de implementación propuesto para Shippear

1. **Semana 1: baseline con datos públicos ✅**
   - Juntar Bottle Cap Defects (CC BY 4.0), bottle cap defect 2, Color Cap, Big Cola QC, Liquid Level, Bottle Label Detection y Wine packaging (Kaggle, CC BY 4.0).
   - Unificar clases: `cap_ok, cap_missing, cap_loose, cap_tilted, cap_defect, label_missing, label_defect, fill_low, fill_high`.
   - Entrenar RF-DETR-S o D-FINE-S. Medir mAP y falsos rechazos.
2. **Semana 2: captura propia**
   - Montar cámara, luz y trigger en la línea (o en un banco de pruebas). Capturar 500 a 2.000 botellas buenas y todos los defectos que aparezcan; si hace falta, crear defectos a propósito (tapas flojas o torcidas).
   - Pre-etiquetar con SAM 3 / Grounding DINO en X-AnyLabeling o CVAT, y corregir a mano.
3. **Semana 3: anomalía + fine-tuning**
   - Anomalib EfficientAD o PatchCore con solo imágenes buenas, por vista de cámara.
   - Fine-tuning del detector con los datos propios.
   - Regla de decisión: rechazar si el detector encuentra un defecto **o** si el score de anomalía supera el umbral (calibrado sobre un set de validación).
4. **Semana 4: integración**
   - Exportar a ONNX/OpenVINO. Servicio Python (FastAPI) que recibe frames y devuelve OK/NG + bounding boxes.
   - Señal al PLC o expulsor, y dashboard (la app Next.js de `app-tmp/`) con tasa de rechazo, galería de defectos y re-etiquetado (active learning).
5. **Métricas para producción:** tasa de falsos rechazos (botellas buenas expulsadas), tasa de escapes (defectos que pasan), latencia por botella frente a la velocidad de la cinta.

### Comandos útiles

```bash
pip install kaggle rfdetr anomalib supervision paddleocr
kaggle datasets download -d artemsmetanin/color-cap -p data/raw/color-cap --unzip
kaggle datasets download -d youssefeldemerdashh/big-cola-bottles-dataset-for-yolo-quality-control -p data/raw/big-cola --unzip
kaggle datasets download -d goktani/liquid-level-detection-dataset-yolov11 -p data/raw/liquid-level --unzip
huggingface-cli download aihpi/bottle-cap-date-stamps --repo-type dataset --local-dir data/raw/cap-dates
```

Los datasets de Roboflow Universe se descargan con una cuenta gratuita, desde "Download Dataset" en formato YOLO o COCO, o con el paquete `roboflow`.

---

## 8. Riesgos y advertencias

- **Licencias:** Ultralytics es AGPL-3.0; MVTec, Real-IAD y PBD son no comerciales o académicos; SAM 3 tiene licencia propia; muchos datasets de Kaggle tienen licencia "Unknown". Hay que llevar un registro de qué datos entrenaron cada modelo.
- **Domain gap:** los datasets públicos tienen otra luz, otras tapas y otro fondo. Esperar una caída fuerte del rendimiento hasta hacer fine-tuning con datos propios.
- **Calidad de los datasets de Roboflow Universe:** son de la comunidad, con anotaciones inconsistentes y duplicados. Revisarlos con FiftyOne antes de mezclarlos.
- **Cifras de proveedores** (99,9 %, >1.000 bpm) sin validación independiente.
- **No verificado en esta investigación:** las páginas de Roboflow Universe bloquean el acceso automatizado (403), así que sus cifras salen de los resúmenes del buscador. El dataset Tianchi requiere cuenta. Kaggle y Hugging Face sí se consultaron por API.

---

## 9. Fuentes principales

- KHS AI cap inspection: https://competence.khs.com/en/technology/ai-sees-more
- Roboflow, bottle cap inspection: https://blog.roboflow.com/bottle-cap-inspection/
- RF-DETR: https://blog.roboflow.com/rf-detr/ · https://rfdetr.roboflow.com/
- DEIM / D-FINE: https://roboflow.com/model/deim
- Licencia Ultralytics: https://www.ultralytics.com/license · https://docs.ultralytics.com/
- Anomalib: https://pypi.org/project/anomalib · https://anomalib.readthedocs.io/
- EfficientAD: https://arxiv.org/pdf/2303.14535
- AnomalyCLIP: https://github.com/zqhang/AnomalyCLIP
- SAM 3: https://github.com/facebookresearch/sam3 · https://blog.roboflow.com/what-is-sam3/
- VLMs locales: https://www.promptquorum.com/power-local-llm/ollama-vision-models-review · https://playground.roboflow.com/models/compare/florence-2-vs-qwen3-vl-8b-instruct
- MVTec AD / AD 2: https://www.mvtec.com/company/research/datasets/mvtec-ad · https://www.mvtec.com/company/research/datasets/mvtec-ad-2
- VisA: https://registry.opendata.aws/visa · Real-IAD: https://arxiv.org/pdf/2403.12580
- Interior de tapas (PLOS ONE): https://pmc.ncbi.nlm.nih.gov/articles/PMC11142609/
- Sellado de tapas (2026): https://www.sciencedirect.com/science/article/abs/pii/S0952197626016027
- Tapas PET con calibración + DNN (Sensors 2021): https://www.mdpi.com/1424-8220/21/2/501
- Mendeley wine packaging: https://data.mendeley.com/datasets/vk4hms8m6c/1 · shampoo: https://data.mendeley.com/datasets/kthmmbsh8t/1
- PBD: https://github.com/lzy-coder/pbd
- Bottle-cap date stamps: https://huggingface.co/datasets/aihpi/bottle-cap-date-stamps
- Drinking Waste (Dataset Ninja): https://datasetninja.com/drinking-waste
- PaddleOCR en fechas de vencimiento: https://www.ijraset.com/best-journal/expirysense-expiry-date-detection-and-proactive-alerts
