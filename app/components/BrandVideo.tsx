"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./BrandVideo.module.css";

const SOURCE = "/videos/offplan-brand.mp4";

function SoundIcon({ muted }: { muted: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 9v6h4l5 4V5L8 9H4Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      {muted ? <path d="m17 9 5 6m0-6-5 6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /> : <path d="M17 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />}
    </svg>
  );
}

export default function BrandVideo() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const manuallyPaused = useRef(false);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const bounds = video.getBoundingClientRect();
    let inView = bounds.bottom > 0 && bounds.top < window.innerHeight;

    const syncPlayback = () => {
      if (inView && !document.hidden && !manuallyPaused.current) {
        if (video.paused) void video.play().catch(() => setPlaying(false));
      } else {
        video.pause();
      }
    };
    const observer = new IntersectionObserver(([entry]) => {
      inView = entry.isIntersecting;
      syncPlayback();
    }, { threshold: 0.01 });
    observer.observe(video);
    document.addEventListener("visibilitychange", syncPlayback);
    syncPlayback();
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", syncPlayback);
      video.pause();
    };
  }, []);

  const togglePlayback = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      manuallyPaused.current = false;
      void video.play().catch(() => setPlaying(false));
    } else {
      manuallyPaused.current = true;
      video.pause();
    }
  };

  const toggleSound = () => {
    const video = videoRef.current;
    if (!video) return;
    const nextMuted = !video.muted;
    video.muted = nextMuted;
    if (!nextMuted) {
      video.currentTime = 0;
      manuallyPaused.current = false;
      void video.play().catch(() => setPlaying(false));
    }
  };

  return (
    <section className={styles.section} aria-label="18 秒认识 offplan">
      <div className={styles.player}>
        <video
          ref={videoRef}
          className={styles.video}
          src={SOURCE}
          poster="/videos/offplan-poster.jpg"
          preload="auto"
          autoPlay
          muted
          loop
          playsInline
          aria-label="offplan 品牌介绍动画"
          aria-describedby="brand-film-description"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onVolumeChange={(event) => setMuted(event.currentTarget.muted)}
          onError={() => setFailed(true)}
        />
        {failed ? (
          <div className={styles.fallback} role="status">
            <strong>人再多，也从容。</strong>
            <p>offplan 极简排班，一键导入名单，一键导出排班表。</p>
            <a href={SOURCE}>打开视频</a>
          </div>
        ) : (
          <div className={styles.controls}>
            <button className={styles.playButton} type="button" onClick={togglePlayback} aria-label={playing ? "暂停品牌视频" : "播放品牌视频"}>
              <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                {playing ? <path d="M7 5h3v14H7zm7 0h3v14h-3z" /> : <path d="m8 5 11 7-11 7V5Z" />}
              </svg>
            </button>
            <button className={styles.soundButton} type="button" onClick={toggleSound} aria-label={muted ? "开启声音并从头播放品牌视频" : "静音品牌视频"}>
              <SoundIcon muted={muted} />
              <span>{muted ? "开启声音，从头看" : "声音已开启"}</span>
              {muted && <span className={styles.soundHint} aria-hidden="true">♪</span>}
            </button>
          </div>
        )}
      </div>
      <p id="brand-film-description" className={styles.description}>从 10 人、100 人到更多人，告别姓名与休息日交错的排班烦恼。用 offplan 一键导入名单，轻松安排，再一键导出排班表。</p>
    </section>
  );
}
