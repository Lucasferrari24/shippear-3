# Visión computacional para control de calidad de botellas y tapas

Investigación técnica: enfoques y modelos gratuitos que corren en local.
Fecha: 24/10/2026. Repo: [Lucasferrari24/shippear-3](https://github.com/Lucasferrari24/shippear-3).

> **Cómo leer las licencias.** Todo lo marcado ✅ permite uso comercial. ⚠️ es no comercial, solo académico o desconocido.

---

## 1. Resumen y recomendación

1. **Los datos son propios.** Ningún dataset público cubre tapas a presión con capuchón ni el nivel de líquido incoloro; ver la sección 6. Se entrena con fotos de producción y variaciones generadas a partir de ellas, con la misma cámara y la misma iluminación.
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
- Benchmark específico: **Preussenquelle Bottle-Cap Date Stamps** ([Hugging Face](https://huggingface.co/datasets/aihpi/bottle-cap-date-stamps)). Tapas de aluminio curvas y reflectivas, ideal para comparar PaddleOCR, Florence-2 y Qwen3-VL.

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

## 6. Decisión sobre datos (24/10/2026)

Se descartaron los datasets públicos. Se revisaron los candidatos más cercanos (Big Cola QC, Industrial Inspection System, Liquid Level, Water Bottle, bottle-cap y Wine packaging) y ninguno representa el caso:

- **Tapas a rosca, no a presión.** Ninguno tiene el capuchón flip-top abierto (defecto 02).
- **Nivel de llenado con líquidos de color** o con clases gruesas (vacía / mitad / llena), no una banda de tolerancia sobre líquido incoloro.
- **Otro envase, otra luz, otro encuadre.** Wine packaging son cajas vistas desde arriba; bottle-cap son botellas de gaseosa en una casa.
- Incluso Industrial Inspection System, el más parecido (PET transparente, detector + reglas), informa solo **62 % de acierto en nivel** en su propia línea.

**El dataset del proyecto son imágenes propias:** fotos reales de producción (Clásico y Stevia) más variaciones generadas con Gemini a partir de esas fotos, unas 100 en total. La estructura y las reglas están en [`data/README.md`](../data/README.md).

Para crecer después, la app suma un **modo de recolección**: guarda cada foto con la predicción del modelo local y la de un modelo maestro (Claude por API, opcional y desactivado por defecto), y manda los desacuerdos y los casos de baja confianza a revisión humana antes de usarlos para reentrenar.

---

## 7. Riesgos y advertencias

- **Licencias:** Ultralytics es AGPL-3.0 y SAM 3 tiene licencia propia. Hay que llevar un registro de qué datos y qué pesos entrenaron cada modelo.
- **Imágenes generadas:** las variaciones de Gemini pueden verse creíbles sin ser físicamente correctas (separación de la tapa, altura del menisco). Se revisan a mano y **la evaluación se hace solo con fotos reales** que nunca se usaron para entrenar.
- **Etiquetas del modelo maestro:** Claude preetiqueta, pero no es la verdad. Los desacuerdos y los NOK pasan por revisión humana antes de entrar al dataset.
- **Privacidad:** el modo de recolección envía fotos de producción a una API externa. Está desactivado por defecto y requiere autorización de la empresa.
- **Cifras de proveedores** (99,9 %, >1.000 bpm) sin validación independiente.

---

## 8. Fuentes principales

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
- Industrial Inspection System (62 % en nivel de llenado): https://www.kaggle.com/datasets/dhiaalhemdani/industrial-inspection-system
- PaddleOCR en fechas de vencimiento: https://www.ijraset.com/best-journal/expirysense-expiry-date-detection-and-proactive-alerts
