import { useEffect, useRef, useState } from "react";

export function BrandMotion() {
  const [play, setPlay] = useState(false);
  const [paused, setPaused] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const media = matchMedia(
      "(prefers-reduced-motion: no-preference) and (min-width: 1000px)",
    );
    const connection = (
      navigator as Navigator & { connection?: { saveData?: boolean } }
    ).connection;
    const schedule = () => setPlay(media.matches && !connection?.saveData);
    const timer = setTimeout(schedule, 1400);
    media.addEventListener("change", schedule);
    return () => {
      clearTimeout(timer);
      media.removeEventListener("change", schedule);
    };
  }, []);
  useEffect(() => {
    if (!video.current) return;
    if (paused) video.current.pause();
    else void video.current.play().catch(() => {});
  }, [paused, play]);
  return (
    <div className="brand-motion">
      {play ? (
        <video
          ref={video}
          src="/brand-motion.mp4"
          poster="/icons/brand-poster.webp"
          autoPlay
          muted
          loop
          playsInline
          preload="none"
          aria-hidden="true"
        />
      ) : (
        <img
          src="/icons/brand-poster.webp"
          width="480"
          height="480"
          alt="金色书页，汇聚三个账本"
        />
      )}
      {play && (
        <button
          type="button"
          className="motion-toggle"
          onClick={() => setPaused((p) => !p)}
          aria-label={paused ? "播放装饰动效" : "暂停装饰动效"}
        >
          {paused ? "播放动效" : "暂停动效"}
        </button>
      )}
    </div>
  );
}
