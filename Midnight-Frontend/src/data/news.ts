import { supportAndLegalPages } from "./legal-pages";
/*
 * Article catalogue. Every story comes from the MongoDB "articles" collection;
 * nothing here is hardcoded. The root route loads the catalogue once and calls
 * setCatalogue() so these helpers read live data on server and client.
 */

/** Every article in the catalogue carries the full set of fields below. */
export type Article = {
  id: string;
  slug: string;
  title: string;
  subtitle: string;
  excerpt: string;
  /** Loaded per article on the detail page; empty in listings. */
  body: string[];
  /** One-minute recap shown in the Summary tab. */
  summary: string[];
  section: string;
  /** 1 to 3 section slugs, primary first (sections[0] === section). */
  sections?: string[];
  tag: string;
  desk: string;
  img: string;
  imageAlt: string;
  readingMinutes: number;
  time: string;
  publishedAt: string;
  updatedAt: string;
  /** Measured readership; null when not yet measured. */
  views: number | null;
  shares: number | null;
  /** Editorial importance 0–100 set by the newsroom. */
  headlineWeight: number;
  featured: boolean;
  sourceName: string | null;
  sourceUrl: string | null;
};

export type Section = { slug: string; name: string; desc: string; tags: string[] };
export type Catalogue = { articles: Article[]; sections: Section[]; unavailable?: boolean };

export let articles: Article[] = [];
export let sections: Section[] = [];
/** True when the last catalogue fetch failed (database unreachable). */
export let catalogueUnavailable = false;
let bySlug = new Map<string, Article>();

export function setCatalogue(c: Catalogue) {
  catalogueUnavailable = !!c.unavailable;
  if (c.articles === articles && c.sections === sections) return;
  articles = c.articles;
  sections = c.sections;
  bySlug = new Map();
  for (const a of articles) { bySlug.set(a.slug, a); bySlug.set(slugify(a.title), a); }
}

export const footerSections: { heading: string; links: string[] }[] = [
  { heading: "Sections", links: ["World", "Politics", "Business", "Technology", "Climate", "Science", "Sport", "Culture", "Health", "Opinion"] },
  { heading: "About", links: ["Our mission", "Editorial standards", "Careers", "Press room", "Contact us", "Advertise"] },
  { heading: "Support", links: ["Subscribe", "Help centre", "Manage account", "Privacy policy", "Terms of use"] },
];

export const slugify = (s: string) =>
  s.toLowerCase().replace(/&/g, "and").replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export const getSection = (slug: string) => sections.find((s) => s.slug === slug);
/** Header menus share the full catalogue, with existing labels before sections are available. */
export const navigationSections = (fallbackNames: string[]): Pick<Section, "slug" | "name">[] =>
  sections.length
    ? [...new Map(sections.map((section) => [section.slug, { slug: section.slug, name: section.name }])).values()]
    : [...new Set(fallbackNames)].map((name) => ({ slug: slugify(name), name }));
/** Section for a category label; falls back to a slug of the label. */
export const sectionForTag = (tag: string): Section =>
  sections.find((s) => s.tags.includes(tag) || s.name === tag) ?? { slug: slugify(tag), name: tag, desc: "", tags: [tag] };

export const formatPublished = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(iso));
export const formatPublishedLong = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }).format(new Date(iso)) + " UTC";

export const getArticle = (slug: string) => bySlug.get(slug);
export const articleSlug = (title: string) => slugify(title);
export const canonicalStory = <T extends { title: string; img: string; tag: string }>(story: T): T => {
  const article = getArticle(slugify(story.title));
  return article ? { ...story, img: article.img, tag: article.tag } : story;
};
export const sectionSorts = ["latest", "oldest", "popular", "trending"] as const;
export type SectionSort = typeof sectionSorts[number];
/** Trending = views per minute since publication; unknown readership ranks as 0. */
export const viewsPerMinute = (a: Article, now = Date.now()) => (a.views ?? 0) / Math.max(1, (now - Date.parse(a.publishedAt)) / 60_000);
const byNewest = (a: Article, b: Article) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt) || a.slug.localeCompare(b.slug);
/** Newest stories first. */
export const latestArticles = (n?: number) => [...articles].sort(byNewest).slice(0, n);
/** Top news: featured stories, else the heaviest editorial weights, newest breaking ties. */
export const topNews = (n = 5) => {
  const featured = articles.filter((a) => a.featured);
  const pool = featured.length >= 3 ? featured : articles;
  return [...pool].sort((a, b) => b.headlineWeight - a.headlineWeight || byNewest(a, b)).slice(0, n);
};
export function sortSectionArticles(list: Article[], sort: SectionSort, now = Date.now()): Article[] {
  const value = (a: Article) => sort === "popular" ? (a.views ?? 0) : sort === "trending" ? viewsPerMinute(a, now) : Date.parse(a.publishedAt);
  const dir = sort === "oldest" ? 1 : -1;
  return [...list].sort((a, b) => dir * (value(a) - value(b)) || a.slug.localeCompare(b.slug));
}
export const articlesInSection = (slug: string) => {
  const sec = getSection(slug);
  return sec ? articles.filter((a) => a.section === sec.slug || (a.sections?.includes(sec.slug) ?? false) || sec.tags.includes(a.tag)).sort(byNewest) : [];
};
export const relatedArticles = (article: Article) => articlesInSection(article.section).filter((other) => other.slug !== article.slug).slice(0, 4);
export const searchArticles = (q: string) => {
  const t = q.trim().toLowerCase();
  if (!t) return [];
  return articles.filter((a) => `${a.title} ${a.tag} ${a.desk} ${a.excerpt}`.toLowerCase().includes(t)).sort(byNewest);
};

