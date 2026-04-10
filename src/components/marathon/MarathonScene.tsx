import { useEffect, useRef } from 'react';

interface MarathonSceneProps {
  roundStartedAt: number;
  elapsedBeforePause: number;
  roundDurationMs: number;
  isPaused: boolean;
  showingFeedback: boolean;
}

export function MarathonScene({
  roundStartedAt,
  elapsedBeforePause,
  roundDurationMs,
  isPaused,
  showingFeedback,
}: MarathonSceneProps) {
  const sceneRef = useRef<HTMLDivElement>(null);
  const timeRef = useRef<HTMLDivElement>(null);
  const animationFrameRef = useRef<number | null>(null);

  useEffect(() => {
    if (!sceneRef.current || !timeRef.current) {
      return;
    }

    const updateScene = () => {
      let timeLeftMs = 0;

      if (showingFeedback || isPaused) {
        timeLeftMs = Math.max(0, roundDurationMs - elapsedBeforePause);
      } else if (roundStartedAt > 0) {
        const elapsed = Date.now() - roundStartedAt;
        timeLeftMs = Math.max(0, roundDurationMs - elapsed);
      } else {
        timeLeftMs = roundDurationMs;
      }

      const timerPercent = Math.max(
        0,
        Math.min(100, Math.round((timeLeftMs / roundDurationMs) * 100)),
      );
      const elapsedRatio = 1 - timerPercent / 100;
      const daylight = Math.sin(elapsedRatio * Math.PI);
      const edgeDarkness = 1 - daylight;
      const sunX = 12 + elapsedRatio * 76;
      const sunY = 74 - daylight * 50;
      const farmerX = 34 + elapsedRatio * 32;
      const farmerLift = daylight * 3;

      const scene = sceneRef.current;
      if (scene) {
        scene.style.setProperty('--marathon-sun-x', `${sunX}%`);
        scene.style.setProperty('--marathon-sun-y', `${sunY}%`);
        scene.style.setProperty('--marathon-scene-glow', `${0.08 + daylight * 0.92}`);
        scene.style.setProperty('--marathon-scene-dim', `${0.34 - daylight * 0.26}`);
        scene.style.setProperty('--marathon-scene-night', `${0.52 - daylight * 0.44}`);
        scene.style.setProperty('--marathon-farmer-x', `${farmerX}%`);
        scene.style.setProperty('--marathon-farmer-lift', `${farmerLift}px`);
        scene.style.setProperty('--marathon-scene-shadow', `${0.28 - daylight * 0.18}`);
        scene.style.setProperty('--marathon-scene-warmth', `${0.1 + edgeDarkness * 0.24}`);
      }

      if (timeRef.current) {
        timeRef.current.textContent = Math.ceil(timeLeftMs / 1000).toString();
      }

      if (!isPaused && !showingFeedback && timeLeftMs > 0) {
        animationFrameRef.current = requestAnimationFrame(updateScene);
      }
    };

    animationFrameRef.current = requestAnimationFrame(updateScene);

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [roundStartedAt, elapsedBeforePause, roundDurationMs, isPaused, showingFeedback]);

  return (
    <div ref={sceneRef} className="marathon-scene" aria-hidden="true">
      <div className="marathon-scene-sky" />
      <div className="marathon-scene-sun-glow" />
      <div className="marathon-scene-sun" />
      <div className="marathon-scene-cloud marathon-scene-cloud-one" />
      <div className="marathon-scene-cloud marathon-scene-cloud-two" />
      <div className="marathon-scene-hill marathon-scene-hill-back" />
      <div className="marathon-scene-hill marathon-scene-hill-front" />
      <div className="marathon-scene-path" />
      <div className="marathon-scene-row marathon-scene-row-one" />
      <div className="marathon-scene-row marathon-scene-row-two" />
      <div className="marathon-scene-farmer">
        <span className="marathon-scene-farmer-hat" />
        <span className="marathon-scene-farmer-head" />
        <span className="marathon-scene-farmer-body" />
        <span className="marathon-scene-farmer-arm" />
        <span className="marathon-scene-farmer-leg marathon-scene-farmer-leg-left" />
        <span className="marathon-scene-farmer-leg marathon-scene-farmer-leg-right" />
      </div>
      <div className="marathon-scene-light" />
      <div ref={timeRef} className="marathon-scene-time"></div>
    </div>
  );
}
