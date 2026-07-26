"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";
import { CarouselControls } from "./CarouselControls";
import {
  clampSlide,
  shouldUnlockCarouselTransition,
  type CarouselSlideIndex,
} from "./homeExperienceState";
import { useCarouselGestures } from "./useCarouselGestures";
import { ReadinessOverviewSlide } from "./slides/ReadinessOverviewSlide";
import { HowItWorksSlide } from "./slides/HowItWorksSlide";
import { ModulesOverviewSlide } from "./slides/ModulesOverviewSlide";

export interface SynthesisCarouselHandle {
  goTo: (slide: CarouselSlideIndex) => void;
  focusActiveHeading: () => void;
}

export const SynthesisCarousel = forwardRef<
  SynthesisCarouselHandle,
  {
    activeSlide: CarouselSlideIndex;
    interactive: boolean;
    locked: boolean;
    onSlideChange: (slide: CarouselSlideIndex) => void;
    onSlideTransitionEnd: () => void;
    onReturnToHero: () => void;
  }
>(function SynthesisCarousel(
  {
    activeSlide,
    interactive,
    locked,
    onSlideChange,
    onSlideTransitionEnd,
    onReturnToHero,
  },
  ref,
) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const slideRefs = useRef<(HTMLElement | null)[]>([]);

  const requestSlide = useCallback(
    (requested: CarouselSlideIndex) => {
      if (!interactive || locked) return;
      const next = clampSlide(requested);
      if (next === activeSlide) return;
      onSlideChange(next);
    },
    [activeSlide, interactive, locked, onSlideChange],
  );

  const focusActiveHeading = useCallback(() => {
    const heading = slideRefs.current[activeSlide]?.querySelector<HTMLElement>("[data-slide-heading]");
    heading?.focus({ preventScroll: true });
  }, [activeSlide]);

  useImperativeHandle(ref, () => ({ goTo: requestSlide, focusActiveHeading }), [
    focusActiveHeading,
    requestSlide,
  ]);

  useEffect(() => {
    slideRefs.current.forEach((slide, index) => {
      if (slide) slide.inert = index !== activeSlide || !interactive;
    });
  }, [activeSlide, interactive]);

  useEffect(() => {
    if (interactive && !locked) focusActiveHeading();
  }, [activeSlide, focusActiveHeading, interactive, locked]);

  useEffect(() => {
    if (!interactive) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (locked) return;
      const target = event.target as HTMLElement | null;
      if (
        target?.matches("input,textarea,select,[contenteditable='true']") ||
        target?.isContentEditable
      ) {
        return;
      }
      let next: CarouselSlideIndex | null = null;
      if (event.key === "ArrowLeft") next = clampSlide(activeSlide - 1);
      else if (event.key === "ArrowRight") next = clampSlide(activeSlide + 1);
      else if (event.key === "Home") next = 0;
      else if (event.key === "End") next = 2;
      if (next == null || next === activeSlide) return;
      event.preventDefault();
      requestSlide(next);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeSlide, interactive, locked, requestSlide]);

  const gestureHandlers = useCarouselGestures({
    viewportRef,
    trackRef,
    activeSlide,
    interactive,
    locked,
    requestSlide,
    returnToHero: onReturnToHero,
  });

  return (
    <section
      className="home-carousel"
      aria-roledescription="carousel"
      aria-label="Synthesis overview"
    >
      <div
        ref={viewportRef}
        className="home-carousel__viewport"
        {...gestureHandlers}
      >
        <div
          ref={trackRef}
          className="home-carousel__track"
          style={
            {
              "--home-drag-x": "0px",
            } as React.CSSProperties
          }
        >
          {[ReadinessOverviewSlide, HowItWorksSlide, ModulesOverviewSlide].map(
            (Slide, index) => (
              <section
                key={index}
                ref={(node) => {
                  slideRefs.current[index] = node;
                }}
                className={`home-carousel__slide ${
                  index === activeSlide
                    ? "is-active"
                    : index < activeSlide
                      ? "is-before"
                      : "is-after"
                }`}
                onTransitionEnd={(event) => {
                  if (shouldUnlockCarouselTransition(
                    index as CarouselSlideIndex,
                    activeSlide,
                    event.propertyName,
                    event.target === event.currentTarget,
                  )) {
                    onSlideTransitionEnd();
                  }
                }}
                aria-label={`Slide ${index + 1} of 3`}
                aria-hidden={index !== activeSlide}
              >
                <div className="home-carousel__slide-scroll">
                  <Slide />
                </div>
              </section>
            ),
          )}
        </div>
      </div>
      <CarouselControls
        activeSlide={activeSlide}
        locked={locked || !interactive}
        onGoTo={requestSlide}
      />
      {activeSlide === 0 && (
        <button
          type="button"
          className="home-carousel__back"
          onClick={onReturnToHero}
          aria-label="Back to landing"
        >
          <span aria-hidden="true" className="home-carousel__back-cue">
            <span className="home-carousel__back-arrows">
              <i />
              <i />
              <i />
            </span>
            <span className="home-carousel__back-line" />
          </span>
          <span className="home-carousel__back-label">Back to landing</span>
        </button>
      )}
      <p className="home-carousel__gesture-hint" aria-hidden="true">
        Swipe sideways · scroll up on Slide 1 to return
      </p>
    </section>
  );
});
