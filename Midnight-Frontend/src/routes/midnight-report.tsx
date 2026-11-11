import { absUrl } from "@/lib/site";
import { createFileRoute } from "@tanstack/react-router";
import { ReportIssue } from "@/components/report-issue";

export const Route = createFileRoute('/midnight-report')({
  head: () => ({ meta: [
      { property: "og:url", content: absUrl('/midnight-report') },
    { title: 'The Midnight Report — Newsroom edition' },
    { name: 'description', content: 'Read The Midnight Report in full: each edition of Midnight’s essential stories.' },
    { property: 'og:title', content: 'The Midnight Report — Newsroom edition' },
    { property: 'og:description', content: 'The latest edition from the Midnight newsroom.' },
    { property: 'og:type', content: 'article' },
    { name: 'twitter:card', content: 'summary_large_image' },
  ] , links: [{ rel: "canonical", href: absUrl('/midnight-report') }] }),
  component: MidnightReportPage,
});

function MidnightReportPage() {
  return <main className="mx-auto w-full max-w-5xl px-5 pt-32 pb-24"><ReportIssue /></main>;
}