import { useEffect, useRef } from "react";
import { HERO_MODULES, type ModuleKey } from "./modules";

/**
 * Claude's original translucent live-session readout. It follows the active
 * module and lets the demo values drift subtly without touching product data.
 */
export function InterviewSignal({ active }: { active: ModuleKey }) {
  const module = HERO_MODULES[active];
  const valueRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const barRefs = useRef<(HTMLDivElement | null)[]>([]);
  const pointer = useRef({ x: 0.5, y: 0.5 });
  const rowsRef = useRef(module.rows);
  rowsRef.current = module.rows;

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (!window.matchMedia("(pointer: fine)").matches) return;

    const onMove = (event: MouseEvent) => {
      pointer.current.x = event.clientX / window.innerWidth;
      pointer.current.y = event.clientY / window.innerHeight;
    };

    let frame = 0;
    const tick = (time: number) => {
      frame = window.requestAnimationFrame(tick);
      if (document.hidden) return;

      rowsRef.current.forEach(([, baseline], index) => {
        const wave = Math.sin(time / 1500 + index * 1.9) * 1.4;
        const drift =
          (pointer.current.x - 0.5) * 3 +
          (0.5 - pointer.current.y) * 1.5;
        const value = Math.round(
          Math.max(0, Math.min(99, baseline + wave + drift)),
        );
        const valueNode = valueRefs.current[index];
        const barNode = barRefs.current[index];
        if (valueNode && valueNode.textContent !== String(value)) {
          valueNode.textContent = String(value);
        }
        if (barNode) barNode.style.width = `${value}%`;
      });
    };

    window.addEventListener("mousemove", onMove, { passive: true });
    frame = window.requestAnimationFrame(tick);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("mousemove", onMove);
    };
  }, []);

  return (
    <div
      aria-hidden="true"
      className="hero-signal-live w-[300px] rounded-[22px] border border-white/25 bg-black/40 backdrop-blur-xl px-6 py-5 select-none"
    >
      <div className="flex items-center justify-between font-mono text-[9px] tracking-[0.16em] text-white/60 uppercase">
        <span>Session / Synthesis</span>
        <span>{module.index}</span>
      </div>

      <div key={active} className="shero-fade">
        <div className="mt-4 flex items-center gap-2.5">
          <span className="h-[6px] w-[6px] rounded-full bg-white/90 shero-pulse" />
          <span className="text-[13px] text-white/95">{module.status}</span>
          <span className="ml-auto font-mono text-[9px] tracking-[0.14em] text-white/55 uppercase">
            {module.session}
          </span>
        </div>

        <div className="mt-5 flex flex-col gap-[14px]">
          {module.rows.map(([label, baseline], index) => (
            <div key={label}>
              <div className="flex items-baseline justify-between">
                <span className="text-[11px] text-white/70">{label}</span>
                <span
                  ref={(node) => {
                    valueRefs.current[index] = node;
                  }}
                  className="text-[12px] tabular-nums text-white/95"
                >
                  {baseline}
                </span>
              </div>
              <div className="mt-[6px] h-[2px] w-full overflow-hidden rounded-full bg-white/20">
                <div
                  ref={(node) => {
                    barRefs.current[index] = node;
                  }}
                  className="h-full rounded-full bg-white/80 transition-[width] duration-300 ease-linear"
                  style={{ width: `${baseline}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
