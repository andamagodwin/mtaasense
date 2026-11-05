import { Camera, Hierarchy, MagicStar, Scanning, ShieldTick, UserTick } from "iconsax-reactjs";
import { SiteAssistant } from "@/components/assistant/site-assistant";
import { HeroReel } from "@/components/hero/hero-reel";
import { LiveStats } from "@/components/live-stats";
import { LinkButton } from "@/components/ui/button";

const steps = [
  {
    icon: <Camera className="size-4" />,
    title: "A resident reports",
    body: "A photo, a few words or a voice note, and an optional map pin. The original evidence is stored unchanged.",
  },
  {
    icon: <MagicStar className="size-4" />,
    title: "Muse Spark structures it",
    body: "Category, visible conditions, a preliminary severity and what remains unknown, with each observation tagged by its source.",
  },
  {
    icon: <Scanning className="size-4" />,
    title: "SAM 3.1 outlines the hazard",
    body: "A pixel mask over the pothole, blocked drain or standing water, drawn on the original photo.",
  },
  {
    icon: <Hierarchy className="size-4" />,
    title: "Reports become one incident",
    body: "Nearby reports of the same kind are matched, and a reviewer compares the evidence before linking them.",
  },
];

const principles = [
  {
    icon: <ShieldTick className="size-4" />,
    title: "Evidence first",
    body: "Original photos, descriptions and timestamps are never overwritten. Every decision is in the audit log.",
  },
  {
    icon: <MagicStar className="size-4" />,
    title: "AI kept distinct",
    body: "Model output is labelled as interpretation, with its provenance, and never presented as resident fact or official verification.",
  },
  {
    icon: <UserTick className="size-4" />,
    title: "People decide",
    body: "Duplicates are suggestions. Only a reviewer links reports, corrects categories or marks an incident resolved.",
  },
];

export default function HomePage() {
  return (
    <>
      <HeroReel>
        <div className="animate-rise">
          <h1 className="max-w-[17ch] text-[34px] font-semibold leading-[1.08] tracking-[-0.02em] sm:text-[52px]">
            From a photo on the street to an evidence‑backed incident.
          </h1>
          <p className="mt-5 max-w-[52ch] text-[16.5px] leading-relaxed text-white/75">
            Potholes, broken roads, blocked drains and flooding get reported in fragments. MtaaSense turns them into
            structured, reviewable records with Meta’s multimodal models.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <LinkButton href="/report" size="lg" icon={<Camera className="size-4" />}>
              Report a hazard
            </LinkButton>
            <LinkButton href="/map" size="lg" variant="glass">
              View the map
            </LinkButton>
          </div>
        </div>
      </HeroReel>

      <div className="mx-auto w-full max-w-[1280px] px-4 sm:px-6">
        <section className="grid gap-8 py-12 lg:grid-cols-[0.9fr_1.1fr] lg:items-center lg:gap-14">
          <div>
            <h2 className="text-xl font-semibold tracking-tight">Disasters start as street‑level warning signs</h2>
            <p className="mt-3 max-w-[56ch] text-[15px] leading-relaxed text-ink-2">
              The reel above is news and community footage of floods, washed-out roads, drought and landslides from
              Mbale, Douala, Bangui, Zambia, Somalia and beyond, 2017 to 2024. Long before damage like that makes the
              news, residents see the signs: a drain that never clears, a road that floods every time it rains.
              MtaaSense makes those observations count as evidence.
            </p>
            <a
              href="https://github.com/andamagodwin/mtaasense/blob/main/hero-reel/ATTRIBUTION.md"
              target="_blank"
              rel="noreferrer"
              className="mt-3 inline-block text-[13px] text-ink-3 underline underline-offset-2 hover:text-ink"
            >
              Footage credits and licences
            </a>
          </div>
          <LiveStats />
        </section>

        <section id="how-it-works" className="scroll-mt-14 border-t border-line py-12">
          <h2 className="mb-6 text-xl font-semibold tracking-tight">How a report becomes an incident</h2>
          <ol className="grid gap-3 md:grid-cols-4">
            {steps.map((step, i) => (
              <li key={step.title} className="rounded-[var(--radius-card)] border border-line bg-surface p-5 shadow-[var(--shadow-card)]">
                <div className="mb-3 flex items-center justify-between">
                  <span className="grid size-8 place-items-center rounded-lg bg-accent-soft text-accent-ink">{step.icon}</span>
                  <span className="font-mono text-[12px] text-ink-3">0{i + 1}</span>
                </div>
                <h3 className="text-[15px] font-semibold">{step.title}</h3>
                <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-2">{step.body}</p>
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
      <SiteAssistant />
    </>
  );
}
