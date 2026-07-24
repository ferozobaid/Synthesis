"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { HeroNav } from "./HeroNav";
import { ProductPills } from "./ProductPills";
import { InterviewSignal } from "./InterviewSignal";
import { useTypewriter } from "./useTypewriter";
import { useVideoScrub } from "./useVideoScrub";
import { HERO_MODULES, HERO_MODULE_ORDER, type ModuleKey } from "./modules";

const VIDEO_SRC =
  "https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260530_042513_df96a13b-6155-4f6e-8b93-c9dee66fba08.mp4";

const TAGLINE =
  "One preparation environment for resume fit, behavioural interviews, and live case practice.";

/** Rotate the spotlighted module every few seconds unless the user is hovering one. */
const ROTATE_MS = 5000;

/**
 * Cinematic full-screen opening section rendered above the existing
 * Synthesis landing page. Self-contained: always dark, scoped styles,
 * and it fades into `var(--paper)` so both themes hand off cleanly.
 */
export function SynthesisHero() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const heroRef = useRef<HTMLElement>(null);

  const [menuOpen, setMenuOpen] = useState(false);
  const [solidNav, setSolidNav] = useState(false);
  const [pastHero, setPastHero] = useState(false);
  const [rotating, setRotating] = useState<ModuleKey>("fit");
  const [spotlight, setSpotlight] = useState<ModuleKey | null>(null);

  const active = spotlight ?? rotating;
  const { displayed, done } = useTypewriter(TAGLINE);

  useVideoScrub(videoRef, menuOpen);

  // Nav backdrop + hand-off to the existing landing header below the hero.
  useEffect(() => {
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const y = window.scrollY;
        const heroBottom = heroRef.current?.offsetHeight ?? window.innerHeight;
        setSolidNav(y > 24);
        setPastHero(y > heroBottom - 90);
      });
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll);
    };
  }, []);

  // Auto-rotate the module spotlight while nothing is hovered.
  useEffect(() => {
    if (spotlight) return;
    const id = window.setInterval(() => {
      setRotating((prev) => {
        const next = (HERO_MODULE_ORDER.indexOf(prev) + 1) % HERO_MODULE_ORDER.length;
        return HERO_MODULE_ORDER[next];
      });
    }, ROTATE_MS);
    return () => window.clearInterval(id);
  }, [spotlight]);

  // Lock page scroll while the mobile menu covers the hero.
  useEffect(() => {
    if (!menuOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [menuOpen]);

  const scrollToPlatform = useCallback(() => {
    document.getElementById("synthesis-platform")?.scrollIntoView({ behavior: "smooth" });
  }, []);

  return (
    <section
      ref={heroRef}
      aria-label="Synthesis introduction"
      className="shero relative min-h-screen overflow-hidden bg-black text-white flex items-end md:items-center"
    >
      <HeroNav
        solid={solidNav}
        hidden={pastHero}
        menuOpen={menuOpen}
        onToggleMenu={() => setMenuOpen((v) => !v)}
        onCloseMenu={() => setMenuOpen(false)}
      />

      {/* Backdrop: scrubbing video + cinematic overlays. */}
      <video
        ref={videoRef}
        muted
        playsInline
        preload="auto"
        aria-hidden="true"
        className="absolute inset-0 h-full w-full object-cover z-0"
        style={{ objectPosition: "70% center" }}
      >
        <source src={VIDEO_SRC} type="video/mp4" />
      </video>
      <div
        aria-hidden="true"
        className="absolute inset-0 z-[1]"
        style={{
          background:
            "linear-gradient(90deg, rgba(0,0,0,.88) 0%, rgba(0,0,0,.64) 42%, rgba(0,0,0,.16) 75%, rgba(0,0,0,.32) 100%)",
        }}
      />
      {/* Extra darkening on small screens where text sits over the video subject. */}
      <div aria-hidden="true" className="absolute inset-0 z-[1] bg-black/35 md:bg-transparent" />
      <div aria-hidden="true" className="absolute inset-0 z-[2] shero-bottom-fade" />

      {/* Content */}
      <div className="relative z-20 w-full px-5 sm:px-8 lg:px-10 pt-28 pb-28 sm:pb-32 md:py-28">
        <div className="mx-auto w-full max-w-[1200px] flex items-end md:items-center justify-between gap-12">
          <div className="w-full max-w-[780px]">
            <div className="shero-rise flex items-center gap-2.5 mb-5" style={{ animationDelay: "150ms" }}>
              <span className="h-[5px] w-[5px] rounded-full bg-white shero-pulse" />
              <span className="font-mono text-[11px] sm:text-[12px] tracking-[0.18em] uppercase text-white/60">
                AI-powered interview preparation
              </span>
            </div>

            <h1
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

            <p className="mt-7 sm:mt-9 max-w-[620px] text-[18px] sm:text-[21px] lg:text-[23px] leading-[1.4] font-normal text-white/80 min-h-[62px]">
              {displayed}
              {!done && (
                <span aria-hidden="true" className="inline-block w-[2px] h-[1.05em] bg-white align-middle ml-[3px] shero-blink" />
              )}
            </p>

            <div className="shero-rise" style={{ animationDelay: "450ms" }}>
              <ProductPills onSpotlight={setSpotlight} />

              {/* Module brief: follows the hovered / rotating module. */}
              <p
                key={active}
                className="shero-fade mt-5 max-w-[560px] text-[13px] sm:text-[14px] leading-[1.55] text-white/55 min-h-[44px]"
              >
                {HERO_MODULES[active].brief}
              </p>

              <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px] sm:text-[11px] uppercase tracking-[0.16em]">
                {HERO_MODULE_ORDER.map((key, i) => (
                  <span key={key} className="flex items-center gap-3">
                    {i > 0 && <span aria-hidden="true" className="text-white/25">/</span>}
                    <span className={`transition-colors duration-500 ${key === active ? "text-white/85" : "text-white/40"}`}>
                      {HERO_MODULES[key].session}
                    </span>
                  </span>
                ))}
              </div>
            </div>
          </div>

          <div className="shero-rise hidden lg:block flex-none self-end mb-24" style={{ animationDelay: "700ms" }}>
            <InterviewSignal active={active} />
          </div>
        </div>
      </div>

      {/* Scroll indicator */}
      <button
        type="button"
        onClick={scrollToPlatform}
        className="absolute z-20 bottom-6 sm:bottom-8 right-5 sm:right-8 lg:right-10 flex flex-col items-center gap-3 font-mono text-[10px] uppercase tracking-[0.18em] text-white/45 hover:text-white/80 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white/80"
      >
        Explore Synthesis
        <span aria-hidden="true" className="block h-10 w-px overflow-hidden">
          <span className="block h-full w-full bg-white/50 shero-scroll-line" />
        </span>
      </button>
    </section>
  );
}
