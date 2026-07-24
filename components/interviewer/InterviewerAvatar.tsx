"use client";

import { useEffect, useRef, useState } from "react";
import { SYNTHESIS_VIDEO_SRC } from "@/components/hero/media";
import {
  AVATAR_MODE_META,
  type AvatarMode,
} from "@/components/interviewer/avatarState";

const WAVEFORM = [0.42, 0.72, 0.5, 0.88, 0.62, 1, 0.54, 0.8, 0.46, 0.7, 0.38];

/** How long we wait for video metadata before falling back to the CSS monitor. */
const VIDEO_TIMEOUT_MS = 6000;

export interface InterviewerAvatarProps {
  mode: AvatarMode;
  /** Quantized 0..1 audio level; scales the wave amplitude when present. */
  level?: number;
  /** "stage" = full-bleed cinematic banner; "panel" = contained card strip. */
  variant?: "stage" | "panel";
  /** Mono eyebrow under the caption, e.g. "Behavioural voice / cinematic interviewer". */
  captionKicker?: string;
}

export function InterviewerAvatar({
  mode,
  level = 0,
  variant = "stage",
  captionKicker = "Synthesis / live interviewer",
}: InterviewerAvatarProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [videoFailed, setVideoFailed] = useState(false);
  const [compact, setCompact] = useState(false);
  const meta = AVATAR_MODE_META[mode];

  // Panel variant collapses to a lightweight strip on small screens; skip
  // mounting the video there entirely to save bandwidth.
  useEffect(() => {
    if (variant !== "panel" || typeof window === "undefined") return;
    const media = window.matchMedia("(max-width: 720px)");
    const update = () => setCompact(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [variant]);

  const showVideo = !(variant === "panel" && compact);

  // Seek the paused video to a still frame (same technique as the hero);
  // any failure simply reveals the CSS monitor backdrop instead.
  useEffect(() => {
    if (!showVideo) return;
    const video = videoRef.current;
    if (!video) return;
    let done = false;
    const setFrame = () => {
      done = true;
      setVideoFailed(false);
      try {
        if (video.duration && video.currentTime === 0) {
          video.currentTime = video.duration * 0.35;
        }
      } catch {
        // Seek failures are cosmetic; the first frame still shows.
      }
    };
    if (video.readyState >= 1) setFrame();
    video.addEventListener("loadedmetadata", setFrame);
    video.addEventListener("canplay", setFrame);
    const timer = window.setTimeout(() => {
      if (!done) setVideoFailed(true);
    }, VIDEO_TIMEOUT_MS);
    return () => {
      video.removeEventListener("loadedmetadata", setFrame);
      video.removeEventListener("canplay", setFrame);
      window.clearTimeout(timer);
    };
  }, [showVideo]);

  // Announce only meaningful transitions; listening/userSpeaking churn stays
  // silent so screen readers are not spammed mid-conversation.
  const [announced, setAnnounced] = useState("");
  const lastModeRef = useRef<AvatarMode | null>(null);
  useEffect(() => {
    if (lastModeRef.current === mode) return;
    lastModeRef.current = mode;
    if (meta.announce) setAnnounced(meta.announce);
  }, [mode, meta.announce]);

  return (
    <section
      className={`interviewer-stage interviewer-stage--${variant}${videoFailed ? " is-novideo" : ""}`}
      data-mode={mode}
      aria-label="Cinematic interviewer"
      style={{ "--avatar-level": level } as React.CSSProperties}
    >
      {showVideo && (
        <video
          ref={videoRef}
          muted
          playsInline
          preload="metadata"
          tabIndex={-1}
          aria-hidden="true"
          className="interviewer-stage__video"
          onError={() => setVideoFailed(true)}
        >
          <source
            src={SYNTHESIS_VIDEO_SRC}
            type="video/mp4"
            onError={() => setVideoFailed(true)}
          />
        </video>
      )}
      <div className="interviewer-stage__wash" aria-hidden="true" />

      <div className="interviewer-screen" aria-hidden="true">
        <div className="interviewer-screen__label">
          <i />
          <span>{meta.label}</span>
        </div>
        <div className="interviewer-eyes">
          <i />
          <i />
        </div>
        <div className="interviewer-wave">
          {WAVEFORM.map((height, index) => (
            <span
              key={index}
              style={
                {
                  "--wave-height": height,
                  "--wave-delay": `${index * -90}ms`,
                } as React.CSSProperties
              }
            />
          ))}
        </div>
      </div>

      <div className="interviewer-stage__caption">
        <span>{captionKicker}</span>
        <strong>{meta.caption}</strong>
      </div>

      <p className="sr-only" aria-live="polite">
        {announced}
      </p>
    </section>
  );
}
