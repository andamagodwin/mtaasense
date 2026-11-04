"use client";

import { errorLabel } from "@/lib/format";
import type { ReportVideo } from "@/lib/types";
import { ProvenanceBadge } from "./badges";
import { Card, CardBody, CardHeader } from "./ui/card";
import { Callout, Spinner } from "./ui/feedback";

/** A report's clip: the playable video, tracked stills, and Muse Spark's motion description. */
export function VideoSection({ video }: { video: ReportVideo }) {
  return (
    <Card>
      <CardHeader
        title="Clip"
        description={
          video.concept
            ? `Tracking “${video.concept}” frame by frame with SAM 3.1.`
            : "Motion analysis of the attached clip."
        }
        action={video.provenance ? <ProvenanceBadge provenance={video.provenance} /> : undefined}
      />
      <CardBody>
        {video.status === "failed" ? (
          <Callout tone="warn" title="Clip analysis failed">
            {errorLabel(video.outline_error)}. The photo report is unaffected.
          </Callout>
        ) : video.status !== "completed" ? (
          <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-line-strong bg-sunken px-4 py-10 text-center">
            <Spinner className="size-6 text-accent" />
            <p className="max-w-70 text-[13.5px] text-ink-2">
              Tracking the hazard frame by frame and describing the motion…
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {video.clip && (
              <video
                src={video.clip.url}
                controls
                playsInline
                preload="metadata"
                poster={video.stills[0]?.image.url}
                className="aspect-video w-full rounded-xl border border-line bg-photo"
              />
            )}
            {video.stills.length > 0 && (
              <div className="grid grid-cols-3 gap-2.5">
                {video.stills.map((still, i) => (
                  <figure key={still.image.id} className="min-w-0 space-y-1">
                    <div className="overflow-hidden rounded-lg border border-line bg-photo">
                      {/* eslint-disable-next-line @next/next/no-img-element -- private, signed evidence URLs bypass the optimizer */}
                      <img
                        src={still.image.url}
                        alt={`Tracked frame ${i + 1} at ${still.time_s.toFixed(1)} seconds`}
                        className="block aspect-[4/3] w-full object-cover"
                      />
                    </div>
                    <figcaption className="text-[12px] text-ink-3">
                      {still.time_s.toFixed(1)}s · {still.track_count} tracked
                    </figcaption>
                  </figure>
                ))}
              </div>
            )}
            {video.assessment ? (
              <dl className="space-y-2.5 text-[13.5px] leading-relaxed">
                <div>
                  <dt className="font-medium">What the clip shows</dt>
                  <dd className="text-ink-2">{video.assessment.summary}</dd>
                </div>
                <div className="grid gap-2.5 sm:grid-cols-2">
                  <div>
                    <dt className="font-medium">Motion</dt>
                    <dd className="text-ink-2">{video.assessment.motion}</dd>
                  </div>
                  <div>
                    <dt className="font-medium">Spread</dt>
                    <dd className="text-ink-2">{video.assessment.spread}</dd>
                  </div>
                </div>
                <div>
                  <dt className="font-medium">Start to end</dt>
                  <dd className="text-ink-2">{video.assessment.changes_through_clip}</dd>
                </div>
                {video.assessment.uncertainties.length > 0 && (
                  <div>
                    <dt className="font-medium">Uncertain</dt>
                    <dd className="text-ink-2">{video.assessment.uncertainties.join(" ")}</dd>
                  </div>
                )}
                <p className="text-[12.5px] text-ink-3">
                  {video.tracked_objects ?? 0} objects tracked · confidence {video.assessment.confidence}
                  {video.assessment.hazard_visible ? "" : " · hazard not visible in the clip"}
                </p>
              </dl>
            ) : (
              <p className="text-[13.5px] text-ink-3">
                {video.tracked_objects ?? 0} objects tracked
                {video.concept ? ` (“${video.concept}”)` : ""}. No motion description was produced.
              </p>
            )}
          </div>
        )}
      </CardBody>
    </Card>
  );
}
