"use client";

import { useEffect, useRef, useState } from "react";
import {
  AVATAR_MODE_META,
  type AvatarMode,
} from "@/components/interviewer/avatarState";

const WAVEFORM = [0.42, 0.72, 0.5, 0.88, 0.62, 1, 0.54, 0.8, 0.46, 0.7, 0.38];

export interface InterviewerAvatarProps {
  mode: AvatarMode;
  /** Quantized 0..1 audio level; scales the wave amplitude when present. */
  level?: number;
  /** "stage" = large live monitor; "panel" = compact Case session monitor. */
  variant?: "stage" | "panel";
  /** Mono eyebrow under the monitor caption. */
  captionKicker?: string;
}

export function InterviewerAvatar({
  mode,
  level = 0,
  variant = "stage",
  captionKicker = "Synthesis / live interviewer",
}: InterviewerAvatarProps) {
  const meta = AVATAR_MODE_META[mode];

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
      className={`interviewer-stage interviewer-stage--${variant}`}
      data-mode={mode}
      aria-label="Live interviewer monitor"
      style={{ "--avatar-level": level } as React.CSSProperties}
    >
      <div className="interviewer-crt" aria-hidden="true">
        <div className="interviewer-crt__bezel">
          <div className="interviewer-screen">
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
          <div className="interviewer-crt__deck">
            <span className="interviewer-crt__brand">GoldStar</span>
            <span className="interviewer-crt__vent" />
            <i className="interviewer-crt__power" />
          </div>
        </div>
        <div className="interviewer-crt__stand" />
        <div className="interviewer-crt__base" />
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
