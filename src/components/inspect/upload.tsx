"use client";

import { useRef, useState } from "react";
import { Camera, ImagePlus } from "lucide-react";
import { cn } from "cn";
import { useStore } from "@/lib/store";

export function Upload({ compact }: { compact?: boolean }) {
  const { addFiles } = useStore();
  const fileRef = useRef<HTMLInputElement>(null);
  const camRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  const onFiles = (f: FileList | null) => {
    if (f?.length) void addFiles(f);
  };

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        onFiles(e.dataTransfer.files);
      }}
      className={cn(
        "flex flex-col items-stretch gap-3 rounded-3xl border border-dashed p-3 transition-colors sm:flex-row sm:items-center",
        over ? "border-level bg-level/10" : "border-border bg-card/60",
        compact && "p-2",
      )}
    >
      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        className="sr-only"
        onChange={(e) => {
          onFiles(e.target.files);
          e.target.value = "";
        }}
        aria-label="Elegir fotos del lote"
      />
      <input
        ref={camRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        onChange={(e) => {
          onFiles(e.target.files);
          e.target.value = "";
        }}
        aria-label="Sacar foto con la cámara"
      />
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => camRef.current?.click()}
          className="flex h-12 flex-1 items-center justify-center gap-2 rounded-full bg-foreground px-5 text-[15px] font-semibold text-background transition-transform active:scale-[0.98] sm:flex-none"
        >
          <Camera className="size-5" aria-hidden />
          Sacar foto
        </button>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="flex h-12 flex-1 items-center justify-center gap-2 rounded-full bg-elevated px-5 text-[15px] font-medium text-foreground transition-transform active:scale-[0.98] sm:flex-none"
        >
          <ImagePlus className="size-5" aria-hidden />
          Subir lote
        </button>
      </div>
      <p className="hidden px-2 text-sm text-muted-foreground sm:block">
        o arrastrá fotos acá · jpeg, png o webp · se analizan de a 2
      </p>
    </div>
  );
}
