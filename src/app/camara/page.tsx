"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { CAP_LABELS, CATEGORY_LABELS, LEVEL_LABELS, type BottleCategory } from "@/lib/bottle";
import { BottleTracker, type TrackedBottle } from "@/lib/bottleTracker";
import { drawOverlay } from "@/lib/drawOverlay";
import type { InspectionResult } from "@/lib/inspection";

type Engine = "yolo" | "claude";
type Source = "camera" | "file";

/** Lado mayor del cuadro que se envía: el YOLO trabaja a 640 px. */
const SEND_EDGE: Record<Engine, number> = { yolo: 640, claude: 1280 };

const CATEGORY_STYLE: Record<BottleCategory, string> = {
  OK: "bg-green-600/20 text-green-400 border-green-700",
  ERROR_TAPA: "bg-orange-600/20 text-orange-400 border-orange-700",
  ERROR_NIVEL: "bg-yellow-600/20 text-yellow-300 border-yellow-700",
  ERROR_COMBINADO: "bg-red-600/20 text-red-400 border-red-700",
  INDETERMINADO: "bg-slate-600/20 text-slate-300 border-slate-600",
};

const CATEGORIES = Object.keys(CATEGORY_LABELS) as BottleCategory[];

type Saved = { ok: number; errors: number };

