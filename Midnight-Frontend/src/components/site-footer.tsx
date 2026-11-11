import { Link } from "@tanstack/react-router";
import { Mail, MapPin } from "lucide-react";
import { MidnightLogo } from "@/components/news-bits";
import { Button } from "@/components/ui/button";
import { footerSections, sectionForTag, slugify } from "@/data/news";

function FooterLink({ label, isSection }: { label: string; isSection: boolean }) {
  const cls = "transition hover:text-foreground";
  if (label === "Midnight Trends") return <Link to="/trends" className={cls}>{label}</Link>;
  if (label === "The Midnight Report") return <Link to="/midnight-report" className={cls}>{label}</Link>;
  return isSection ? (
    <Link to="/section/$slug" params={{ slug: sectionForTag(label).slug }} className={cls}>{label}</Link>
  ) : (
    <Link to="/info/$slug" params={{ slug: slugify(label) }} className={cls}>{label}</Link>
  );
}

export function SiteFooter() {
  return (
    <footer className="mx-auto mt-auto w-full max-w-7xl px-4 pb-10">
      <div className="glass rounded-[2.5rem] p-8 md:p-12">
        <div className="grid grid-cols-[minmax(0,1fr)] gap-10 lg:grid-cols-[1.4fr_2fr]">
          <div>
            <Link to="/" className="flex items-center gap-2 text-3xl font-extrabold tracking-tight">
              <MidnightLogo size="h-8 w-8" />
              midnight
            </Link>
            <p className="mt-4 max-w-xs text-muted-foreground">
              News and information made easy to access. Clear, concise and straight to the point.
            </p>
            <div className="mt-6 space-y-2 text-sm text-muted-foreground">
              <p className="flex items-center gap-2"><MapPin className="h-4 w-4" /> Nairobi · London · New York</p>
              <a href="mailto:hello@themidnightnews.com" className="flex items-center gap-2 hover:text-foreground"><Mail className="h-4 w-4" /> hello@themidnightnews.com</a>
            </div>
            <Button asChild variant="secondary" className="mt-6 rounded-full"><Link to="/midnight-report">The Midnight Report</Link></Button>
          </div>
          <div className="grid grid-cols-2 gap-8 sm:grid-cols-3">
            {footerSections.map((col) => (
              <div key={col.heading}>
                <h3 className="text-sm font-bold tracking-wider uppercase">{col.heading}</h3>
                <ul className="mt-4 space-y-2.5 text-sm text-muted-foreground">
                  {(col.heading === "Sections" ? [...col.links, "Midnight Trends"] : col.links).map((link) => (
                    <li key={link}><FooterLink label={link} isSection={col.heading === "Sections"} /></li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
        <div className="mt-10 flex flex-col items-center justify-between gap-4 border-t pt-6 text-sm text-muted-foreground sm:flex-row">
          <span>© 2026 Midnight Media. Independent since day one.</span>
          <div className="flex flex-wrap items-center justify-center gap-6">
            {["Privacy", "Terms", "Accessibility"].map((l) => (
              <FooterLink key={l} label={l} isSection={false} />
            ))}
          </div>
        </div>
      </div>
    </footer>
  );
}
