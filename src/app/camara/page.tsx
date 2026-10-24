"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Video } from "lucide-react";
import { cn } from "cn";
import { PageHeader } from "@/components/shell/app-shell";
import * as api from "@/lib/api";
import { BottleTracker, type TrackedBottle } from "@/lib/bottleTracker";
import { drawOverlay } from "@/lib/drawOverlay";
import { CAP_LABELS, CATEGORY_COLOR, CATEGORY_LABELS, LEVEL_LABELS } from "@/lib/labels";
import { useStore } from "@/lib/store";
import type { BottleCategory } from "@/lib/types";

type Source = "camera" | "file";

/** Lado mayor del cuadro que se envía: el YOLO trabaja a 640 px. */
const SEND_EDGE: Record<api.Engine, number> = { local: 640, teacher: 1280 };

const CATEGORIES = Object.keys(CATEGORY_LABELS) as BottleCategory[];

type Saved = { ok: number; errors: number };

const field = "h-10 rounded-2xl border border-input bg-surface px-3 text-sm text-foreground disabled:opacity-50";
const card = "rounded-3xl border border-border bg-card p-4";

export default function Camara() {
  const { engine: defaultEngine, health } = useStore();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const grabRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const runningRef = useRef(false);
  const lastRef = useRef<api.EngineResult | null>(null);
  const trackerRef = useRef(new BottleTracker());

  const [source, setSource] = useState<Source>("camera");
  const [engine, setEngine] = useState<api.Engine>(defaultEngine);
  const [claudeEvery, setClaudeEvery] = useState(5);
  // Guardar en la base: cada botella del modelo, sin costo. Verificar: además, Claude la revisa (con costo).
  const [persist, setPersist] = useState(true);
  const [verify, setVerify] = useState(false);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState("");
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [last, setLast] = useState<api.EngineResult | null>(null);
  const [live, setLive] = useState<{ frames: number; code: string } | null>(null);
  const [stats, setStats] = useState({ fps: 0, latency: 0, frames: 0 });
  const [bottles, setBottles] = useState<TrackedBottle[]>([]);
  const [saved, setSaved] = useState<Saved>({ ok: 0, errors: 0 });
  const saveRef = useRef({ persist, verify, engine });
  saveRef.current = { persist, verify, engine };

  // El modelo por defecto llega cuando el backend responde /health.
  useEffect(() => {
    if (!runningRef.current) setEngine(defaultEngine);
  }, [defaultEngine]);

  // Cámaras disponibles (los nombres aparecen recién después de dar permiso).
  const listDevices = useCallback(async () => {
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      setDevices(all.filter((d) => d.kind === "videoinput"));
    } catch {}
  }, []);
  useEffect(() => {
    listDevices();
  }, [listDevices]);

  // Dibuja las últimas cotas en un canvas transparente sobre el video, en cada refresco de pantalla.
  // El video tiene que verse: Chrome pausa los videos silenciados que no están visibles.
  useEffect(() => {
    let raf = 0;
    const draw = () => {
      const v = videoRef.current;
      const c = canvasRef.current;
      if (v && c && v.videoWidth) {
        if (c.width !== v.videoWidth || c.height !== v.videoHeight) {
          c.width = v.videoWidth;
          c.height = v.videoHeight;
        }
        const ctx = c.getContext("2d")!;
        ctx.clearRect(0, 0, c.width, c.height);
        const r = lastRef.current;
        if (r) {
          const k = c.width / r.width;
          ctx.save();
          ctx.scale(k, k);
          drawOverlay(ctx, r.reading, r.verdict, r.width, r.height);
          ctx.restore();
        }
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  /** Toma el cuadro actual del video, achicado, como JPEG. */
  const grab = (edge: number) => {
    const v = videoRef.current!;
    const k = Math.min(1, edge / Math.max(v.videoWidth, v.videoHeight));
    const width = Math.round(v.videoWidth * k);
    const height = Math.round(v.videoHeight * k);
    const c = (grabRef.current ??= document.createElement("canvas"));
    c.width = width;
    c.height = height;
    c.getContext("2d")!.drawImage(v, 0, 0, width, height);
    return { data: c.toDataURL("image/jpeg", 0.85), width, height };
  };

  const onBottle = useCallback((b: TrackedBottle) => {
    setBottles((xs) => [b, ...xs].slice(0, 200));
    const { persist: doPersist, verify: doVerify } = saveRef.current;
    const frame = b.bestFrame;
    if (!frame?.result || (!doPersist && !doVerify)) return;
    const r = frame.result as api.EngineResult;
    const item = { data: frame.image, width: frame.width, height: frame.height };
    // La mejor foto de la botella con el estado votado entre todos sus cuadros.
    const request = doVerify
      ? // Claude la verifica y se compara con el modelo (cuesta una llamada por botella).
        api.sendFeedback(item, r, r.verdict.band, { source: "camera", state: b.state, track: { frames: b.frames, votes: b.votes } })
      : // Solo la decisión del modelo, sin costo de API.
        api.saveInspection({
          image: frame.image,
          width: frame.width,
          height: frame.height,
          source: "camera",
          state: b.state,
          track: { frames: b.frames, votes: b.votes },
          engine: r.engine,
          reading: r.reading,
          detections: r.detections,
          latencyMs: r.latencyMs,
          modelVersion: r.model,
        });
    request
      .then(() => setSaved((s) => ({ ...s, ok: s.ok + 1 })))
      .catch(() => setSaved((s) => ({ ...s, errors: s.errors + 1 })));
  }, []);

  const loop = useCallback(
    async (eng: api.Engine, everyMs: number) => {
      let frames = 0;
      const t0 = performance.now();
      while (runningRef.current) {
        const v = videoRef.current;
        if (!v || !v.videoWidth || v.paused || v.ended) {
          await new Promise((r) => setTimeout(r, 100));
          continue;
        }
        const started = performance.now();
        const frame = grab(SEND_EDGE[eng]);
        try {
          // La banda la decide el backend (la calibrada del modelo o la de cada botella).
          const r = await api.inspect(frame, null, eng);
          if (!runningRef.current) break;
          lastRef.current = r;
          setLast(r);
          const closed = trackerRef.current.push(r.verdict.bottle, {
            image: frame.data,
            width: frame.width,
            height: frame.height,
            confidence: r.reading.confidence,
            result: r,
          });
          setLive(trackerRef.current.live);
          if (closed) onBottle(closed);
          frames++;
          const elapsed = (performance.now() - t0) / 1000;
          setStats({ fps: frames / elapsed, latency: performance.now() - started, frames });
        } catch (e) {
          setError((e as Error).message);
          runningRef.current = false;
          setRunning(false);
          break;
        }
        const wait = everyMs - (performance.now() - started);
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      }
    },
    [onBottle],
  );

  const stopMedia = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  };

  const start = async () => {
    setError(null);
    const v = videoRef.current!;
    try {
      if (source === "camera") {
        stopMedia();
        const stream = await navigator.mediaDevices.getUserMedia({
          video: deviceId ? { deviceId: { exact: deviceId } } : { facingMode: "environment", width: { ideal: 1280 } },
          audio: false,
        });
        streamRef.current = stream;
        v.srcObject = stream;
        listDevices();
      } else {
        if (!fileUrl) throw new Error("Elegí un video primero.");
        v.srcObject = null;
        v.src = fileUrl;
        v.loop = true;
      }
      await v.play();
    } catch (e) {
      setError(
        source === "camera"
          ? `No se pudo abrir la cámara: ${(e as Error).message}. Desde otro dispositivo hace falta HTTPS.`
          : (e as Error).message,
      );
      return;
    }
    // En modo Claude cada botella se ve en pocos cuadros: se cierra con 1 cuadro y 1 cuadro sin botella.
    trackerRef.current = new BottleTracker(engine === "local" ? { minFrames: 3, gapFrames: 4 } : { minFrames: 1, gapFrames: 1 });
    runningRef.current = true;
    setRunning(true);
    loop(engine, engine === "local" ? 0 : claudeEvery * 1000);
  };

  const stop = () => {
    runningRef.current = false;
    setRunning(false);
    const closed = trackerRef.current.flush();
    if (closed) onBottle(closed);
    setLive(null);
    videoRef.current?.pause();
    stopMedia();
  };

  useEffect(
    () => () => {
      runningRef.current = false;
      stopMedia();
    },
    [],
  );

  const counts = bottles.reduce<Partial<Record<BottleCategory, number>>>(
    (acc, b) => ({ ...acc, [b.state.category]: (acc[b.state.category] ?? 0) + 1 }),
    {},
  );
  const total = bottles.length;
  const errors = total - (counts.OK ?? 0);
  const state = last?.verdict.bottle;

  return (
    <>
      <PageHeader
        title="Cámara en vivo"
        subtitle="Cada cuadro se analiza y cada botella que pasa se cuenta una sola vez."
        color="var(--foreground)"
        icon={Video}
      />

      <section className={cn(card, "mb-4 flex flex-wrap items-end gap-4 text-sm")} aria-label="Configuración">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs text-muted-foreground">Fuente</span>
          <select value={source} disabled={running} onChange={(e) => setSource(e.target.value as Source)} className={field}>
            <option value="camera">Cámara</option>
            <option value="file">Video de prueba</option>
          </select>
        </label>
        {source === "camera" ? (
          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-muted-foreground">Cámara</span>
            <select value={deviceId} disabled={running} onChange={(e) => setDeviceId(e.target.value)} className={cn(field, "max-w-56")}>
              <option value="">Trasera / predeterminada</option>
              {devices.map((d, i) => (
                <option key={d.deviceId || i} value={d.deviceId}>
                  {d.label || `Cámara ${i + 1}`}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-muted-foreground">Archivo</span>
            <input
              type="file"
              accept="video/*"
              disabled={running}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) setFileUrl(URL.createObjectURL(f));
              }}
              className="text-xs text-muted-foreground"
            />
          </label>
        )}
        <label className="flex flex-col gap-1.5">
          <span className="text-xs text-muted-foreground">Modelo</span>
          <select value={engine} disabled={running} onChange={(e) => setEngine(e.target.value as api.Engine)} className={field}>
            <option value="local" disabled={!health?.local.available}>
              YOLO local (tiempo real)
            </option>
            <option value="teacher">Claude (1 cuadro cada N s, con costo)</option>
          </select>
        </label>
        {engine === "teacher" && (
          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-muted-foreground">Cada (s)</span>
            <input
              type="number"
              min={2}
              value={claudeEvery}
              disabled={running}
              onChange={(e) => setClaudeEvery(Math.max(2, Number(e.target.value)))}
              className={cn(field, "w-20")}
            />
          </label>
        )}
        <div className="flex flex-col gap-1.5">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={persist} onChange={(e) => setPersist(e.target.checked)} className="accent-[var(--dataset)]" />
            <span>Guardar cada botella en la base (sin costo)</span>
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={verify} onChange={(e) => setVerify(e.target.checked)} className="accent-[var(--dataset)]" />
            <span>Verificar cada botella con Claude (con costo)</span>
          </label>
        </div>
        <div className="ml-auto flex gap-2">
          {!running ? (
            <button
              type="button"
              onClick={start}
              className="h-10 rounded-full bg-foreground px-5 text-sm font-semibold text-background"
            >
              Iniciar
            </button>
          ) : (
            <button type="button" onClick={stop} className="h-10 rounded-full bg-elevated px-5 text-sm font-semibold text-foreground">
              Detener
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setBottles([]);
              setSaved({ ok: 0, errors: 0 });
            }}
            className="h-10 rounded-full px-4 text-sm text-muted-foreground hover:bg-elevated hover:text-foreground"
          >
            Reiniciar conteo
          </button>
        </div>
      </section>

      {error && (
        <p className="mb-4 rounded-3xl border border-border bg-card px-4 py-3 text-sm" style={{ color: "var(--nok)" }}>
          {error}
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <section className={cn(card, "p-3")} aria-label="Video">
          <div className="relative overflow-hidden rounded-2xl bg-black">
            <video ref={videoRef} playsInline muted className="block h-auto w-full" />
            <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full" />
          </div>
          <div className="mt-2 flex flex-wrap gap-4 font-mono text-xs tabular-nums text-muted-foreground">
            <span>{stats.fps.toFixed(1)} cuadros/s</span>
            <span>{Math.round(stats.latency)} ms por cuadro</span>
            <span>{stats.frames} cuadros analizados</span>
            {last && <span>modelo {last.model}</span>}
          </div>
        </section>

        <aside className="flex flex-col gap-4 text-sm">
          <div
            className={card}
            style={state ? { borderColor: `color-mix(in srgb, ${CATEGORY_COLOR[state.category]} 45%, transparent)` } : undefined}
          >
            <div className="text-xs text-muted-foreground">Ahora</div>
            {state && state.detected ? (
              <>
                <div className="text-2xl font-semibold tracking-tight" style={{ color: CATEGORY_COLOR[state.category] }}>
                  {CATEGORY_LABELS[state.category]}
                </div>
                <div className="font-mono text-foreground">{state.code}</div>
                <div className="mt-2 text-muted-foreground">
                  Tapa: {CAP_LABELS[state.cap]} · Nivel: {LEVEL_LABELS[state.level]}
                  {state.levelFraction != null && ` (${(state.levelFraction * 100).toFixed(1)}%)`}
                </div>
                {live && (
                  <div className="mt-1 text-xs text-muted-foreground">
                    Botella en curso: {live.frames} cuadros · voto {live.code}
                  </div>
                )}
              </>
            ) : (
              <div className="text-lg text-foreground">{running ? "Sin botella en cuadro" : "Detenido"}</div>
            )}
          </div>

          <div className={card}>
            <div className="mb-2 flex items-baseline justify-between">
              <h2 className="font-semibold text-foreground">Botellas contadas</h2>
              <span className="font-mono text-lg tabular-nums text-foreground">{total}</span>
            </div>
            {CATEGORIES.map((c) => (
              <div key={c} className="flex justify-between">
                <span style={{ color: CATEGORY_COLOR[c] }}>{CATEGORY_LABELS[c]}</span>
                <span className="font-mono tabular-nums text-foreground">{counts[c] ?? 0}</span>
              </div>
            ))}
            <div className="mt-2 flex justify-between border-t border-border pt-2 font-semibold text-foreground">
              <span>Pérdida (no OK)</span>
              <span className="font-mono tabular-nums">{total ? `${errors} · ${((100 * errors) / total).toFixed(1)}%` : "—"}</span>
            </div>
            {(persist || verify) && (
              <p className="mt-2 text-xs text-muted-foreground">
                Guardadas en la base: {saved.ok}
                {saved.errors ? ` · errores: ${saved.errors}` : ""}
              </p>
            )}
          </div>

          <div className={card}>
            <h2 className="mb-2 font-semibold text-foreground">Últimas botellas</h2>
            {bottles.length === 0 ? (
              <p className="text-muted-foreground">Todavía no pasó ninguna.</p>
            ) : (
              <ul className="flex max-h-72 flex-col gap-1 overflow-auto font-mono text-xs">
                {bottles.slice(0, 50).map((b) => (
                  <li key={b.id} className="flex justify-between gap-2">
                    <span style={{ color: CATEGORY_COLOR[b.state.category] }}>
                      #{b.id} {b.state.code}
                    </span>
                    <span className="text-muted-foreground">
                      {b.frames} cuadros · {new Date(b.endedAt).toLocaleTimeString()}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>
      </div>
    </>
  );
}
