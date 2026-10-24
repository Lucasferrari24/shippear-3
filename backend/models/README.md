# Modelo entrenado

El backend carga de esta carpeta el detector ya entrenado en Colab ([`ml/colab_train.ipynb`](../../ml/colab_train.ipynb)):

- `centinela.onnx`: el detector YOLO exportado con NMS dentro del grafo (salida `[1, N, 6]`).
- `centinela.json`: clases, tamaño de entrada, umbral y bandas de llenado calibradas.

Para actualizarlo, descomprimir acá el `centinela_model.zip` que descarga el cuaderno y hacer commit y push; Render lo toma en el próximo deploy. `best.pt` no se versiona.

Sin estos archivos, la API sigue andando con el maestro (Claude) y `POST /api/predict` responde 503. Otra opción es no versionarlos y configurar `MODEL_URL` y `MODEL_META_URL` en Render: el servidor los descarga al arrancar.
