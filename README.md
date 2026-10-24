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

1. **La IA mide.** Un modelo de visión (Claude) recibe la foto y devuelve una medición estructurada: el modelo de botella, cajas de envase, pico y tapa en píxeles, el estado de la tapa, la separación tapa-pico, la altura del menisco y la evidencia en texto. La salida se fuerza con *tool use*, así que siempre llega un JSON válido.
2. **Las reglas deciden.** Un motor determinístico ([`src/lib/inspection.ts`](src/lib/inspection.ts)) convierte el nivel en una fracción de la altura del envase y lo compara contra la banda de cada modelo. El veredicto es auditable y reproducible.
3. **Calibración en un click.** Marcás una botella buena como referencia y la banda queda fijada en ±4%. Los veredictos de todo el lote se recalculan en el cliente sin volver a llamar a la IA.
4. **Trazabilidad.** Cada foto queda con sus cotas superpuestas y la evidencia. Podés procesar lotes de muchas fotos en paralelo y exportar todo a CSV.

El líquido es incoloro y el envase transparente, así que un umbral de píxeles clásico es frágil frente a reflejos e iluminación. El modelo de visión ubica el menisco por refracción y contexto. Las tolerancias, en cambio, quedan del lado de las reglas, donde el equipo de calidad las controla.

## Stack

- Next.js 15 (App Router) + React 19 + Tailwind 4
- Anthropic SDK: Claude con visión y *tool use* forzado, en [`src/app/api/inspect/route.ts`](src/app/api/inspect/route.ts)
- Overlay en Canvas, en [`src/components/Overlay.tsx`](src/components/Overlay.tsx)
- Deploy en Vercel

## Correr localmente

```bash
npm install
cp .env.example .env.local   # completar ANTHROPIC_API_KEY
npm run dev
```

Abrí http://localhost:3000 y arrastrá fotos.

## Fuera de alcance (según el desafío)

La integración con la línea de producción (PLC, cámara en línea, expulsor) no entra en este hackathon. Los siguientes pasos serían:

- una segunda pasada de IA con un recorte ampliado de la tapa;
- un modelo liviano destilado de las mediciones para correr en el borde (sin red);
- un tablero de tendencias por turno.

## Equipo

_(nombres)_
