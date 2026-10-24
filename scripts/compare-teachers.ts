// Compara modelos de Claude como maestro sobre fotos etiquetadas de data/ y mide acierto y costo real.
// La clase de cada foto sale de su carpeta (data/<origen>/<modelo>/<clase>/), como en ml/.
//
// Uso:
//   npx tsx --env-file=.env.local scripts/compare-teachers.ts                 # 3 fotos por clase, tope US$0.50
//   npx tsx --env-file=.env.local scripts/compare-teachers.ts --per-class 2 --max-usd 0.3 \
//       --models claude-haiku-5-5:medium,claude-haiku-5-5:high,claude-sonnet-5-5:low
//
// Se detiene antes de que el gasto estimado pase --max-usd. Resultados en data/teacher_comparison.json.

import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { judge, DEFAULT_BANDS } from "@/lib/inspection";
import { askTeacher, PRICES, type Effort } from "@/lib/teacher";

const CLASS_EXPECTED: Record<string, { cap: string; category: string }> = {
  ok: { cap: "ok", category: "OK" },
  mal_colocada: { cap: "mal_colocada", category: "ERROR_TAPA" },
  abierta: { cap: "abierta", category: "ERROR_TAPA" },
  sin_tapa: { cap: "ausente", category: "ERROR_TAPA" },
  nivel_bajo: { cap: "ok", category: "ERROR_NIVEL" },
  nivel_alto: { cap: "ok", category: "ERROR_NIVEL" },
};
const SOURCES = ["real_test", "real", "generated"];
const MAX_EDGE = 1280; // igual que la interfaz

function arg(name: string, def: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : def;
}

const perClass = Number(arg("per-class", "3"));
const maxUsd = Number(arg("max-usd", "0.5"));
const runs = arg("models", "claude-haiku-5-5:medium,claude-sonnet-5-5:low").split(",").map((s) => {
  const [model, effort = "medium"] = s.split(":");
  return { model, effort: effort as Effort };
});

type Photo = { file: string; bottleModel: string; cls: string };

function pickPhotos(): Photo[] {
  const byClass = new Map<string, Photo[]>();
  for (const source of SOURCES) {
    for (const bottleModel of ["clasico", "stevia"]) {
      for (const cls of Object.keys(CLASS_EXPECTED)) {
        const dir = path.join("data", source, bottleModel, cls);
        if (!fs.existsSync(dir)) continue;
        for (const f of fs.readdirSync(dir)) {
          if (!/\.(jpe?g|png|webp)$/i.test(f)) continue;
          const list = byClass.get(cls) ?? [];
          list.push({ file: path.join(dir, f), bottleModel, cls });
          byClass.set(cls, list);
        }
      }
    }
  }
  // Fotos reales primero (real_test, real), después generadas.
  return [...byClass.values()].flatMap((list) => list.slice(0, perClass));
}

async function toDataUrl(file: string) {
  const { data, info } = await sharp(file).rotate()
    .resize(MAX_EDGE, MAX_EDGE, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 90 })
    .toBuffer({ resolveWithObject: true });
  return { image: `data:image/jpeg;base64,${data.toString("base64")}`, width: info.width, height: info.height };
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("Falta ANTHROPIC_API_KEY (usar --env-file=.env.local).");
  const photos = pickPhotos();
  if (!photos.length) throw new Error("No hay fotos en data/<real_test|real|generated>/<modelo>/<clase>/.");
  console.log(`${photos.length} fotos · modelos: ${runs.map((r) => `${r.model}:${r.effort}`).join(", ")} · tope US$${maxUsd}`);

  let spent = 0;
  let lastCost = 0.05; // estimación inicial conservadora por llamada
  const results: Record<string, unknown>[] = [];
  const summary = runs.map((r) => ({ ...r, n: 0, cat: 0, cap: 0, escapes: 0, nok: 0, cost: 0, ms: 0, errors: 0 }));

  // Se alternan los modelos foto por foto: si se corta por presupuesto, todos quedan medidos sobre las mismas fotos.
  outer: for (const photo of photos) {
    const { image, width, height } = await toDataUrl(photo.file);
    for (const s of summary) {
      const price = PRICES[s.model];
      const guess = s.n ? s.cost / s.n : price ? lastCost * (price.output / 20) : lastCost;
      if (spent + guess > maxUsd) {
        console.log(`Tope de presupuesto: se frena antes de pasar US$${maxUsd}.`);
        break outer;
      }
      try {
        const t = await askTeacher(image, width, height, { model: s.model, effort: s.effort });
        const bm = t.reading.bottle_model === "stevia" ? "stevia" : "clasico";
        const v = judge(t.reading, DEFAULT_BANDS[bm]);
        const exp = CLASS_EXPECTED[photo.cls];
        const cost = t.usage.costUsd ?? 0;
        spent += cost;
        lastCost = cost || lastCost;
        s.n++;
        s.cost += cost;
        s.ms += t.latencyMs;
        if (v.bottle.cap === exp.cap) s.cap++;
        if (v.bottle.category === exp.category) s.cat++;
        if (exp.category !== "OK") {
          s.nok++;
          if (v.status === "OK") s.escapes++;
        }
        results.push({
          file: photo.file, expected: photo.cls, model: s.model, effort: s.effort, cap: v.bottle.cap,
          level: v.bottle.level, category: v.bottle.category, code: v.bottle.code, levelFraction: v.levelFraction,
          costUsd: cost, tokens: t.usage, latencyMs: t.latencyMs,
        });
        console.log(`  ${s.model}:${s.effort}  ${photo.cls.padEnd(13)} → ${v.bottle.code.padEnd(24)} US$${cost.toFixed(4)}`);
      } catch (e) {
        s.errors++;
        console.log(`  ${s.model}:${s.effort}  ${photo.file}: ERROR ${(e as Error).message}`);
      }
    }
  }

  // El nivel depende de la banda calibrada: con DEFAULT_BANDS la categoría de nivel es aproximada.
  console.log("\n| modelo:esfuerzo | fotos | tapa correcta | categoría correcta | escapes (NOK→OK) | US$/foto | US$ por 100 fotos | s/foto | errores |");
  console.log("|---|---|---|---|---|---|---|---|---|");
  for (const s of summary) {
    const pct = (a: number, b: number) => (b ? `${a}/${b} (${Math.round((100 * a) / b)}%)` : "—");
    const per = s.n ? s.cost / s.n : 0;
    console.log(
      `| ${s.model}:${s.effort} | ${s.n} | ${pct(s.cap, s.n)} | ${pct(s.cat, s.n)} | ${pct(s.escapes, s.nok)} | ` +
        `${per.toFixed(4)} | ${(per * 100).toFixed(2)} | ${s.n ? (s.ms / s.n / 1000).toFixed(1) : "—"} | ${s.errors} |`,
    );
  }
  console.log(`\nGasto total estimado: US$${spent.toFixed(4)}`);
  fs.writeFileSync(path.join("data", "teacher_comparison.json"), JSON.stringify({ summary, results }, null, 1));
  console.log("Detalle: data/teacher_comparison.json");
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
