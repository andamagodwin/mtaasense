import { ExportSquare } from "iconsax-reactjs";
import Link from "next/link";
import { Logo } from "./brand";
import { LinkButton } from "./ui/button";

const REPO = "https://github.com/andamagodwin/mtaasense";

type FooterLink = { label: string; href: string; external?: boolean };

const COLUMNS: { title: string; links: FooterLink[] }[] = [
  {
    title: "Use MtaaSense",
    links: [
      { label: "Report a hazard", href: "/report" },
      { label: "Incident map", href: "/map" },
      { label: "How it works", href: "/#how-it-works" },
      { label: "Reviewer sign-in", href: "/login" },
    ],
  },
  {
    title: "Open source",
    links: [
      { label: "Source code", href: REPO, external: true },
      { label: "Footage credits", href: `${REPO}/blob/main/hero-reel/ATTRIBUTION.md`, external: true },
      { label: "Photo credits", href: `${REPO}/blob/main/backend/seed/images/ATTRIBUTION.md`, external: true },
    ],
  },
];

const BUILT_WITH = ["Meta Muse Spark", "SAM 3.1", "Muse Voice Transcribe", "OpenStreetMap"];

const linkClass = "inline-flex items-center gap-1.5 rounded-sm text-paper/70 transition-colors hover:text-paper";

function FooterLinkItem({ link }: { link: FooterLink }) {
  if (link.external) {
    return (
      <a href={link.href} target="_blank" rel="noreferrer" className={linkClass}>
        {link.label}
        <ExportSquare className="size-3.5 opacity-60" aria-hidden />
        <span className="sr-only">(opens in a new tab)</span>
      </a>
    );
  }
  return (
    <Link href={link.href} className={linkClass}>
      {link.label}
    </Link>
  );
}

function GitHubMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} fill="currentColor" aria-hidden>
      <path d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z" />
    </svg>
  );
}

export function SiteFooter() {
  return (
    <footer className="relative isolate overflow-hidden bg-night text-[14px] text-paper/70">
      <div className="mx-auto max-w-[1280px] px-4 pt-14 pb-8 sm:px-6 sm:pt-16">
        <div className="grid grid-cols-2 gap-x-6 gap-y-10 md:grid-cols-[1.5fr_1fr_1fr_1fr] md:gap-8">
          <div className="col-span-2 max-w-[40ch] space-y-5 md:col-span-1">
            <Logo className="-ml-0.5 text-paper" />
            <p className="leading-relaxed">
              Turns street-level photos of potholes, blocked drains and flooding into evidence reviewers can act on.
            </p>
            <div className="flex items-center gap-2">
              <LinkButton href="/report">Report a hazard</LinkButton>
              <a
                href={REPO}
                target="_blank"
                rel="noreferrer"
                aria-label="MtaaSense on GitHub (opens in a new tab)"
                title="MtaaSense on GitHub"
                className="grid size-10 place-items-center rounded-[10px] border border-paper/15 text-paper/80 transition-colors hover:border-paper/30 hover:bg-paper/10 hover:text-paper"
              >
                <GitHubMark className="size-[18px]" />
              </a>
            </div>
          </div>

          {COLUMNS.map((column) => (
            <nav key={column.title} aria-label={column.title}>
              <h2 className="mb-4 text-[12px] font-semibold uppercase tracking-[0.08em] text-paper">{column.title}</h2>
              <ul className="space-y-2.5">
                {column.links.map((link) => (
                  <li key={link.label}>
                    <FooterLinkItem link={link} />
                  </li>
                ))}
              </ul>
            </nav>
          ))}

          <div>
            <h2 className="mb-4 text-[12px] font-semibold uppercase tracking-[0.08em] text-paper">Built with</h2>
            <ul className="space-y-2.5">
              {BUILT_WITH.map((name) => (
                <li key={name} className="flex items-center gap-2">
                  <span className="size-1.5 rounded-full bg-accent" aria-hidden />
                  {name}
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="mt-14 flex flex-col gap-3 border-t border-paper/10 pt-6 text-[12.5px] leading-relaxed text-paper/50 md:flex-row md:items-start md:justify-between md:gap-10">
          <p className="max-w-[78ch]">
            © {new Date().getFullYear()} MtaaSense. An independent community tool, not a government service or
            endorsed by KCCA or any public authority. AI assessments are preliminary review aids; a person makes every
            decision.
          </p>
          <p className="shrink-0">
            Map data ©{" "}
            <a
              href="https://www.openstreetmap.org/copyright"
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-2 hover:text-paper"
            >
              OpenStreetMap contributors
            </a>
          </p>
        </div>
      </div>

      {/* Oversized wordmark, cropped by the bottom edge. */}
      <p
        aria-hidden
        className="pointer-events-none -mb-[0.22em] select-none px-4 text-center text-[clamp(72px,19vw,260px)] font-semibold leading-none tracking-[-0.05em] text-paper/[0.05]"
      >
        MtaaSense
      </p>
    </footer>
  );
}