export default function Camara() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const grabRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const runningRef = useRef(false);
  const lastRef = useRef<InspectionResult | null>(null);
  const trackerRef = useRef(new BottleTracker());

  const [source, setSource] = useState<Source>("camera");
  const [engine, setEngine] = useState<Engine>("yolo");
  const [claudeEvery, setClaudeEvery] = useState(5);
  // Guardar en la base: cada botella del modelo, sin costo. Verificar: además, Claude la revisa (con costo).
  const [persist, setPersist] = useState(true);
  const [verify, setVerify] = useState(false);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState("");
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [last, setLast] = useState<InspectionResult | null>(null);
  const [live, setLive] = useState<{ frames: number; code: string } | null>(null);
  const [stats, setStats] = useState({ fps: 0, latency: 0, frames: 0 });
  const [bottles, setBottles] = useState<TrackedBottle[]>([]);
  const [saved, setSaved] = useState<Saved>({ ok: 0, errors: 0 });
  const saveRef = useRef({ persist, verify, engine });
  saveRef.current = { persist, verify, engine };

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
    return { image: c.toDataURL("image/jpeg", 0.85), width, height };
  };

  const onBottle = useCallback((b: TrackedBottle) => {
    setBottles((xs) => [b, ...xs].slice(0, 200));
    const { persist: doPersist, verify: doVerify, engine: eng } = saveRef.current;
    const frame = b.bestFrame;
    if (!frame?.result || (!doPersist && !doVerify)) return;
    const r = frame.result;
    // La mejor foto de la botella con el estado votado entre todos sus cuadros.
    const common = {
      image: frame.image, width: frame.width, height: frame.height,
      source: "camera", state: b.state, track: { frames: b.frames, votes: b.votes },
    };
    const request = doVerify
      ? // Claude la verifica y se compara con el modelo (cuesta una llamada por botella).
        fetch("/api/feedback", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            ...common,
            local: eng === "yolo"
              ? { reading: r.reading, detections: r.detections, latencyMs: r.latencyMs, modelVersion: { name: r.model } }
              : undefined,
          }),
        })
      : // Solo la decisión del modelo, sin costo de API.
        fetch("/api/inspections", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            ...common,
            engine: eng === "yolo" ? "local" : "teacher",
            reading: r.reading, detections: r.detections, latencyMs: r.latencyMs, modelVersion: r.model,
          }),
        });
    request
      .then((res) => setSaved((s) => (res.ok ? { ...s, ok: s.ok + 1 } : { ...s, errors: s.errors + 1 })))
      .catch(() => setSaved((s) => ({ ...s, errors: s.errors + 1 })));
  }, []);

  const loop = useCallback(async (eng: Engine, everyMs: number) => {
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
        const res = await fetch(eng === "yolo" ? "/api/predict" : "/api/inspect", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(frame),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
        const r = data as InspectionResult;
        if (!runningRef.current) break;
        lastRef.current = r;
        setLast(r);
        const closed = trackerRef.current.push(r.verdict.bottle, { ...frame, confidence: r.reading.confidence, result: r });
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
  }, [onBottle]);

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
    trackerRef.current = new BottleTracker(engine === "yolo" ? { minFrames: 3, gapFrames: 4 } : { minFrames: 1, gapFrames: 1 });
    runningRef.current = true;
    setRunning(true);
    loop(engine, engine === "yolo" ? 0 : claudeEvery * 1000);
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

  useEffect(() => () => {
    runningRef.current = false;
    stopMedia();
  }, []);

  const counts = bottles.reduce<Partial<Record<BottleCategory, number>>>(
    (acc, b) => ({ ...acc, [b.state.category]: (acc[b.state.category] ?? 0) + 1 }),
    {},
  );
  const total = bottles.length;
  const errors = total - (counts.OK ?? 0);
  const state = last?.verdict.bottle;

  return (
    <main className="mx-auto max-w-7xl px-4 py-6">
      <header className="mb-4 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Centinela QC · Cámara en vivo</h1>
          <p className="text-sm text-slate-400">Cada cuadro se analiza y cada botella que pasa se cuenta una sola vez.</p>
        </div>
        <Link href="/" className="text-sm text-sky-400 hover:underline">
          ← Inspección por foto
        </Link>
      </header>

      <section className="mb-4 flex flex-wrap items-end gap-4 rounded-xl border border-slate-800 p-4 text-sm">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-slate-500">Fuente</span>
          <select value={source} disabled={running} onChange={(e) => setSource(e.target.value as Source)} className="rounded bg-slate-900 px-2 py-1">
            <option value="camera">Cámara</option>
            <option value="file">Video de prueba</option>
          </select>
        </label>
        {source === "camera" ? (
          <label className="flex flex-col gap-1">
            <span className="text-xs text-slate-500">Cámara</span>
            <select value={deviceId} disabled={running} onChange={(e) => setDeviceId(e.target.value)} className="max-w-56 rounded bg-slate-900 px-2 py-1">
              <option value="">Trasera / predeterminada</option>
              {devices.map((d, i) => (
                <option key={d.deviceId || i} value={d.deviceId}>
                  {d.label || `Cámara ${i + 1}`}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <label className="flex flex-col gap-1">
            <span className="text-xs text-slate-500">Archivo</span>
            <input
              type="file"
              accept="video/*"
              disabled={running}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) setFileUrl(URL.createObjectURL(f));
              }}
              className="text-xs"
            />
          </label>
        )}
        <label className="flex flex-col gap-1">
          <span className="text-xs text-slate-500">Modelo</span>
          <select value={engine} disabled={running} onChange={(e) => setEngine(e.target.value as Engine)} className="rounded bg-slate-900 px-2 py-1">
            <option value="yolo">YOLO local (tiempo real)</option>
            <option value="claude">Claude (1 cuadro cada N s, con costo)</option>
          </select>
        </label>
        {engine === "claude" && (
          <label className="flex flex-col gap-1">
            <span className="text-xs text-slate-500">Cada (s)</span>
            <input
              type="number"
              min={2}
              value={claudeEvery}
              disabled={running}
              onChange={(e) => setClaudeEvery(Math.max(2, Number(e.target.value)))}
              className="w-16 rounded bg-slate-900 px-2 py-1"
            />
          </label>
        )}
        <div className="flex flex-col gap-1">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={persist} onChange={(e) => setPersist(e.target.checked)} className="accent-sky-500" />
            <span>Guardar cada botella en la base (sin costo)</span>
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={verify} onChange={(e) => setVerify(e.target.checked)} className="accent-sky-500" />
            <span>Verificar cada botella con Claude (con costo)</span>
          </label>
        </div>
        <div className="ml-auto flex gap-2">
          {!running ? (
            <button onClick={start} className="rounded-lg bg-sky-700 px-4 py-2 font-medium hover:bg-sky-600">
              Iniciar
            </button>
          ) : (
            <button onClick={stop} className="rounded-lg bg-slate-700 px-4 py-2 font-medium hover:bg-slate-600">
              Detener
            </button>
          )}
          <button
            onClick={() => {
              setBottles([]);
              setSaved({ ok: 0, errors: 0 });
            }}
            className="rounded-lg bg-slate-800 px-3 py-2 hover:bg-slate-700"
          >
            Reiniciar conteo
          </button>
        </div>
      </section>

      {error && <p className="mb-4 rounded-lg border border-red-900 px-4 py-2 text-sm text-red-400">{error}</p>}

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <section className="rounded-xl border border-slate-800 p-3">
          <div className="relative overflow-hidden rounded-lg bg-black">
            <video ref={videoRef} playsInline muted className="block h-auto w-full" />
            <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full" />
          </div>
          <div className="mt-2 flex flex-wrap gap-4 font-mono text-xs text-slate-500">
            <span>{stats.fps.toFixed(1)} cuadros/s</span>
            <span>{Math.round(stats.latency)} ms por cuadro</span>
            <span>{stats.frames} cuadros analizados</span>
            {last && <span>modelo {last.model}</span>}
          </div>
        </section>

        <aside className="space-y-4 text-sm">
          <div className={`rounded-xl border p-4 ${state ? CATEGORY_STYLE[state.category] : "border-slate-800 text-slate-500"}`}>
            <div className="text-xs uppercase tracking-wide opacity-70">Ahora</div>
            {state && state.detected ? (
              <>
                <div className="text-2xl font-bold">{CATEGORY_LABELS[state.category]}</div>
                <div className="font-mono">{state.code}</div>
                <div className="mt-2 text-slate-300">
                  Tapa: {CAP_LABELS[state.cap]} · Nivel: {LEVEL_LABELS[state.level]}
                  {state.levelFraction != null && ` (${(state.levelFraction * 100).toFixed(1)}%)`}
                </div>
                {live && <div className="mt-1 text-xs opacity-70">Botella en curso: {live.frames} cuadros · voto {live.code}</div>}
              </>
            ) : (
              <div className="text-lg">{running ? "Sin botella en cuadro" : "Detenido"}</div>
            )}
          </div>

          <div className="rounded-xl border border-slate-800 p-4">
            <div className="mb-2 flex items-baseline justify-between">
              <h3 className="font-semibold">Botellas contadas</h3>
              <span className="font-mono text-lg">{total}</span>
            </div>
            {CATEGORIES.map((c) => (
              <div key={c} className="flex justify-between">
                <span>{CATEGORY_LABELS[c]}</span>
                <span className="font-mono">{counts[c] ?? 0}</span>
              </div>
            ))}
            <div className="mt-2 flex justify-between border-t border-slate-800 pt-2 font-semibold">
              <span>Pérdida (no OK)</span>
              <span className="font-mono">{total ? `${errors} · ${((100 * errors) / total).toFixed(1)}%` : "—"}</span>
            </div>
            {(persist || verify) && (
              <p className="mt-2 text-xs text-slate-500">
                Guardadas en la base: {saved.ok}
                {saved.errors ? ` · errores: ${saved.errors}` : ""}
              </p>
            )}
          </div>

          <div className="rounded-xl border border-slate-800 p-4">
            <h3 className="mb-2 font-semibold">Últimas botellas</h3>
            {bottles.length === 0 ? (
              <p className="text-slate-500">Todavía no pasó ninguna.</p>
            ) : (
              <ul className="max-h-72 space-y-1 overflow-auto font-mono text-xs">
                {bottles.slice(0, 50).map((b) => (
                  <li key={b.id} className="flex justify-between gap-2">
                    <span className={CATEGORY_STYLE[b.state.category].split(" ")[1]}>
                      #{b.id} {b.state.code}
                    </span>
                    <span className="text-slate-500">
                      {b.frames} cuadros · {new Date(b.endedAt).toLocaleTimeString()}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>
      </div>
    </main>
  );
}
