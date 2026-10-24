import { CAP_LABELS, CATEGORY_COLOR, LEVEL_LABELS } from "@/lib/labels";
import type { CapState, LevelStatus, StateMatrixCell } from "@/lib/types";

const CAPS: CapState[] = ["ok", "mal_colocada", "abierta", "ausente"];
const LEVELS: LevelStatus[] = ["ok", "bajo", "alto", "no_medido"];

export function StateMatrix({ cells }: { cells: StateMatrixCell[] }) {
  const max = Math.max(1, ...cells.filter((c) => c.category !== "OK").map((c) => c.count));
  const get = (cap: CapState, level: LevelStatus) => cells.find((c) => c.cap === cap && c.level === level);

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[520px] border-separate border-spacing-1.5">
        <caption className="sr-only">Mapa de calor tapa por nivel</caption>
        <thead>
          <tr>
            <th scope="col" className="w-32 text-left text-xs font-normal text-muted-foreground">
              tapa \ nivel
            </th>
            {LEVELS.map((l) => (
              <th key={l} scope="col" className="text-left text-xs font-medium text-level">
                {LEVEL_LABELS[l]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {CAPS.map((cap) => (
            <tr key={cap}>
              <th scope="row" className="pr-2 text-left text-xs font-medium text-cap">
                {cap === "ok" ? "correcta" : CAP_LABELS[cap].split(" (")[0]}
              </th>
              {LEVELS.map((level) => {
                const c = get(cap, level);
                if (!c) return <td key={level} />;
                const color = CATEGORY_COLOR[c.category];
                const intensity = c.category === "OK" ? 0.32 : 0.08 + 0.42 * (c.count / max);
                return (
                  <td
                    key={level}
                    className="rounded-2xl p-3 align-top"
                    style={{
                      backgroundColor: `color-mix(in srgb, ${color} ${Math.round(intensity * 100)}%, var(--surface))`,
                    }}
                  >
                    <div className="font-mono text-lg font-semibold tabular-nums text-foreground">
                      {c.count.toLocaleString("es-AR")}
                    </div>
                    <div className="truncate font-mono text-[11px] text-foreground/70">{c.code}</div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