export type InfoPageSection = { heading: string; body?: string[]; bullets?: string[] };
export type InfoPage = {
  title: string;
  text: string;
  /** Optional rich content blocks rendered below the intro on full pages. */
  sections?: InfoPageSection[];
  /** Optional key facts rendered as a stat strip under the intro. */
  facts?: { label: string; value: string }[];
};

export const infoPages: Record<string, InfoPage> = {
  "the-midnight-brief": { title: "The Midnight Brief", text: "Five stories, five minutes. The day's essential reporting from Midnight." },
  "the-midnight-report": { title: "The Midnight Report", text: "The latest report from the Midnight newsroom." },
  archive: { title: "Archive", text: "Every story we have published, searchable by section and date." },
  corrections: { title: "Corrections", text: "When we get something wrong, we say so here — clearly and promptly." },
  "our-mission": {
    title: "Our mission",
    text: "Midnight exists to make news and information easy to access — clear, concise and straight to the point, without the jargon or the wasted time. Independent journalism, delivered simply.",
    facts: [
      { label: "Founded", value: "2025" },
      { label: "Newsrooms", value: "Nairobi · London · New York" },
    ],
    sections: [
      {
        heading: "Why we exist",
        body: [
          "Finding out what is happening should not take long or require decoding. Too much news is buried in jargon, padding and noise. Midnight was founded in 2025 on a simple idea: make information easy to reach and quick to understand.",
          "Every story is verified, clearly sourced and written to be understood on the first read — no jargon, no filler, straight to the point.",
        ],
      },
      {
        heading: "What we stand for",
        bullets: [
          "Independence — no owner, investor or advertiser influences our coverage.",
          "Accuracy — every claim is checked before publication, and corrected openly when we fall short.",
          "Clarity — clear, concise news written for readers, without jargon.",
          "Speed to understanding — we respect your time and get straight to the point.",
          "Access — our reporting is free to read, with a free edition of the Midnight Report every day.",
        ],
      },
      {
        heading: "What we cover",
        body: [
          "Our desks span World, Business, Technology, Climate, Science, Sport, Culture, Health and Opinion. We prioritise stories with lasting significance over stories that merely trend — the policy behind the headline, the science behind the claim, the people behind the statistic.",
        ],
      },
    ],
  },
  "editorial-standards": {
    title: "Editorial standards",
    text: "Accuracy, fairness and independence guide every story we publish. This page sets out the standards our journalists work to — and what you can expect from us when we get something wrong.",
    sections: [
      {
        heading: "Accuracy and verification",
        body: [
          "Every factual claim in a Midnight story is verified before publication. Reporters must confirm information with at least two independent sources wherever possible, and original documents, data or direct testimony are always preferred over second-hand accounts.",
          "Figures are checked against primary sources. Quotes are verified with the speaker. When a fact cannot be confirmed, we either say so explicitly or leave it out.",
        ],
      },
      {
        heading: "Sourcing",
        bullets: [
          "Named sources are the default; anonymity is granted only when a source faces genuine risk and the information cannot be obtained otherwise.",
          "Anonymous claims are never published on the word of a single source.",
          "We do not pay for interviews or information.",
          "AI tools may assist with transcription, research and copywriting, but never verify a story — every story is the responsibility of a named journalist.",
        ],
      },
      {
        heading: "Independence",
        body: [
          "Editorial decisions are made by editors, full stop. Advertisers, sponsors and partners have no sight of stories before publication and no influence over coverage. Journalists may not accept gifts, travel or hospitality from organisations they cover.",
          "Where a potential conflict of interest exists — a board relationship, an investment, a personal connection — it is disclosed in the story itself.",
        ],
      },
      {
        heading: "Fairness and right of reply",
        body: [
          "People and organisations criticised in our reporting are always given a fair opportunity to respond before publication, with reasonable time to do so. Their response is included prominently, not buried.",
        ],
      },
      {
        heading: "Corrections",
        body: [
          "When we get something wrong, we fix it quickly and say so clearly. Significant corrections appear at the top of the story and on our public Corrections page, with the date and nature of the change. We never silently edit published reporting.",
        ],
      },
    ],
  },
  careers: {
    title: "Careers at Midnight",
    text: "We are always looking for curious reporters, editors, designers and engineers who want to make news clear, concise and easy to access. We currently have no open positions, but we are glad to hear from you.",
    sections: [
      {
        heading: "Life in the newsroom",
        body: [
          "Midnight is a place for people who want to do the best work of their careers without burning out doing it. We keep meeting loads low, deadlines humane and ambitions high. Reporters are given weeks, not hours, to get a story right.",
          "We are a distributed team with hubs in Nairobi, London and New York, and remote colleagues across four continents. Everyone — wherever they sit — has the same access to editors, mentors and growth opportunities.",
        ],
      },
      {
        heading: "Open roles",
        body: [
          "We don't have any open roles at the moment. Check back here — new positions will be listed when they open.",
        ],
      },
      {
        heading: "How we hire",
        body: [
          "Our process is designed to respect your time: a written application, one conversation with the hiring team, a paid work sample relevant to the role, and a final conversation with an editor or team lead. You will hear from us at every stage, and every candidate who completes a work sample receives detailed feedback.",
          "To apply, send your CV and a short note about the work you are proudest of to info@themidnightnews.com. We read everything, and we reply to everyone.",
        ],
      },
    ],
  },
  "press-room": {
    title: "Press room",
    text: "News about Midnight, our brand assets, and how to reach our communications team. For interview requests, media partnerships and speaking engagements, this is the place to start.",
    sections: [
      {
        heading: "Media contacts",
        bullets: [
          "Press enquiries, interview requests, partnerships and syndication — info@themidnightnews.com (answered within one working day)",
        ],
      },
      {
        heading: "About Midnight",
        body: [
          "Midnight is an independent news organisation founded in 2025, with newsrooms in Nairobi, London and New York. Our goal is to make news and information easy to access — clear, concise and straight to the point, without jargon or wasted time. We publish daily reporting across nine desks and the Midnight Report.",
        ],
      },
      {
        heading: "Brand assets",
        body: [
          "Our press kit includes the Midnight wordmark and logo in light and dark variants, product screenshots, and photographs of our newsrooms and leadership. Assets may be used for editorial coverage of Midnight with attribution; commercial use requires written permission.",
        ],
      },
      {
        heading: "Recent announcements",
        bullets: [
          "The Midnight Report reaches one million nightly readers.",
          "Midnight opens its third newsroom, in New York.",
        ],
      },
    ],
  },
  "contact-us": {
    title: "Contact us",
    text: "Whether you have a story tip, a correction, a question about your account or just want to say hello — here is how to reach the right people.",
    sections: [
      {
        heading: "Newsroom",
        bullets: [
          "Story tips, leads and letters to the editor — contact@themidnightnews.com (read by an editor, treated in confidence)",
          "Corrections — contact@themidnightnews.com, with a link to the story and what needs fixing",
        ],
      },
      {
        heading: "Readers",
        bullets: [
          "General questions and feedback — hello@themidnightnews.com",
          "Account help and accessibility feedback — support@themidnightnews.com",
        ],
      },
      {
        heading: "Business",
        bullets: [
          "Advertising, press, partnerships and careers — info@themidnightnews.com",
        ],
      },
      {
        heading: "Our offices",
        body: [
          "Nairobi · London · New York",
          "We answer every message within two working days. Urgent safety or legal matters are prioritised immediately.",
        ],
      },
    ],
  },
  advertise: {
    title: "Advertise with Midnight",
    text: "Reach a thoughtful, global audience of readers who actually read. Advertising helps keep Midnight free to read, and every placement is clearly labelled and kept separate from our journalism.",
    facts: [
      { label: "Nightly readers", value: "1M+" },
      { label: "Countries", value: "140+" },
    ],
    sections: [
      {
        heading: "Our audience",
        body: [
          "Midnight readers are curious professionals, policymakers, researchers and students who choose depth over noise. They spend an average of nine minutes per session, and more than half read us every day.",
        ],
      },
      {
        heading: "Our principles",
        bullets: [
          "Every advertisement is clearly labelled and visually distinct from editorial.",
          "Advertisers have no influence over, or advance sight of, editorial coverage.",
          "We decline categories that conflict with our journalism, including gambling and political campaigning.",
        ],
      },
      {
        heading: "Formats",
        bullets: [
          "Display placements across the site, delivered alongside our reporting.",
          "The Midnight Report sponsorship — a single placement in our nightly edition.",
          "Section partnerships — sustained presence alongside World, Climate, Technology and other desks.",
        ],
      },
      {
        heading: "Working with us",
        body: [
          "Every campaign starts with a conversation about fit. We will walk you through audience data, formats and availability, and design a placement that respects our readers and works for your brand.",
          "Write to info@themidnightnews.com with a short note about your organisation and goals, and we will respond within two working days.",
        ],
      },
    ],
  },
  ...supportAndLegalPages,
};

const ordinal = (n: number) => {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  return `${n}${({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th"}`;
};
/** "15th October" for this year's stories; "15th October 2025" for earlier years. */
export const formatPublishedShort = (iso: string, now: Date = new Date()) => {
  const d = new Date(iso);
  const month = new Intl.DateTimeFormat("en-GB", { month: "long", timeZone: "UTC" }).format(d);
  const base = `${ordinal(d.getUTCDate())} ${month}`;
  return d.getUTCFullYear() === now.getUTCFullYear() ? base : `${base} ${d.getUTCFullYear()}`;
};
