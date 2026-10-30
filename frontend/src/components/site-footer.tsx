export function SiteFooter() {
  return (
    <footer className="border-t border-line bg-paper">
      <div className="mx-auto flex max-w-[1280px] flex-col gap-2 px-4 py-6 text-[12.5px] leading-relaxed text-ink-3 sm:flex-row sm:items-start sm:justify-between sm:px-6">
        <p className="max-w-2xl">
          MtaaSense is an independent community tool built for the Meta Global AI Developer Hackathon. It is not an
          official government service and is not endorsed by KCCA or any public authority. A report here is not a report
          to an authority, and AI assessments are preliminary review aids — not engineering or official verification.
        </p>
        <p className="shrink-0">
          AI by Meta Muse Spark, SAM 3.1 &amp; Muse Voice Transcribe · Map data © OpenStreetMap contributors
        </p>
      </div>
    </footer>
  );
}
