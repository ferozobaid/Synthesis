"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { HeroNav } from "@/components/hero/HeroNav";
import { SynthesisHero } from "@/components/hero/SynthesisHero";
import {
  homeExperienceReducer,
  INITIAL_HOME_EXPERIENCE,
  isHowItWorksLocation,
  isTransitioning,
  removeHowItWorksLocation,
  type CarouselSlideIndex,
} from "./homeExperienceState";
import {
  SynthesisCarousel,
  type SynthesisCarouselHandle,
} from "./SynthesisCarousel";
import { useHomeExperienceGestures } from "./useHomeExperienceGestures";

const TRANSITION_MS = 560;
const SLIDE_TRANSITION_MS = 460;

export function SynthesisHomeExperience() {
  const [model, dispatch] = useReducer(homeExperienceReducer, INITIAL_HOME_EXPERIENCE);
  const [menuOpen, setMenuOpen] = useState(false);
  const carouselRef = useRef<SynthesisCarouselHandle>(null);
  const heroHeadingRef = useRef<HTMLHeadingElement>(null);
  const experienceRef = useRef<HTMLElement>(null);
  const heroPanelRef = useRef<HTMLDivElement>(null);
  const carouselPanelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () =>
      dispatch({
        type: "SET_REDUCED_MOTION",
        reducedMotion: query.matches,
      });
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (isHowItWorksLocation(window.location.search, window.location.hash)) {
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
      () => dispatch({ type: "FINISH_EXPERIENCE_TRANSITION" }),
      model.reducedMotion ? 30 : TRANSITION_MS,
    );
    return () => window.clearTimeout(timeout);
  }, [model.experience, model.reducedMotion]);

  useEffect(() => {
    if (model.transitionLock !== "slide") return;
    const timeout = window.setTimeout(
      () => dispatch({ type: "FINISH_SLIDE_TRANSITION" }),
      model.reducedMotion ? 30 : SLIDE_TRANSITION_MS + 80,
    );
    return () => window.clearTimeout(timeout);
  }, [model.reducedMotion, model.transitionLock]);

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

  const requestSlide = useCallback((slide: CarouselSlideIndex) => {
    dispatch({ type: "SET_SLIDE", slide });
  }, []);

  const returnToHero = useCallback(() => {
    setMenuOpen(false);
    const nextLocation = removeHowItWorksLocation(
      window.location.pathname,
      window.location.search,
      window.location.hash,
    );
    const currentLocation =
      window.location.pathname + window.location.search + window.location.hash;
    if (nextLocation !== currentLocation) {
      window.history.replaceState(
        window.history.state,
        "",
        nextLocation,
      );
    }
    dispatch({ type: "RETURN_TO_HERO" });
  }, []);

  useHomeExperienceGestures({
    rootRef: experienceRef,
    experience: model.experience,
    activeSlide: model.activeSlide,
    transitionLocked: model.transitionLock !== null,
    reducedMotion: model.reducedMotion,
    openCarousel: () => openCarousel(0),
    requestSlide,
    returnToHero,
  });

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
      ref={experienceRef}
      className={`home-experience home-experience--${model.experience}${
        model.reducedMotion ? " home-experience--reduced-motion" : ""
      }`}
      data-experience={model.experience}
    >
      <HeroNav
        mode={model.experience === "hero" ? "hero" : "carousel"}
        menuOpen={menuOpen}
        onToggleMenu={() => setMenuOpen((open) => !open)}
        onCloseMenu={() => setMenuOpen(false)}
        onLogo={model.experience === "hero" ? undefined : returnToHero}
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
          locked={model.transitionLock === "slide"}
          onSlideChange={requestSlide}
          onSlideTransitionEnd={() =>
            dispatch({ type: "FINISH_SLIDE_TRANSITION" })
          }
          onReturnToHero={returnToHero}
        />
      </div>
    </main>
  );
}
