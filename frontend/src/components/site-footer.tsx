import { LogoMark } from "./brand";

export function SiteFooter() {
  return (
    <footer className="border-t border-line bg-paper">
      <div className="mx-auto flex max-w-[1280px] flex-col gap-3 px-4 py-6 text-[12.5px] leading-relaxed text-ink-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p className="flex items-center gap-2.5">
          <LogoMark className="size-5 shrink-0" />
          An independent community tool, not a government service or endorsed by KCCA or any public authority. AI
          assessments are preliminary review aids.
        </p>
        <p className="shrink-0">AI by Meta Muse Spark, SAM 3.1 &amp; Muse Voice Transcribe · Map data © OpenStreetMap contributors</p>
      </div>
    </footer>
  );
}
