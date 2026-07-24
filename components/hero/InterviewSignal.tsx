"use client";

import { useEffect, useRef } from "react";
import { HERO_MODULES, type ModuleKey } from "./modules";

/**
 * Decorative live-session readout shown in the hero on large screens.
 * Values drift subtly with time and mouse position; purely visual.
 */
export function InterviewSignal({ active }: { active: ModuleKey }) {
  const mod = HERO_MODULES[active];
  const valueRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const barRefs = useRef<(HTMLDivElement | null)[]>([]);
  const mouse = useRef({ x: 0.5, y: 0.5 });
  const rowsRef = useRef(mod.rows);
  rowsRef.current = mod.rows;

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (!window.matchMedia("(pointer: fine)").matches) return;

    const onMove = (e: MouseEvent) => {
      mouse.current.x = e.clientX / window.innerWidth;
      mouse.current.y = e.clientY / window.innerHeight;
    };

    let raf = 0;
    const tick = (t: number) => {
      raf = requestAnimationFrame(tick);
      if (document.hidden) return;
      rowsRef.current.forEach(([, base], i) => {
        const wave = Math.sin(t / 1500 + i * 1.9) * 1.4;
        const drift = (mouse.current.x - 0.5) * 3 + (0.5 - mouse.current.y) * 1.5;
        const v = Math.round(Math.max(0, Math.min(99, base + wave + drift)));
        const span = valueRefs.current[i];
        if (span && span.textContent !== String(v)) span.textContent = String(v);
        const bar = barRefs.current[i];
        if (bar) bar.style.width = `${v}%`;
      });
    };
    window.addEventListener("mousemove", onMove, { passive: true });
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("mousemove", onMove);
    };
  }, []);

  return (
    <div
      aria-hidden="true"
      className="hidden lg:block w-[300px] rounded-[22px] border border-white/15 bg-black/25 backdrop-blur-xl px-6 py-5 select-none"
    >
      <div className="flex items-center justify-between font-mono text-[9px] tracking-[0.16em] text-white/40 uppercase">
        <span>Session / Synthesis</span>
        <span>{mod.index}</span>
      </div>
      <div key={active} className="shero-fade">
        <div className="mt-4 flex items-center gap-2.5">
          <span className="h-[6px] w-[6px] rounded-full bg-white/90 shero-pulse" />
          <span className="text-[13px] text-white/85">{mod.status}</span>
          <span className="ml-auto font-mono text-[9px] tracking-[0.14em] text-white/35 uppercase">
            {mod.session}
          </span>
        </div>
        <div className="mt-5 flex flex-col gap-[14px]">
          {mod.rows.map(([label, base], i) => (
            <div key={label}>
              <div className="flex items-baseline justify-between">
                <span className="text-[11px] text-white/55">{label}</span>
                <span
                  ref={(el) => {
                    valueRefs.current[i] = el;
                  }}
                  className="text-[12px] tabular-nums text-white/85"
                >
                  {base}
                </span>
              </div>
              <div className="mt-[6px] h-[2px] w-full bg-white/15 overflow-hidden rounded-full">
                <div
                  ref={(el) => {
                    barRefs.current[i] = el;
                  }}
                  className="h-full bg-white/65 rounded-full transition-[width] duration-300 ease-linear"
                  style={{ width: `${base}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
