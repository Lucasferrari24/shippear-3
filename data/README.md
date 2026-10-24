# Dataset de Centinela QC

Imágenes propias: fotos reales de producción más variaciones generadas con Gemini a partir de ellas. Meta inicial: unas **100 imágenes** para entrenamiento, más un set aparte de fotos reales para evaluar.

> Las imágenes **no se suben a git** (ver `.gitignore`): son fotos de producción de la empresa. En el repo solo quedan esta guía y la estructura de carpetas.

## Estructura

```text
data/
├── real/          # Fotos reales de producción para entrenar
├── real_test/     # Fotos reales reservadas para evaluar. Nunca se usan para entrenar ni para generar variaciones
└── generated/     # Variaciones de Gemini, siempre a partir de una foto de real/
```

Dentro de cada carpeta, una subcarpeta por modelo de botella y otra por clase:

```text
real/clasico/ok/IMG_0012.jpg
generated/stevia/abierta/IMG_0031__abierta_02.jpg
```

| Modelo | Carpeta |
|---|---|
| Clásico (tapa roja) | `clasico/` |
| Stevia (tapa verde) | `stevia/` |

| Clase | Carpeta | Defecto del desafío |
|---|---|---|
| Botella correcta | `ok/` | — |
| Tapa mal colocada o apoyada | `mal_colocada/` | 01 |
| Tapa abierta (capuchón levantado) | `abierta/` | 02 |
| Sin tapa | `sin_tapa/` | 03 |
| Nivel bajo | `nivel_bajo/` | 04 |
| Nivel alto | `nivel_alto/` | 04 |

Los nombres de clase coinciden con `CapState` y `DefectCode` en [`src/lib/inspection.ts`](../src/lib/inspection.ts).

## Reglas

1. **Separar `real_test/` antes de generar nada.** Unas 8 a 10 fotos reales, con los dos modelos y la mayor cantidad de clases posible. Son la única medida honesta del modelo.
2. **Las variaciones nombran su foto de origen:** `<foto_origen>__<clase>_<n>.jpg`. Así se puede rastrear de dónde salió cada imagen generada.
3. **Repartir parejo:** cerca de 8 imágenes por cada combinación de modelo de botella y clase (2 × 6 ≈ 100).
4. **Mismo encuadre que en producción:** misma cámara, distancia, fondo y luz. Las variaciones de Gemini solo cambian el defecto, más leves cambios de luz.
5. **Revisión a mano:** descartar las imágenes generadas que no sean físicamente creíbles, como una tapa deformada o un menisco imposible.
6. **El nivel no lo aprende el detector.** Lo resuelve la regla de banda calibrada en la app. Las clases `nivel_bajo` y `nivel_alto` sirven para evaluar esa regla.
