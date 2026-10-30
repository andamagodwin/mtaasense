import { Fragment } from "react";
import { AbsoluteFill, Sequence } from "remotion";
import { linearTiming, TransitionSeries } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { pushCut } from "@remotion/transitions/push-cut";
import { gradeFilter, LightLeak, Toning } from "./effects";
import { type Handover, handoverAfter, handoverFrames, shotFrames, shots, timeline } from "./shotlist";
import { Shot } from "./Shot";

function transition(handover: Exclude<Handover, "cut">) {
  const timing = linearTiming({ durationInFrames: handoverFrames[handover] });
  return handover === "push" ? (
    <TransitionSeries.Transition
      presentation={pushCut({ flashColor: "#fff4e6", flashOpacity: 0.35, flashFrames: 3 })}
      timing={timing}
    />
  ) : (
    <TransitionSeries.Transition presentation={fade()} timing={timing} />
  );
}

const LEAK_PAD = 8;

export function Reel() {
  const entries = timeline();

  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      <AbsoluteFill style={{ filter: gradeFilter }}>
        <TransitionSeries>
          {shots.map((shot, i) => {
            const handover = handoverAfter(i);
            return (
              <Fragment key={i}>
                <TransitionSeries.Sequence durationInFrames={shotFrames(shot)}>
                  <Shot shot={shot} />
                </TransitionSeries.Sequence>
                {handover !== "cut" && transition(handover)}
              </Fragment>
            );
          })}
        </TransitionSeries>
      </AbsoluteFill>

      <Toning />

      {entries.slice(0, -1).map(({ end }, i) => {
        const handover = handoverAfter(i);
        if (handover === "cut") return null;
        const frames = handoverFrames[handover] + 2 * LEAK_PAD;
        return (
          <Sequence key={i} from={end - handoverFrames[handover] - LEAK_PAD} durationInFrames={frames} layout="none">
            <LightLeak frames={frames} flip={i % 2 === 1} />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
}
