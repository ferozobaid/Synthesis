"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent, PointerEvent, WheelEvent } from "react";

export interface ModuleCarouselItem {
  glyph: string;
  color: string;
  tint: string;
  title: string;
  blurb: string;
  variant?: "inverse" | "signal";
}

const SWIPE_THRESHOLD = 44;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function cardClass(item: ModuleCarouselItem) {
  return `landing-module-card${item.variant ? ` landing-module-card--${item.variant}` : ""}`;
}

function cardContent(item: ModuleCarouselItem, index: number, compact = false) {
  const titleColor = item.variant === "inverse" ? "var(--inverse-ink)" : item.variant === "signal" ? "var(--signal-contrast)" : "var(--ink)";
  const bodyColor = item.variant === "inverse"
    ? "var(--inverse-ink)"
    : item.variant === "signal"
      ? "var(--signal-contrast)"
      : "var(--ink-2)";

  return (
    <>
      <span className="landing-module-card__number">0{index + 1}</span>
      <span
        className="landing-module-card__icon"
        style={{
          width: compact ? 42 : 42,
          height: compact ? 42 : 42,
          borderRadius: 7,
          background: item.variant === "inverse" ? "rgba(255,255,255,.12)" : item.variant === "signal" ? "rgba(17,16,14,.12)" : item.tint,
          color: item.variant === "inverse" ? "var(--inverse-ink)" : item.variant === "signal" ? "var(--signal-contrast)" : item.color,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 18,
          marginBottom: compact ? 54 : 14,
        }}
        aria-hidden="true"
      >
        {item.glyph}
      </span>
      <span className={compact ? "module-carousel__title" : "landing-module-card__title"} style={{ color: titleColor }}>
        {item.title}
      </span>
      <span className={compact ? "module-carousel__blurb" : "landing-module-card__blurb"} style={{ color: bodyColor }}>
        {item.blurb}
      </span>
    </>
  );
}

export function ModuleCarousel({ items }: { items: ModuleCarouselItem[] }) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [dragOffset, setDragOffset] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [stepSize, setStepSize] = useState(312);
  const pointerStart = useRef<number | null>(null);
  const pointerId = useRef<number | null>(null);
  const dragged = useRef(false);
  const wheelRemainder = useRef(0);

  const goTo = useCallback((index: number) => {
    setActiveIndex((index + items.length) % items.length);
    setDragOffset(0);
  }, [items.length]);

  useEffect(() => {
    const measureStep = () => {
      const track = document.querySelector<HTMLElement>(".module-carousel__track");
      const card = track?.firstElementChild as HTMLElement | null;
      if (!track || !card) return;
      // Keep both neighbouring previews tucked into the same stable mobile
      // viewport while the active card remains perfectly centered.
      setStepSize(Math.max(200, card.offsetWidth * 0.74));
    };

    measureStep();
    window.addEventListener("resize", measureStep);
    return () => window.removeEventListener("resize", measureStep);
  }, []);

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    pointerStart.current = event.clientX;
    pointerId.current = event.pointerId;
    dragged.current = false;
    setIsDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    if (pointerStart.current === null || pointerId.current !== event.pointerId) return;
    const offset = event.clientX - pointerStart.current;
    if (Math.abs(offset) > 6) dragged.current = true;
    setDragOffset(offset);
  }

  function finishPointer(event: PointerEvent<HTMLDivElement>) {
    if (pointerStart.current === null || pointerId.current !== event.pointerId) return;
    const offset = event.clientX - pointerStart.current;
    pointerStart.current = null;
    pointerId.current = null;
    setIsDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);

    if (Math.abs(offset) >= SWIPE_THRESHOLD) goTo(activeIndex + (offset < 0 ? 1 : -1));
    else setDragOffset(0);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowRight") { event.preventDefault(); goTo(activeIndex + 1); }
    else if (event.key === "ArrowLeft") { event.preventDefault(); goTo(activeIndex - 1); }
    else if (event.key === "Home") { event.preventDefault(); goTo(0); }
    else if (event.key === "End") { event.preventDefault(); goTo(items.length - 1); }
  }

  function handleWheel(event: WheelEvent<HTMLDivElement>) {
    // Trackpads emit horizontal wheel deltas rather than pointer events. Keep
    // vertical page scrolling native, but turn a deliberate horizontal gesture
    // into the same circular step as a swipe.
    if (Math.abs(event.deltaX) <= Math.abs(event.deltaY) || Math.abs(event.deltaX) < 1) return;
    event.preventDefault();
    wheelRemainder.current += event.deltaX;
    if (Math.abs(wheelRemainder.current) < SWIPE_THRESHOLD) return;
    const direction = wheelRemainder.current > 0 ? 1 : -1;
    wheelRemainder.current = 0;
    goTo(activeIndex + direction);
  }

  const focusIndex = activeIndex - dragOffset / stepSize;

  return (
    <div className="module-carousel">
      <div className="module-carousel__desktop" aria-label="Interview modules">
        {items.map((item, index) => <article key={item.title} className={cardClass(item)}>{cardContent(item, index)}</article>)}
      </div>

      <div
        className={`module-carousel__mobile${isDragging ? " module-carousel__mobile--dragging" : ""}`}
        role="region"
        aria-roledescription="carousel"
        aria-label="Explore the three interview modules"
        tabIndex={0}
        onKeyDown={handleKeyDown}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishPointer}
        onPointerCancel={finishPointer}
        onWheel={handleWheel}
      >
        <div className="module-carousel__track">
          {items.map((item, index) => {
            const rawDistance = index - focusIndex;
            const distance = ((rawDistance + items.length / 2) % items.length + items.length) % items.length - items.length / 2;
            const absoluteDistance = Math.abs(distance);
            const scale = clamp(1 - absoluteDistance * 0.1, 0.86, 1);
            const opacity = clamp(1 - absoluteDistance * 0.3, 0.48, 1);
            const offsetY = Math.min(14, absoluteDistance * 10);
            const rotation = clamp(distance * 1.2, -2, 2);
            const cardStyle = {
              opacity,
              transform: `translate3d(calc(-50% + ${distance * stepSize}px), ${offsetY}px, 0) scale(${scale}) rotate(${rotation}deg)`,
              boxShadow: absoluteDistance < 0.05 ? "0 22px 48px rgba(0,0,0,.16), 0 2px 0 rgba(255,255,255,.04)" : "0 12px 24px rgba(0,0,0,.1)",
              zIndex: Math.round(100 - absoluteDistance * 10),
              cursor: dragged.current ? "grabbing" : absoluteDistance < 0.05 ? "grab" : "pointer",
            } as CSSProperties;

            return (
              <button
                key={item.title}
                type="button"
                className={`${cardClass(item)} module-carousel__card${index === activeIndex ? " is-active" : ""}`}
                aria-label={`${item.title} module${index === activeIndex ? ", selected" : ""}`}
                aria-pressed={index === activeIndex}
                onClick={() => { if (!dragged.current) goTo(index); dragged.current = false; }}
                style={cardStyle}
              >
                {cardContent(item, index, true)}
              </button>
            );
          })}
        </div>
      </div>

      <div className="module-carousel__controls">
        <div className="module-carousel__progress" aria-live="polite">
          <span>{String(activeIndex + 1).padStart(2, "0")}</span>
          <span className="module-carousel__progress-rule" aria-hidden="true" />
          <span>{String(items.length).padStart(2, "0")}</span>
        </div>
        <div className="module-carousel__dots" aria-hidden="true">
          {items.map((item, index) => <span key={item.title} className={index === activeIndex ? "is-active" : ""} />)}
        </div>
      </div>
    </div>
  );
}
