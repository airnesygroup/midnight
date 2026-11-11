import { z } from "zod";
import { articleSchema } from "./mongodb/schemas";
import { escapeRegex, pageInput, queryWords, sinceDate } from "./admin-paging";

export const articleInput = articleSchema.pick({ slug: true, title: true, subtitle: true, excerpt: true, body: true, summary: true, section: true, tag: true, img: true, imageAlt: true, featured: true, headlineWeight: true });
export const articleListInput = pageInput.extend({
  section: z.string().max(100).default("all"), source: z.string().max(500).default("all"),
  status: z.enum(["all", "draft", "published", "paused", "archived"]).default("all"),
  featured: z.enum(["all", "featured", "regular"]).default("all"),
});
export const articleBulkInput = z.object({ slugs: z.array(z.string().min(1).max(300)).min(1).max(1000), action: z.enum(["delete", "publish", "pause", "feature", "unfeature"]) });
export function selectedArticleFilter(slugs: string[]) { return { slug: { $in: [...new Set(slugs)] } }; }
export function articleFilter(data: z.infer<typeof articleListInput>) {
  const and: Record<string, unknown>[] = [];
  for (const w of queryWords(data.q)) {
    const rx = { $regex: escapeRegex(w), $options: "i" };
    and.push({ $or: [{ title: rx }, { slug: rx }, { section: rx }, { source_name: rx }, { source_url: rx }] });
  }
  const since = sinceDate(data.days);
  if (since) and.push({ publishedAt: { $gte: since.toISOString() } });
  if (data.section !== "all") and.push({ section: data.section });
  if (data.source !== "all") and.push({ source_name: data.source });
  if (data.status !== "all") and.push({ status: data.status });
  if (data.featured !== "all") and.push(data.featured === "featured" ? { featured: true } : { featured: { $ne: true } });
  return and.length ? { $and: and } : {};
}
const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);
export function articleEditFields(data: z.infer<typeof articleInput>, previous: { section?: unknown; sections?: unknown; body?: unknown }, now = new Date()) {
  const { slug: _slug, ...fields } = articleInput.parse(data);
  const body = fields.body.filter((p) => p.trim());
  const extra: Record<string, unknown> = {};
  if (previous.section !== fields.section) {
    const old = Array.isArray(previous.sections) ? previous.sections.filter((s): s is string => typeof s === "string") : [];
    extra["sections"] = [fields.section, ...old.filter((s) => s && s !== fields.section)].slice(0, 3);
  }
  // Preserve the original rich HTML unless the paragraph text actually changes.
  if (JSON.stringify(body) !== JSON.stringify(previous.body)) extra["html_body"] = body.length ? body.map((p) => `<p>${escapeHtml(p)}</p>`).join("\n") : "<p></p>";
  return { ...fields, ...extra, body, summary: fields.summary.filter((p) => p.trim()), updatedAt: now.toISOString() };
}