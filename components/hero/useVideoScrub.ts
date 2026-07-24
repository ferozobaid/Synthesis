"use client";

import { useEffect, type RefObject } from "react";

const SENSITIVITY = 0.8;
/** Where the static frame sits before any interaction (fraction of duration). */
const INITIAL_FRAME = 0.35;

/**
 * Scrubs a background video forward/backward from horizontal mouse movement.
 * Seeks are serialized through `seeked` so the browser is never flooded.
 * Inactive on touch devices, with reduced motion, or while `disabled`
 * (e.g. the mobile menu is open) — those cases keep a static frame.
 */
export function useVideoScrub(videoRef: RefObject<HTMLVideoElement>, disabled: boolean) {
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const showStaticFrame = () => {
      if (video.duration && video.currentTime === 0) {
        video.currentTime = video.duration * INITIAL_FRAME;
      }
    };
    if (video.readyState >= 1) showStaticFrame();
    video.addEventListener("loadedmetadata", showStaticFrame);

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const finePointer = window.matchMedia("(pointer: fine)").matches;
    if (disabled || reducedMotion || !finePointer) {
      return () => video.removeEventListener("loadedmetadata", showStaticFrame);
    }

    let prevX: number | null = null;
    let targetTime: number | null = null;
    let isSeeking = false;
    let paused = document.hidden;

    const seekTo = (t: number) => {
      isSeeking = true;
      video.currentTime = t;
    };

    const onMouseMove = (e: MouseEvent) => {
      if (paused || !video.duration) return;
      // Freeze scrubbing while the cursor is on interactive elements so the
      // backdrop doesn't shift under a hover or click.
      if ((e.target as HTMLElement | null)?.closest?.("a, button")) {
        prevX = e.clientX;
        return;
      }
      if (prevX === null) {
        prevX = e.clientX;
        return;
      }
      const delta = e.clientX - prevX;
      prevX = e.clientX;
      const base = targetTime ?? video.currentTime;
      const next = base + (delta / window.innerWidth) * SENSITIVITY * video.duration;
      const clamped = Math.max(0, Math.min(video.duration, next));
      if (isSeeking) {
        targetTime = clamped;
      } else {
        seekTo(clamped);
      }
    };

    const onSeeked = () => {
      if (targetTime !== null && Math.abs(targetTime - video.currentTime) > 0.03) {
        const t = targetTime;
        targetTime = null;
        seekTo(t);
      } else {
        targetTime = null;
        isSeeking = false;
      }
    };

    const onVisibility = () => {
      paused = document.hidden;
    };

    window.addEventListener("mousemove", onMouseMove, { passive: true });
    video.addEventListener("seeked", onSeeked);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      video.removeEventListener("seeked", onSeeked);
      document.removeEventListener("visibilitychange", onVisibility);
      video.removeEventListener("loadedmetadata", showStaticFrame);
    };
  }, [videoRef, disabled]);
}
