"use client";

import { useEffect, useRef } from "react";
import type { PointerEvent as ReactPointerEvent, RefObject } from "react";
import {
  clampSlide,
  dragThreshold,
  hasHorizontalWheelIntent,
  type CarouselSlideIndex,
} from "./homeExperienceState";

interface CarouselGestureOptions {
  viewportRef: RefObject<HTMLDivElement>;
  trackRef: RefObject<HTMLDivElement>;
  activeSlide: CarouselSlideIndex;
  interactive: boolean;
  locked: boolean;
  requestSlide: (slide: CarouselSlideIndex) => void;
}

export function useCarouselGestures({
  viewportRef,
  trackRef,
  activeSlide,
  interactive,
  locked,
  requestSlide,
}: CarouselGestureOptions) {
  const pointer = useRef<{
    id: number;
    startX: number;
    startY: number;
    horizontal: boolean;
  } | null>(null);
  const suppressClickUntil = useRef(0);
  const wheelTotal = useRef(0);
  const wheelQuietTimer = useRef<number | null>(null);

  const setDragOffset = (offset: number) => {
    trackRef.current?.style.setProperty("--home-drag-x", `${offset}px`);
  };

  const resetPointer = (node?: HTMLDivElement, pointerId?: number) => {
    if (node && pointerId != null && node.hasPointerCapture(pointerId)) {
      node.releasePointerCapture(pointerId);
    }
    pointer.current = null;
    setDragOffset(0);
    viewportRef.current?.removeAttribute("data-dragging");
  };

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (!interactive || locked) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    // Interactive controls always keep native click/tap behavior. Carousel
    // dragging starts from the slide surface around them.
    if (
      (event.target as HTMLElement).closest(
        "a,button,input,textarea,select,[contenteditable='true']",
      )
    ) {
      return;
    }
    pointer.current = {
      id: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      horizontal: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const current = pointer.current;
    if (!current || current.id !== event.pointerId || locked) return;
    const deltaX = event.clientX - current.startX;
    const deltaY = event.clientY - current.startY;
    if (!current.horizontal) {
      if (Math.abs(deltaX) < 8 && Math.abs(deltaY) < 8) return;
      if (Math.abs(deltaY) > Math.abs(deltaX)) {
        resetPointer(event.currentTarget, event.pointerId);
        return;
      }
      current.horizontal = true;
      viewportRef.current?.setAttribute("data-dragging", "true");
    }
    let offset = deltaX;
    if ((activeSlide === 0 && deltaX > 0) || (activeSlide === 2 && deltaX < 0)) {
      offset *= 0.24;
    }
    setDragOffset(offset);
  }

  function finishPointer(event: ReactPointerEvent<HTMLDivElement>) {
    const current = pointer.current;
    if (!current || current.id !== event.pointerId) return;
    const deltaX = event.clientX - current.startX;
    const meaningfulDrag = current.horizontal && Math.abs(deltaX) >= 8;
    const threshold = dragThreshold(event.currentTarget.clientWidth);
    resetPointer(event.currentTarget, event.pointerId);
    if (meaningfulDrag) suppressClickUntil.current = performance.now() + 250;
    if (!interactive || locked || Math.abs(deltaX) < threshold) return;
    requestSlide(clampSlide(activeSlide + (deltaX < 0 ? 1 : -1)));
  }

  function onClickCapture(event: ReactPointerEvent<HTMLDivElement>) {
    if (performance.now() < suppressClickUntil.current) {
      event.preventDefault();
      event.stopPropagation();
    }
  }

  useEffect(() => {
    const node = viewportRef.current;
    if (!node || !interactive) return;

    const onWheel = (event: WheelEvent) => {
      if (locked || !hasHorizontalWheelIntent(event.deltaX, event.deltaY)) return;
      event.preventDefault();
      wheelTotal.current += event.deltaX;
      if (wheelQuietTimer.current != null) window.clearTimeout(wheelQuietTimer.current);
      wheelQuietTimer.current = window.setTimeout(() => {
        wheelTotal.current = 0;
      }, 160);
      if (Math.abs(wheelTotal.current) < 56) return;
      const direction = wheelTotal.current > 0 ? 1 : -1;
      wheelTotal.current = 0;
      requestSlide(clampSlide(activeSlide + direction));
    };

    node.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      node.removeEventListener("wheel", onWheel);
      if (wheelQuietTimer.current != null) window.clearTimeout(wheelQuietTimer.current);
      wheelTotal.current = 0;
    };
  }, [activeSlide, interactive, locked, requestSlide, viewportRef]);

  useEffect(() => {
    if (interactive && !locked) return;
    pointer.current = null;
    setDragOffset(0);
    viewportRef.current?.removeAttribute("data-dragging");
  }, [interactive, locked, viewportRef]);

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp: finishPointer,
    onPointerCancel: finishPointer,
    onClickCapture,
  };
}
