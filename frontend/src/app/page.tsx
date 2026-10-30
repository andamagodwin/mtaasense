import { ArrowRight, Camera, GitMerge, ScanSearch, ShieldCheck, Sparkles, UserCheck } from "lucide-react";
import Link from "next/link";
import { LiveStats } from "@/components/live-stats";
import { LinkButton } from "@/components/ui/button";

const steps = [
  {
    icon: <Camera className="size-4" />,
    title: "A resident reports",
    body: "Photo, a few words or a voice note, and an optional map pin. The original evidence is stored unchanged.",
    tag: "Muse Voice Transcribe",
  },
  {
    icon: <Sparkles className="size-4" />,
    title: "Muse Spark structures it",
    body: "Category, visible conditions, a preliminary severity and what remains unknown — each observation tagged with its source.",
    tag: "Muse Spark",
  },
  {
    icon: <ScanSearch className="size-4" />,
    title: "SAM 3.1 outlines the hazard",
    body: "A pixel mask over the pothole, blocked drain or standing water, rendered on the original photo.",
    tag: "SAM 3.1",
  },
  {
    icon: <GitMerge className="size-4" />,
    title: "Reports become one incident",
    body: "PostGIS finds nearby reports of the same kind; a reviewer compares the evidence and decides whether to link them.",
    tag: "Human review",
  },
];

const principles = [
  {
    icon: <ShieldCheck className="size-4" />,
    title: "Evidence first",
    body: "Original photos, descriptions and timestamps are never overwritten. Every decision is in the audit log.",
  },
  {
    icon: <Sparkles className="size-4" />,
    title: "AI kept distinct",
    body: "Model output is labelled as interpretation — with its provenance — and never presented as resident fact or official verification.",
  },
  {
    icon: <UserCheck className="size-4" />,
    title: "People decide",
    body: "Duplicates are suggestions. Only a reviewer links reports, corrects categories or marks an incident resolved.",
  },
];

export default function HomePage() {
  return (
    <div className="mx-auto w-full max-w-[1280px] px-4 sm:px-6">
      <section className="grid gap-10 py-12 sm:py-16 lg:grid-cols-[1.1fr_0.9fr] lg:items-center lg:gap-14">
        <div className="animate-rise">
          <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-[12.5px] text-ink-2">
            <span className="size-1.5 rounded-full bg-accent" />
            Community infrastructure intelligence · Uganda
          </p>
          <h1 className="max-w-[17ch] text-[34px] font-semibold leading-[1.08] tracking-[-0.02em] text-ink sm:text-[46px]">
            From a photo on the street to an evidence‑backed incident.
          </h1>
          <p className="mt-5 max-w-[56ch] text-[16.5px] leading-relaxed text-ink-2">
            Potholes, damaged roads, blocked drains and flooding get reported in fragments — a photo here, a message there.
            MtaaSense uses Meta’s multimodal models to turn those fragments into structured, reviewable records, and helps
            reviewers consolidate repeat reports into a single incident.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <LinkButton href="/report" size="lg" icon={<Camera className="size-4" />}>
              Report a hazard
            </LinkButton>
            <LinkButton href="/map" size="lg" variant="secondary">
              Open the incident map
            </LinkButton>
          </div>
          <Link href="/review" className="mt-5 inline-flex items-center gap-1 text-sm text-ink-3 hover:text-ink">
            Reviewer workspace <ArrowRight className="size-3.5" />
          </Link>
        </div>

        <div className="animate-rise [animation-delay:80ms]">
          <LiveStats />
        </div>
      </section>

      <section className="border-t border-line py-12">
        <div className="mb-6 flex items-end justify-between gap-4">
          <h2 className="text-xl font-semibold tracking-tight">How a report becomes an incident</h2>
        </div>
        <ol className="grid gap-3 md:grid-cols-4">
          {steps.map((step, i) => (
            <li key={step.title} className="relative rounded-[var(--radius-card)] border border-line bg-surface p-4 shadow-[var(--shadow-card)]">
              <div className="mb-3 flex items-center justify-between">
                <span className="grid size-8 place-items-center rounded-lg bg-accent-soft text-accent-ink">{step.icon}</span>
                <span className="font-mono text-[12px] text-ink-3">0{i + 1}</span>
              </div>
              <h3 className="text-[15px] font-semibold">{step.title}</h3>
              <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-2">{step.body}</p>
              <p className="mt-3 text-[12px] font-medium text-accent-ink">{step.tag}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="grid gap-6 border-t border-line py-12 md:grid-cols-3">
        {principles.map((p) => (
          <div key={p.title}>
            <div className="mb-2 flex items-center gap-2 text-ink">
              <span className="text-accent">{p.icon}</span>
              <h3 className="text-[15px] font-semibold">{p.title}</h3>
            </div>
            <p className="text-[14px] leading-relaxed text-ink-2">{p.body}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
