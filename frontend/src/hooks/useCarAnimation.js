import { useCallback, useEffect, useRef, useState } from "react";

const DEFAULT_DURATION_MS = 2600;
const SETTLE_DELAY_MS = 400;

/**
 * Drives a single { slotIndex, direction, progress } job object from 0 to 1
 * over time via requestAnimationFrame, for the 3D scene's AnimatedCar to
 * render declaratively (it just reads `progress` each render -- no timing
 * logic lives in the 3D layer itself).
 */
export function useCarAnimation() {
  const [job, setJob] = useState(null);
  const rafRef = useRef(null);

  const runJob = useCallback((slotIndex, direction, { durationMs = DEFAULT_DURATION_MS, onComplete } = {}) => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);

    const start = performance.now();
    const step = (now) => {
      const progress = Math.min(1, (now - start) / durationMs);
      setJob({ slotIndex, direction, progress });
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(step);
      } else {
        setTimeout(() => {
          setJob(null);
          onComplete?.();
        }, SETTLE_DELAY_MS);
      }
    };
    rafRef.current = requestAnimationFrame(step);
  }, []);

  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return [job, runJob];
}
