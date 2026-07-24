"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { HeroNav } from "@/components/hero/HeroNav";
import { SynthesisHero } from "@/components/hero/SynthesisHero";
import {
  homeExperienceReducer,
  INITIAL_HOME_EXPERIENCE,
  isTransitioning,
  type CarouselSlideIndex,
} from "./homeExperienceState";
import {
  SynthesisCarousel,
  type SynthesisCarouselHandle,
} from "./SynthesisCarousel";

const TRANSITION_MS = 560;

export function SynthesisHomeExperience() {
  const [model, dispatch] = useReducer(homeExperienceReducer, INITIAL_HOME_EXPERIENCE);
  const [menuOpen, setMenuOpen] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const carouselRef = useRef<SynthesisCarouselHandle>(null);
  const heroHeadingRef = useRef<HTMLHeadingElement>(null);
  const heroPanelRef = useRef<HTMLDivElement>(null);
  const carouselPanelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("view") === "how-it-works") {
      dispatch({ type: "OPEN_CAROUSEL", slide: 1 });
    }
  }, []);

  // The homepage is an application-like, viewport-sized experience. Preserve
  // the caller's document styles exactly so product routes regain normal scroll.
  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const previous = {
      htmlOverflow: html.style.overflow,
      htmlOverscroll: html.style.overscrollBehavior,
      bodyOverflow: body.style.overflow,
      bodyPaddingRight: body.style.paddingRight,
      bodyOverscroll: body.style.overscrollBehavior,
    };
    const scrollbarWidth = window.innerWidth - html.clientWidth;
    html.style.overflow = "hidden";
    html.style.overscrollBehavior = "none";
    body.style.overflow = "hidden";
    body.style.overscrollBehavior = "none";
    if (scrollbarWidth > 0) body.style.paddingRight = `${scrollbarWidth}px`;
    return () => {
      html.style.overflow = previous.htmlOverflow;
      html.style.overscrollBehavior = previous.htmlOverscroll;
      body.style.overflow = previous.bodyOverflow;
      body.style.paddingRight = previous.bodyPaddingRight;
      body.style.overscrollBehavior = previous.bodyOverscroll;
    };
  }, []);

  useEffect(() => {
    if (!isTransitioning(model.experience)) return;
    const timeout = window.setTimeout(
      () => dispatch({ type: "FINISH_TRANSITION" }),
      reducedMotion ? 30 : TRANSITION_MS,
    );
    return () => window.clearTimeout(timeout);
  }, [model.experience, reducedMotion]);

  useEffect(() => {
    if (model.experience === "carousel") {
      carouselRef.current?.focusActiveHeading();
    } else if (model.experience === "hero") {
      heroHeadingRef.current?.focus({ preventScroll: true });
    }
  }, [model.experience]);

  const openCarousel = useCallback(
    (slide: CarouselSlideIndex) => {
      setMenuOpen(false);
      if (model.experience === "carousel") {
        carouselRef.current?.goTo(slide);
        return;
      }
      dispatch({ type: "OPEN_CAROUSEL", slide });
    },
    [model.experience],
  );

  const returnToHero = useCallback(() => {
    setMenuOpen(false);
    const url = new URL(window.location.href);
    if (url.searchParams.get("view") === "how-it-works") {
      url.searchParams.delete("view");
      window.history.replaceState(
        window.history.state,
        "",
        `${url.pathname}${url.search}${url.hash}`,
      );
    }
    dispatch({ type: "RETURN_TO_HERO" });
  }, []);

  const heroInteractive = model.experience === "hero" && !menuOpen;
  const carouselInteractive = model.experience === "carousel" && !menuOpen;

  useEffect(() => {
    if (heroPanelRef.current) heroPanelRef.current.inert = !heroInteractive;
    if (carouselPanelRef.current) {
      carouselPanelRef.current.inert = !carouselInteractive;
    }
  }, [carouselInteractive, heroInteractive]);

  return (
    <main
      className={`home-experience home-experience--${model.experience}${
        reducedMotion ? " home-experience--reduced-motion" : ""
      }`}
      data-experience={model.experience}
    >
      <HeroNav
        mode={model.experience === "hero" ? "hero" : "carousel"}
        menuOpen={menuOpen}
        onToggleMenu={() => setMenuOpen((open) => !open)}
        onCloseMenu={() => setMenuOpen(false)}
        onLogo={model.experience === "carousel" ? returnToHero : undefined}
        onHowItWorks={() => openCarousel(1)}
      />

      <div
        ref={heroPanelRef}
        className="home-experience__panel home-experience__panel--hero"
        aria-hidden={!heroInteractive}
      >
        <SynthesisHero
          headingRef={heroHeadingRef}
          onExplore={() => openCarousel(0)}
          scrubDisabled={menuOpen || model.experience !== "hero"}
        />
      </div>

      <div
        ref={carouselPanelRef}
        className="home-experience__panel home-experience__panel--carousel"
        aria-hidden={!carouselInteractive}
      >
        <SynthesisCarousel
          ref={carouselRef}
          activeSlide={model.activeSlide}
          interactive={carouselInteractive}
          onSlideChange={(slide) => dispatch({ type: "SET_SLIDE", slide })}
          onReturnToHero={returnToHero}
        />
      </div>
    </main>
  );
}
