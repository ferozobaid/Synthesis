"use client";

import { useEffect, useRef } from "react";
import type { PointerEvent as ReactPointerEvent, RefObject } from "react";
import {
  clampSlide,
  dragThreshold,
  INITIAL_WHEEL_GESTURE,
  reduceWheelGesture,
  WHEEL_GESTURE_QUIET_MS,
  type WheelGestureState,
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
  const wheelState = useRef<WheelGestureState>(INITIAL_WHEEL_GESTURE);
  const wheelQuietTimer = useRef<number | null>(null);
  const activeSlideRef = useRef(activeSlide);
  const lockedRef = useRef(locked);
  const requestSlideRef = useRef(requestSlide);
  activeSlideRef.current = activeSlide;
  lockedRef.current = locked;
  requestSlideRef.current = requestSlide;

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
      const decision = reduceWheelGesture(wheelState.current, {
        deltaX: event.deltaX,
        deltaY: event.deltaY,
        now: performance.now(),
        activeSlide: activeSlideRef.current,
        locked: lockedRef.current,
      });
      wheelState.current = decision.state;
      if (!decision.preventDefault) return;
      event.preventDefault();
      if (wheelQuietTimer.current != null) window.clearTimeout(wheelQuietTimer.current);
      wheelQuietTimer.current = window.setTimeout(() => {
        wheelState.current = INITIAL_WHEEL_GESTURE;
      }, WHEEL_GESTURE_QUIET_MS);
      if (decision.nextSlide != null) requestSlideRef.current(decision.nextSlide);
    };

    node.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      node.removeEventListener("wheel", onWheel);
      if (wheelQuietTimer.current != null) window.clearTimeout(wheelQuietTimer.current);
      wheelState.current = INITIAL_WHEEL_GESTURE;
    };
  }, [interactive, viewportRef]);

  useEffect(() => {
    if (interactive && !locked) return;
    pointer.current = null;
    setDragOffset(0);
    viewportRef.current?.removeAttribute("data-dragging");
  }, [interactive, locked, viewportRef]);

  useEffect(() => {
    // Never carry partial accumulation through a slide transition. The
    // consumed flag remains until the stream goes quiet to suppress momentum.
    wheelState.current = {
      ...wheelState.current,
      totalX: 0,
      totalY: 0,
      oppositeTotal: 0,
    };
  }, [activeSlide, locked]);

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp: finishPointer,
    onPointerCancel: finishPointer,
    onClickCapture,
  };
}
