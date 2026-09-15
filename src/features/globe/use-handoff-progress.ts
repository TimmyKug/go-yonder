import { useEffect, useState } from "react";

const DEFAULT_DURATION_MS = 420;
const FRAME_MS = 16;

/**
 * Animates towards `target` on the JS thread, one frame per render. The
 * sphere's geometry is recomputed for every frame anyway, so there is nothing
 * for the native driver to carry.
 */
export function useHandoffProgress(target: number, durationMs = DEFAULT_DURATION_MS): number {
  const [progress, setProgress] = useState(target);

  useEffect(() => {
    if (progress === target) return;
    const step = FRAME_MS / durationMs;
    const frame = requestAnimationFrame(() => {
      setProgress((current) =>
        target > current
          ? Math.min(target, current + step)
          : Math.max(target, current - step),
      );
    });
    return () => cancelAnimationFrame(frame);
  }, [durationMs, progress, target]);

  return progress;
}
