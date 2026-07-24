"use client";

import { useEffect, useRef } from "react";
import { SYNTHESIS_VIDEO_SRC } from "@/components/hero/media";

const WAVEFORM = [0.42, 0.72, 0.5, 0.88, 0.62, 1, 0.54, 0.8, 0.46, 0.7, 0.38];

export function BehaviouralInterviewerStage({
  active,
}: {
  active: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const setFrame = () => {
      if (video.duration && video.currentTime === 0) {
        video.currentTime = video.duration * 0.35;
      }
    };
    if (video.readyState >= 1) setFrame();
    video.addEventListener("loadedmetadata", setFrame);
    return () => video.removeEventListener("loadedmetadata", setFrame);
  }, []);

  return (
    <section
      className={`behavioural-interviewer-stage${active ? " is-active" : ""}`}
      aria-label="Cinematic behavioural interviewer"
    >
      <video
        ref={videoRef}
        muted
        playsInline
        preload="metadata"
        tabIndex={-1}
        aria-hidden="true"
        className="behavioural-interviewer-stage__video"
      >
        <source src={SYNTHESIS_VIDEO_SRC} type="video/mp4" />
      </video>
      <div className="behavioural-interviewer-stage__wash" aria-hidden="true" />

      <div className="behavioural-interviewer-screen" aria-hidden="true">
        <div className="behavioural-interviewer-screen__label">
          <i />
          <span>{active ? "Interview live" : "Interviewer ready"}</span>
        </div>
        <div className="behavioural-interviewer-eyes">
          <i />
          <i />
        </div>
        <div className="behavioural-audio-wave">
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

      <div className="behavioural-interviewer-stage__caption">
        <span>Behavioural voice / cinematic interviewer</span>
        <strong>{active ? "Listening now" : "Ready when you are"}</strong>
      </div>
    </section>
  );
}
