import { MapPin, MessageSquareQuote, Mic } from "lucide-react";
import { CATEGORY_LABEL, formatCoords, formatDateTime } from "@/lib/format";
import type { ReportDetail } from "@/lib/types";

/** Everything here was provided by the resident and is shown verbatim. */
export function ResidentFacts({ report, showMachineTranscript = false }: { report: ReportDetail; showMachineTranscript?: boolean }) {
  const transcriptEdited =
    report.voice_transcript_machine !== null &&
    report.voice_transcript !== null &&
    report.voice_transcript.trim() !== report.voice_transcript_machine.trim();
  return (
    <dl className="space-y-4 text-sm">
      <div>
        <dt className="mb-1 flex items-center gap-1.5 text-[12px] text-ink-3">
          <MessageSquareQuote className="size-3.5" /> Description
        </dt>
        <dd className="whitespace-pre-wrap leading-relaxed text-ink">
          {report.description || <span className="text-ink-3">No written description.</span>}
        </dd>
      </div>
      {report.voice_transcript && (
        <div>
          <dt className="mb-1 flex items-center gap-1.5 text-[12px] text-ink-3">
            <Mic className="size-3.5" /> Voice note transcript {transcriptEdited ? "(corrected by resident)" : ""}
          </dt>
          <dd className="leading-relaxed text-ink">“{report.voice_transcript}”</dd>
          {report.audio && <audio src={report.audio.url} controls className="mt-2 h-9 w-full" />}
          {showMachineTranscript && transcriptEdited && (
            <p className="mt-1.5 text-[12.5px] text-ink-3">Machine transcript: “{report.voice_transcript_machine}”</p>
          )}
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <dt className="text-[12px] text-ink-3">Category chosen</dt>
          <dd className="mt-0.5 text-ink">{report.reporter_category ? CATEGORY_LABEL[report.reporter_category] : "Left to AI"}</dd>
        </div>
        <div>
          <dt className="text-[12px] text-ink-3">Submitted</dt>
          <dd className="mt-0.5 text-ink">{formatDateTime(report.created_at)}</dd>
        </div>
      </div>
      <div>
        <dt className="mb-1 flex items-center gap-1.5 text-[12px] text-ink-3">
          <MapPin className="size-3.5" /> Location
        </dt>
        <dd className="text-ink">
          {report.location ? (
            <>
              <span className="font-mono text-[13px]">{formatCoords(report.location.lat, report.location.lon)}</span>
              <span className="text-ink-3">
                {" "}· {report.location_source === "device_gps" ? "device location" : "map pin"}
                {report.location_accuracy_m ? ` ±${Math.round(report.location_accuracy_m)} m` : ""}
              </span>
            </>
          ) : (
            <span className="text-ink-3">Not provided — kept in the unlocated list</span>
          )}
          {report.location_note && <span className="mt-0.5 block text-ink-2">{report.location_note}</span>}
        </dd>
      </div>
    </dl>
  );
}
