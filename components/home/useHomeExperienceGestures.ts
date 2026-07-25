"use client";

import { useEffect, useRef } from "react";
import type { RefObject } from "react";
import { elementCanConsumeHorizontalDelta } from "@/components/ui/productGestureGuard";
import {
  clampSlide,
  hasHorizontalWheelIntent,
  INITIAL_HOME_GESTURE,
  reduceHomeWheelGesture,
  resetHomeGestureState,
  WHEEL_GESTURE_QUIET_MS,
  type CarouselSlideIndex,
  type HomeGestureContext,
  type HomeGestureState,
} from "./homeExperienceState";

interface HomeExperienceGestureOptions extends HomeGestureContext {
  rootRef: RefObject<HTMLElement>;
  openCarousel: () => void;
  requestSlide: (slide: CarouselSlideIndex) => void;
  returnToHero: () => void;
}

export function useHomeExperienceGestures({
  rootRef,
  experience,
  activeSlide,
  transitionLocked,
  reducedMotion,
  openCarousel,
  requestSlide,
  returnToHero,
}: HomeExperienceGestureOptions) {
  const contextRef = useRef<HomeGestureContext>({
    experience,
    activeSlide,
    transitionLocked,
    reducedMotion,
  });
  const previousContext = useRef(contextRef.current);
  const gestureState = useRef<HomeGestureState>(INITIAL_HOME_GESTURE);
  const quietTimer = useRef<number | null>(null);
  const openCarouselRef = useRef(openCarousel);
  const requestSlideRef = useRef(requestSlide);
  const returnToHeroRef = useRef(returnToHero);

  contextRef.current = {
    experience,
    activeSlide,
    transitionLocked,
    reducedMotion,
  };
  openCarouselRef.current = openCarousel;
  requestSlideRef.current = requestSlide;
  returnToHeroRef.current = returnToHero;

  useEffect(() => {
    const context = contextRef.current;
    const previous = previousContext.current;
    const unlocked = previous.transitionLocked && !context.transitionLocked;
    const changedStage = previous.experience !== context.experience;
    const changedSlide = previous.activeSlide !== context.activeSlide;

    if (unlocked) {
      const pendingDirection = gestureState.current.pendingDirection;
      gestureState.current = resetHomeGestureState(
        context,
        gestureState.current,
        true,
      );
      if (context.experience === "carousel" && pendingDirection !== 0) {
        const nextSlide = clampSlide(context.activeSlide + pendingDirection);
        if (nextSlide !== context.activeSlide) {
          gestureState.current = {
            ...gestureState.current,
            momentumDirection: pendingDirection,
            cooldown: true,
          };
          requestSlideRef.current(nextSlide);
        }
      }
    } else if (changedStage && context.experience === "hero") {
      gestureState.current = resetHomeGestureState(context);
    } else if (changedStage || changedSlide || context.transitionLocked) {
      // Completed actions never carry partial axis accumulation into the next
      // panel or slide. Momentum direction is retained only to suppress skips.
      gestureState.current = {
        ...gestureState.current,
        ...context,
        totalX: 0,
        totalY: 0,
        axis: "undecided",
        oppositeTotal: 0,
        exitTotal: 0,
      };
    } else {
      gestureState.current = { ...gestureState.current, ...context };
    }

    previousContext.current = context;
  }, [activeSlide, experience, reducedMotion, transitionLocked]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const resetAfterQuiet = () => {
      if (quietTimer.current != null) window.clearTimeout(quietTimer.current);
      quietTimer.current = window.setTimeout(() => {
        const context = contextRef.current;
        gestureState.current = context.transitionLocked
          ? {
              ...gestureState.current,
              ...context,
              totalX: 0,
              totalY: 0,
              axis: "undecided",
              oppositeTotal: 0,
              exitTotal: 0,
            }
          : resetHomeGestureState(context);
        quietTimer.current = null;
      }, WHEEL_GESTURE_QUIET_MS);
    };

    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey) return;
      const context = contextRef.current;

      if (
        context.experience === "carousel" &&
        hasHorizontalWheelIntent(event.deltaX, event.deltaY) &&
        elementCanConsumeHorizontalDelta(event.target, root, event.deltaX)
      ) {
        if (quietTimer.current != null) window.clearTimeout(quietTimer.current);
        quietTimer.current = null;
        gestureState.current = resetHomeGestureState(context);
        return;
      }

      const activeScroll = root.querySelector<HTMLElement>(
        ".home-carousel__slide.is-active .home-carousel__slide-scroll",
      );
      const result = reduceHomeWheelGesture(gestureState.current, {
        ...context,
        deltaX: event.deltaX,
        deltaY: event.deltaY,
        now: performance.now(),
        activeScrollTop: activeScroll?.scrollTop ?? 0,
      });
      gestureState.current = result.state;

      if (result.preventDefault) {
        event.preventDefault();
        resetAfterQuiet();
      }
      if (result.action === "open-carousel") openCarouselRef.current();
      else if (result.action === "return-to-hero") returnToHeroRef.current();
      else if (result.nextSlide != null) requestSlideRef.current(result.nextSlide);
    };

    root.addEventListener("wheel", onWheel, { passive: false, capture: true });
    return () => {
      root.removeEventListener("wheel", onWheel, true);
      if (quietTimer.current != null) window.clearTimeout(quietTimer.current);
      quietTimer.current = null;
      gestureState.current = resetHomeGestureState(contextRef.current);
    };
  }, [rootRef]);
}
