import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";

/**
 * Pulls mismatched phone, drone and broadcast footage toward one look: muted colour, deeper contrast,
 * teal shadows and warm highlights. Grain is left to the site (as a CSS overlay) because baked-in noise
 * would multiply the encoded file size.
 */
export const gradeFilter = "saturate(0.78) contrast(1.12) brightness(0.94)";

export function Toning() {
  return (
    <>
      <AbsoluteFill
        style={{
          background: "linear-gradient(180deg, #0d3b4a 0%, #1a2a33 55%, #4a2c16 100%)",
          mixBlendMode: "soft-light",
          opacity: 0.55,
        }}
      />
      <AbsoluteFill
        style={{ background: "radial-gradient(ellipse 75% 70% at 50% 45%, transparent 55%, rgb(0 0 0 / 0.55) 100%)" }}
      />
    </>
  );
}

/** A warm flare that sweeps across the frame — laid over soft transitions to sell the handover. */
export function LightLeak({ frames, flip = false }: { frames: number; flip?: boolean }) {
  const frame = useCurrentFrame();
  const p = frame / Math.max(1, frames - 1);
  const intensity = Math.sin(Math.PI * Math.min(1, Math.max(0, p)));
  const x = interpolate(p, [0, 1], flip ? [85, 15] : [15, 85]);

  return (
    <AbsoluteFill style={{ mixBlendMode: "screen", opacity: 0.75 * intensity }}>
      <AbsoluteFill
        style={{
          background: `radial-gradient(ellipse 45% 80% at ${x}% 40%, rgb(255 170 90 / 0.9), rgb(255 90 40 / 0.35) 45%, transparent 75%)`,
        }}
      />
      <AbsoluteFill
        style={{
          background: `radial-gradient(ellipse 25% 60% at ${100 - x}% 70%, rgb(255 220 160 / 0.5), transparent 70%)`,
        }}
      />
    </AbsoluteFill>
  );
}
