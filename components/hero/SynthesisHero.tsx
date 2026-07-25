"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { ProductPills } from "./ProductPills";
import { InterviewSignal } from "./InterviewSignal";
import { useTypewriter } from "./useTypewriter";
import { useVideoScrub } from "./useVideoScrub";
import { HERO_MODULE_ORDER, type ModuleKey } from "./modules";
import { SYNTHESIS_VIDEO_SRC } from "./media";

const TAGLINE =
  "One preparation environment for resume fit, behavioural interviews, and live case practice.";
const ROTATE_MS = 5000;

export function SynthesisHero({
  headingRef,
  onExplore,
  scrubDisabled,
}: {
  headingRef: RefObject<HTMLHeadingElement>;
  onExplore: () => void;
  scrubDisabled: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [rotating, setRotating] = useState<ModuleKey>("fit");
  const [spotlight, setSpotlight] = useState<ModuleKey | null>(null);
  const activeModule = spotlight ?? rotating;
  const { displayed, done } = useTypewriter(TAGLINE);

  useVideoScrub(videoRef, scrubDisabled);

  useEffect(() => {
    if (spotlight || scrubDisabled) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const rotate = () => {
      if (document.hidden) return;
      setRotating((current) => {
        const next =
          (HERO_MODULE_ORDER.indexOf(current) + 1) %
          HERO_MODULE_ORDER.length;
        return HERO_MODULE_ORDER[next];
      });
    };
    const interval = window.setInterval(rotate, ROTATE_MS);
    return () => window.clearInterval(interval);
  }, [scrubDisabled, spotlight]);

  return (
    <section
      aria-label="Synthesis introduction"
      className="shero relative min-h-screen overflow-hidden bg-black text-white flex items-end md:items-center"
    >
      <video
        ref={videoRef}
        muted
        playsInline
        preload="auto"
        aria-hidden="true"
        tabIndex={-1}
        className="shero-video absolute inset-0 h-full w-full object-cover z-0"
      >
        <source src={SYNTHESIS_VIDEO_SRC} type="video/mp4" />
      </video>
      <div aria-hidden="true" className="shero-wash absolute inset-0 z-[1]" />
      <div aria-hidden="true" className="shero-mobile-shade absolute inset-0 z-[1] bg-black/35 md:bg-transparent" />
      <div aria-hidden="true" className="absolute inset-0 z-[2] shero-bottom-fade" />

      <div className="shero-content relative z-20 w-full px-5 sm:px-8 lg:px-10 pt-28 pb-28 sm:pb-32 md:py-28">
        <div className="shero-composition mx-auto w-full max-w-[1200px] flex items-end md:items-center justify-between gap-12">
          <div className="shero-copy w-full max-w-[780px]">
            <div className="shero-rise flex items-center gap-2.5 mb-5" style={{ animationDelay: "150ms" }}>
              <span className="h-[5px] w-[5px] rounded-full bg-white shero-pulse" />
              <span className="font-mono text-[11px] sm:text-[12px] tracking-[0.18em] uppercase text-white/60">
                Interview preparation / Synthesis
              </span>
            </div>

            <h1
              ref={headingRef}
              tabIndex={-1}
              className="text-white font-medium"
              style={{
                fontFamily: "var(--font-sans)",
                fontSize: "clamp(46px, 7.2vw, 106px)",
                lineHeight: 0.92,
                letterSpacing: "-0.055em",
                fontWeight: 640,
              }}
            >
              <span className="block shero-line">Prepare for the interview.</span>
              <span className="block shero-line text-white/70" style={{ animationDelay: "100ms" }}>
                Become ready for the room.
              </span>
            </h1>

            <p className="sr-only">{TAGLINE}</p>
            <p
              aria-hidden="true"
              className="shero-typewriter mt-7 sm:mt-9 max-w-[620px] text-[18px] sm:text-[21px] lg:text-[23px] leading-[1.4] font-normal text-white/80 min-h-[62px]"
            >
              {displayed}
              {!done && (
                <span className="inline-block w-[2px] h-[1.05em] bg-white align-middle ml-[3px] shero-blink" />
              )}
            </p>

            <div className="shero-rise" style={{ animationDelay: "450ms" }}>
              <ProductPills onSpotlight={setSpotlight} />
            </div>
          </div>

          <div className="shero-signal shero-rise hidden lg:block flex-none self-end mb-24" style={{ animationDelay: "700ms" }}>
            <InterviewSignal active={activeModule} />
          </div>
        </div>
      </div>

      <button
        type="button"
        onClick={onExplore}
        aria-label="Explore Synthesis"
        className="shero-explore absolute z-20 bottom-6 sm:bottom-8 right-5 sm:right-8 lg:right-10 flex flex-col items-center gap-3 font-mono text-[10px] uppercase tracking-[0.18em] text-white/55 hover:text-white transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white/80"
      >
        <span className="shero-explore__label">Explore Synthesis</span>
        <span aria-hidden="true" className="shero-explore__line block h-10 w-px overflow-hidden">
          <span className="block h-full w-full bg-white/60 shero-scroll-line" />
        </span>
      </button>
    </section>
  );
}
