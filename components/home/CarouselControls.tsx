import type { CarouselSlideIndex } from "./homeExperienceState";

const SLIDE_NAMES = ["Readiness overview", "How Synthesis works", "Modules"] as const;

export function CarouselControls({
  activeSlide,
  locked,
  onGoTo,
}: {
  activeSlide: CarouselSlideIndex;
  locked: boolean;
  onGoTo: (slide: CarouselSlideIndex) => void;
}) {
  return (
    <div className="home-carousel-controls">
      <button
        type="button"
        className="home-carousel-controls__arrow"
        onClick={() => onGoTo((activeSlide - 1) as CarouselSlideIndex)}
        disabled={locked || activeSlide === 0}
        aria-label="Previous slide"
      >
        ←
      </button>
      <div className="home-carousel-controls__position" aria-hidden="true">
        {String(activeSlide + 1).padStart(2, "0")} / 03
      </div>
      <div className="home-carousel-controls__indicators" aria-label="Choose a slide">
        {SLIDE_NAMES.map((name, index) => (
          <button
            key={name}
            type="button"
            className={index === activeSlide ? "is-active" : ""}
            onClick={() => onGoTo(index as CarouselSlideIndex)}
            disabled={locked}
            aria-label={`Go to slide ${index + 1}: ${name}`}
            aria-current={index === activeSlide ? "true" : undefined}
          />
        ))}
      </div>
      <button
        type="button"
        className="home-carousel-controls__arrow"
        onClick={() => onGoTo((activeSlide + 1) as CarouselSlideIndex)}
        disabled={locked || activeSlide === 2}
        aria-label="Next slide"
      >
        →
      </button>
      <span className="sr-only" aria-live="polite">
        Slide {activeSlide + 1} of 3: {SLIDE_NAMES[activeSlide]}
      </span>
    </div>
  );
}
