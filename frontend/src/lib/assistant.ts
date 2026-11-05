// Client for the review assistant and Ask the map. The backend streams server-sent events: `progress` lines
// while Muse Spark runs its lookups, then one `answer` or `error`. The server keeps no chat state, so each
// question sends the conversation so far.

import { ApiError, parseError } from "./api";
import type { HazardCategory, LatLon } from "./types";

export type AssistantMode = "review" | "map" | "site";

/** A record the answer cites: linked in the text and highlighted on the map. */
export interface AssistantRef {
  kind: "incident" | "report";
  id: string;
  reference: string;
  title: string | null;
  hazard_category: HazardCategory | null;
  status: string;
  location: LatLon | null;
  is_sample: boolean;
}

export type ProposalAction =
  | "confirm_duplicate"
  | "reject_duplicate"
  | "confirm_report_as_incident"
  | "reject_report"
  | "set_incident_priority"
  | "resolve_incident"
  | "add_incident_note";

/** A decision the review assistant suggests. Nothing changes until the reviewer confirms it. */
export interface AssistantProposal {
  id: string;
  action: ProposalAction;
  label: string;
  reason: string;
  target: { kind: "suggestion" | "report" | "incident"; id: string; reference: string };
  params: { title?: string; priority?: "routine" | "elevated" | "urgent"; text?: string; fix_check_id?: string };
}

export type AssistantEvent =
  | { type: "progress"; text: string }
  | { type: "answer"; text: string; refs: AssistantRef[]; proposals: AssistantProposal[]; navigate?: AssistantNavigate | null }
  | { type: "error"; message: string };

/** A page the review assistant opened for the reviewer. */
export interface AssistantNavigate {
  href: string;
  label: string;
}

export interface AssistantTurn {
  role: "user" | "assistant";
  content: string;
}

export interface AssistantContext {
  incident_id?: string;
  report_id?: string;
  suggestion_id?: string;
  bounds?: { south: number; west: number; north: number; east: number };
}

export async function ask(
  mode: AssistantMode,
  messages: AssistantTurn[],
  context: AssistantContext | undefined,
  onEvent: (event: AssistantEvent) => void,
  signal?: AbortSignal,
  options?: { voice?: boolean },
): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`/api/v1/assistant/${mode}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify({ messages, context, ...(options?.voice ? { voice: true } : {}) }),
      credentials: "same-origin",
      cache: "no-store",
      signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new ApiError(0, "network_error", "We couldn't reach MtaaSense. Check your connection and try again.");
  }
  if (!res.ok) throw await parseError(res);
  if (!res.body) throw new ApiError(0, "no_body", "The assistant didn't answer. Try again.");

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  let finished = false;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    let end: number;
    while ((end = buffer.indexOf("\n\n")) !== -1) {
      const chunk = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      const data = chunk
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");
      if (!data) continue;
      const event = JSON.parse(data) as AssistantEvent;
      if (event.type !== "progress") finished = true;
      onEvent(event);
    }
  }
  if (!finished) onEvent({ type: "error", message: "The answer was cut off. Try again." });
}
