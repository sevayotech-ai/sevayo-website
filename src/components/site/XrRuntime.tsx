"use client";

import { useXrRuntime, useXrUi } from "@/components/three/xr";

/** Boots capability detection + global XR listeners. Renders nothing. */
export function XrRuntime() {
  useXrRuntime();
  const { reduced } = useXrUi();
  return (
    <button
      type="button"
      onClick={() => {
        const next = !reduced;
        window.localStorage.setItem("sevayo:reduced-motion", next ? "1" : "0");
        window.location.reload();
      }}
      aria-pressed={reduced}
      className="fixed bottom-5 left-5 z-30 hidden rounded-full border border-line bg-black/40 px-3 py-2 text-[11px] uppercase tracking-[0.18em] text-mute backdrop-blur transition hover:text-ink md:block"
      title="Toggle spatial motion"
    >
      {reduced ? "Motion: reduced" : "Motion: spatial"}
    </button>
  );
}
