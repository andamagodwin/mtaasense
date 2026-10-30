import { Composition, registerRoot } from "remotion";
import { createElement } from "react";
import { durationInFrames, fps, height, width } from "./shotlist";
import { Reel } from "./Reel";

registerRoot(() =>
  createElement(Composition, { id: "HeroReel", component: Reel, durationInFrames, fps, width, height }),
);
