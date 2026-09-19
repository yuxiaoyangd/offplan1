"use client";

import { useEffect, useRef, useState, type CSSProperties, type MouseEvent } from "react";

type BurstShape = "star" | "heart" | "triangle" | "diamond";

type BurstParticle = {
  id: string;
  shape: BurstShape;
  x: number;
  y: number;
  dx: number;
  dy: number;
  size: number;
  rotation: number;
  color: string;
  delay: number;
};

const TITLE_GLOW_RADIUS = 260;

export default function HomePage() {
  const pageRef = useRef<HTMLElement | null>(null);
  const titleRef = useRef<HTMLHeadingElement | null>(null);
  const valuesRef = useRef<HTMLDivElement | null>(null);
  const [burstParticles, setBurstParticles] = useState<BurstParticle[]>([]);

  useEffect(() => {
    const page = pageRef.current;
    if (!page) return;

    const handlePointerMove = (event: PointerEvent) => {
      const shiftX = (event.clientX / window.innerWidth - 0.5) * 56;
      const shiftY = (event.clientY / window.innerHeight - 0.5) * 56;
      page.style.setProperty("--pointer-x", `${event.clientX}px`);
      page.style.setProperty("--pointer-y", `${event.clientY}px`);
      page.style.setProperty("--shift-x", `${shiftX}px`);
      page.style.setProperty("--shift-y", `${shiftY}px`);

      const title = titleRef.current;
      if (title) {
        const titleRect = title.getBoundingClientRect();
        const titleX = event.clientX - titleRect.left;
        const titleY = event.clientY - titleRect.top;
        const distanceX = event.clientX - (titleRect.left + titleRect.width / 2);
        const distanceY = event.clientY - (titleRect.top + titleRect.height / 2);
        const distance = Math.sqrt(distanceX ** 2 + distanceY ** 2);
        const glowOpacity = Math.max(0, Math.min(1, (TITLE_GLOW_RADIUS - distance) / 80));
        title.style.setProperty("--title-pointer-x", `${titleX}px`);
        title.style.setProperty("--title-pointer-y", `${titleY}px`);
        title.style.setProperty("--title-glow-opacity", `${glowOpacity}`);
      }

      const values = valuesRef.current;
      if (values) {
        const valuesRect = values.getBoundingClientRect();
        const distanceX = Math.max(valuesRect.left - event.clientX, 0, event.clientX - valuesRect.right);
        const distanceY = Math.max(valuesRect.top - event.clientY, 0, event.clientY - valuesRect.bottom);
        const distance = Math.sqrt(distanceX ** 2 + distanceY ** 2);
        const glowOpacity = Math.max(0, Math.min(1, (TITLE_GLOW_RADIUS - distance) / 80));
        values.style.setProperty("--values-pointer-x", `${event.clientX - valuesRect.left}px`);
        values.style.setProperty("--values-pointer-y", `${event.clientY - valuesRect.top}px`);
        values.style.setProperty("--values-glow-opacity", `${glowOpacity}`);
      }
    };

    window.addEventListener("pointermove", handlePointerMove, { passive: true });
    return () => window.removeEventListener("pointermove", handlePointerMove);
  }, []);

  function createBurst(event: MouseEvent<HTMLElement>) {

    const burstId = `${Date.now()}-${Math.random()}`;
    const shapes: BurstShape[] = ["star", "heart", "triangle", "diamond"];
    const colors = ["#79dcff", "#ff8cc8", "#ffe27a", "#8df0d2", "#b4a2ff"];
    const particles = Array.from({ length: 17 }, (_, index): BurstParticle => {
      const angle = (Math.PI * 2 * index) / 17 + (Math.random() - 0.5) * 0.42;
      const distance = 58 + Math.random() * 138;
      return {
        id: `${burstId}-${index}`,
        shape: shapes[Math.floor(Math.random() * shapes.length)],
        x: event.clientX,
        y: event.clientY,
        dx: Math.cos(angle) * distance,
        dy: Math.sin(angle) * distance,
        size: 9 + Math.random() * 17,
        rotation: -55 + Math.random() * 110,
        color: colors[Math.floor(Math.random() * colors.length)],
        delay: Math.random() * 35,
      };
    });

    setBurstParticles((current) => [...current, ...particles]);
    window.setTimeout(() => {
      setBurstParticles((current) => current.filter((particle) => !particle.id.startsWith(burstId)));
    }, 2900);
  }

  return (
    <main
      ref={pageRef}
      className="homepage-intro"
      onClick={createBurst}
      onContextMenu={(event) => {
        event.preventDefault();
        createBurst(event);
      }}
    >
      <div className="homepage-grid" aria-hidden="true" />
      <div className="homepage-glow homepage-glow-left" aria-hidden="true" />
      <div className="homepage-glow homepage-glow-right" aria-hidden="true" />
      <div className="homepage-shape homepage-shape-ring" aria-hidden="true" />
      <div className="homepage-shape homepage-shape-diamond" aria-hidden="true" />
      <div className="homepage-shape homepage-shape-orb" aria-hidden="true" />
      {burstParticles.map((particle) => (
        <span
          className="homepage-burst-particle"
          key={particle.id}
          style={{ left: particle.x, top: particle.y }}
          aria-hidden="true"
        >
          <span
            className={`homepage-burst-shape homepage-burst-${particle.shape}`}
            style={{
              "--burst-color": particle.color,
              "--burst-delay": `${particle.delay}ms`,
              "--burst-dx": `${particle.dx}px`,
              "--burst-dy": `${particle.dy}px`,
              "--burst-rotation": `${particle.rotation}deg`,
              "--burst-size": `${particle.size}px`,
            } as CSSProperties}
          >
            {particle.shape === "star" ? "★" : particle.shape === "heart" ? "♥" : null}
          </span>
        </span>
      ))}
      <h1 ref={titleRef} data-title="offplan.yick.cc">offplan.yick.cc</h1>
      <div ref={valuesRef} className="homepage-values" aria-label="富强民主文明和谐 自由平等公正法治 爱国敬业诚信友善">
        富强民主文明和谐<br />
        自由平等公正法治<br />
        爱国敬业诚信友善
      </div>
    </main>
  );
}
