"use client";

import { useEffect, useRef } from "react";
import type { PointerEvent as ReactPointerEvent, RefObject } from "react";
import { findHorizontalScrollRegion } from "@/components/ui/productGestureGuard";
import {
  clampSlide,
  dragThreshold,
  hasReturnToHeroTouchIntent,
  RETURN_TO_HERO_TOUCH_THRESHOLD,
  type CarouselSlideIndex,
} from "./homeExperienceState";

interface CarouselGestureOptions {
  viewportRef: RefObject<HTMLDivElement>;
  trackRef: RefObject<HTMLDivElement>;
  activeSlide: CarouselSlideIndex;
  interactive: boolean;
  locked: boolean;
  requestSlide: (slide: CarouselSlideIndex) => void;
  returnToHero: () => void;
}

export function useCarouselGestures({
  viewportRef,
  trackRef,
  activeSlide,
  interactive,
  locked,
  requestSlide,
  returnToHero,
}: CarouselGestureOptions) {
  const pointer = useRef<{
    id: number;
    startX: number;
    startY: number;
    horizontal: boolean;
  } | null>(null);
  const suppressClickUntil = useRef(0);
  const touchReturn = useRef<{
    startX: number;
    startY: number;
    startedAtTop: boolean;
    returning: boolean;
  } | null>(null);
  const activeSlideRef = useRef(activeSlide);
  const lockedRef = useRef(locked);
  const returnToHeroRef = useRef(returnToHero);
  activeSlideRef.current = activeSlide;
  lockedRef.current = locked;
  returnToHeroRef.current = returnToHero;

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
    if (findHorizontalScrollRegion(event.target, event.currentTarget)) return;
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

    const activeScrollTop = () =>
      node.querySelector<HTMLElement>(
        ".home-carousel__slide.is-active .home-carousel__slide-scroll",
      )?.scrollTop ?? 0;

    const onTouchStart = (event: TouchEvent) => {
      if (
        event.touches.length !== 1 ||
        lockedRef.current ||
        activeSlideRef.current !== 0
      ) {
        touchReturn.current = null;
        return;
      }
      const touch = event.touches[0];
      touchReturn.current = {
        startX: touch.clientX,
        startY: touch.clientY,
        startedAtTop: activeScrollTop() <= 1,
        returning: false,
      };
    };

    const onTouchMove = (event: TouchEvent) => {
      const gesture = touchReturn.current;
      if (!gesture || event.touches.length !== 1 || lockedRef.current) return;
      const touch = event.touches[0];
      const deltaX = touch.clientX - gesture.startX;
      const deltaY = touch.clientY - gesture.startY;
      if (!hasReturnToHeroTouchIntent(deltaX, deltaY, gesture.startedAtTop)) return;
      if (deltaY < 10) return;
      gesture.returning = true;
      event.preventDefault();
    };

    const finishTouch = (event: TouchEvent) => {
      const gesture = touchReturn.current;
      touchReturn.current = null;
      if (!gesture || !gesture.returning || event.changedTouches.length === 0) return;
      const touch = event.changedTouches[0];
      const deltaX = touch.clientX - gesture.startX;
      const deltaY = touch.clientY - gesture.startY;
      suppressClickUntil.current = performance.now() + 300;
      if (
        hasReturnToHeroTouchIntent(deltaX, deltaY, gesture.startedAtTop) &&
        deltaY >= RETURN_TO_HERO_TOUCH_THRESHOLD
      ) {
        returnToHeroRef.current();
      }
    };

    node.addEventListener("touchstart", onTouchStart, { passive: true });
    node.addEventListener("touchmove", onTouchMove, { passive: false });
    node.addEventListener("touchend", finishTouch);
    node.addEventListener("touchcancel", finishTouch);
    return () => {
      node.removeEventListener("touchstart", onTouchStart);
      node.removeEventListener("touchmove", onTouchMove);
      node.removeEventListener("touchend", finishTouch);
      node.removeEventListener("touchcancel", finishTouch);
      touchReturn.current = null;
    };
  }, [interactive, viewportRef]);

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
