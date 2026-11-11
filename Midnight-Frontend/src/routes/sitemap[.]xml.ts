import { createFileRoute } from "@tanstack/react-router";
import { absUrl } from "@/lib/site";
import { infoPages } from "@/data/news";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

type Entry = { loc: string; lastmod?: string | undefined; changefreq?: string | undefined; priority?: string | undefined };

export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: async () => {
        let catalogue;
        try {
          const { loadCatalogue } = await import("@/lib/catalogue.server");
          catalogue = await loadCatalogue();
        } catch (e) {
          console.error("sitemap: catalogue unavailable", e);
          return new Response("Sitemap temporarily unavailable", { status: 503, headers: { "Retry-After": "300" } });
        }
        let trendList: { slug: string; publishedAt: string; updatedAt: string }[] = [];
        try {
          const { loadTrends } = await import("@/lib/trends.server");
          trendList = await loadTrends();
        } catch (e) {
          console.error("sitemap: trends unavailable", e);
          return new Response("Sitemap temporarily unavailable", { status: 503, headers: { "Retry-After": "300" } });
        }
        const entries: Entry[] = [
          { loc: "/", changefreq: "hourly", priority: "1.0" },
          { loc: "/explore", changefreq: "daily", priority: "0.7" },
          { loc: "/midnight-report", changefreq: "daily", priority: "0.8" },
          ...catalogue.sections.map((s) => ({ loc: `/section/${s.slug}`, changefreq: "hourly", priority: "0.8" })),
          ...catalogue.articles.map((a) => ({ loc: `/article/${a.slug}`, lastmod: a.updatedAt || a.publishedAt || undefined, priority: "0.6" })),
          { loc: "/trends", changefreq: "hourly", priority: "0.7" },
          ...trendList.map((t) => ({ loc: `/trends/${t.slug}`, lastmod: t.updatedAt || t.publishedAt || undefined, priority: "0.5" })),
          ...Object.keys(infoPages).map((slug) => ({ loc: `/info/${slug}`, changefreq: "monthly", priority: "0.3" })),
        ];
        const body = entries.map((e) =>
          `  <url><loc>${esc(absUrl(e.loc))}</loc>${e.lastmod && !Number.isNaN(Date.parse(e.lastmod)) ? `<lastmod>${new Date(e.lastmod).toISOString()}</lastmod>` : ""}${e.changefreq ? `<changefreq>${e.changefreq}</changefreq>` : ""}${e.priority ? `<priority>${e.priority}</priority>` : ""}</url>`,
        ).join("\n");
        const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
        return new Response(xml, { headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=900" } });
      },
    },
  },
});
