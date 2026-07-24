"use client";

import { useEffect, useRef } from "react";
import type { PointerEvent as ReactPointerEvent, RefObject } from "react";
import {
  clampSlide,
  dragThreshold,
  hasReturnToHeroTouchIntent,
  hasReturnToHeroWheelIntent,
  INITIAL_WHEEL_GESTURE,
  reduceWheelGesture,
  RETURN_TO_HERO_TOUCH_THRESHOLD,
  RETURN_TO_HERO_WHEEL_THRESHOLD,
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
  const wheelState = useRef<WheelGestureState>(INITIAL_WHEEL_GESTURE);
  const wheelQuietTimer = useRef<number | null>(null);
  const returnWheelTotal = useRef(0);
  const returnWheelLastAt = useRef(0);
  const touchReturn = useRef<{
    startX: number;
    startY: number;
    startedAtTop: boolean;
    returning: boolean;
  } | null>(null);
  const activeSlideRef = useRef(activeSlide);
  const lockedRef = useRef(locked);
  const requestSlideRef = useRef(requestSlide);
  const returnToHeroRef = useRef(returnToHero);
  activeSlideRef.current = activeSlide;
  lockedRef.current = locked;
  requestSlideRef.current = requestSlide;
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
      const now = performance.now();
      const activeScroll = node.querySelector<HTMLElement>(
        ".home-carousel__slide.is-active .home-carousel__slide-scroll",
      );
      if (
        !lockedRef.current &&
        hasReturnToHeroWheelIntent(
          event.deltaX,
          event.deltaY,
          activeScroll?.scrollTop ?? 0,
        )
      ) {
        event.preventDefault();
        if (now - returnWheelLastAt.current >= WHEEL_GESTURE_QUIET_MS) {
          returnWheelTotal.current = 0;
        }
        returnWheelLastAt.current = now;
        returnWheelTotal.current += event.deltaY;
        if (wheelQuietTimer.current != null) window.clearTimeout(wheelQuietTimer.current);
        wheelQuietTimer.current = window.setTimeout(() => {
          wheelState.current = INITIAL_WHEEL_GESTURE;
          returnWheelTotal.current = 0;
        }, WHEEL_GESTURE_QUIET_MS);
        if (returnWheelTotal.current <= -RETURN_TO_HERO_WHEEL_THRESHOLD) {
          returnWheelTotal.current = 0;
          returnToHeroRef.current();
        }
        return;
      }
      if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) {
        returnWheelTotal.current = 0;
      }
      const decision = reduceWheelGesture(wheelState.current, {
        deltaX: event.deltaX,
        deltaY: event.deltaY,
        now,
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
      returnWheelTotal.current = 0;
    };
  }, [interactive, viewportRef]);

  useEffect(() => {
    const node = viewportRef.current;
    if (!node || !interactive) return;

    const activeScrollTop = () =>
      node.querySelector<HTMLElement>(
        ".home-carousel__slide.is-active .home-carousel__slide-scroll",
      )?.scrollTop ?? 0;

    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1 || lockedRef.current) {
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

  useEffect(() => {
    // Never carry partial accumulation through a slide transition. The
    // consumed flag remains until the stream goes quiet to suppress momentum.
    wheelState.current = {
      ...wheelState.current,
      totalX: 0,
      totalY: 0,
      oppositeTotal: 0,
    };
    returnWheelTotal.current = 0;
  }, [activeSlide, locked]);

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp: finishPointer,
    onPointerCancel: finishPointer,
    onClickCapture,
  };
}
