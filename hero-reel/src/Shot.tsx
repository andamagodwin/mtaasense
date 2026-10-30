import { AbsoluteFill, interpolate, OffthreadVideo, staticFile, useCurrentFrame } from "remotion";
import { clipFile, fps, leadIn, type Shot as ShotData, shotFrames } from "./shotlist";

/** One shot: its source window, a slow push-in, and framing that keeps broadcaster logos out of frame. */
export function Shot({ shot }: { shot: ShotData }) {
  const frame = useCurrentFrame();
  const [from, to] = shot.zoom ?? [1.02, 1.08];
  const scale = interpolate(frame, [0, shotFrames(shot)], [from, to], { extrapolateRight: "clamp" });

  return (
    <AbsoluteFill style={{ overflow: "hidden", backgroundColor: "#000" }}>
      <OffthreadVideo
        src={staticFile(clipFile(shot))}
        trimBefore={Math.round(leadIn(shot) * fps)}
        muted
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          transform: `scale(${scale})`,
          transformOrigin: shot.origin ?? "50% 50%",
          filter: shot.exposure ? `brightness(${shot.exposure})` : undefined,
        }}
      />
    </AbsoluteFill>
  );
}
