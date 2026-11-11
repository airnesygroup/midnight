import { themeBootScript } from "@/components/theme-toggle";
import { absUrl, CONTACT_EMAIL, SITE_NAME } from "@/lib/site";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  useRouterState,
  HeadContent,
  Scripts,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { AuthProvider } from "@/hooks/use-auth";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { CompactHeader } from "@/components/compact-header";
import { ColorGlow } from "@/components/color-glow";
import appCss from "../styles.css?url";
import { catalogueQuery } from "@/lib/catalogue.functions";
import { setCatalogue } from "@/data/news";
import { setTrends } from "@/data/trends";
import { trendsQuery } from "@/lib/trends.functions";
import { DataUnavailable } from "@/components/data-unavailable";
import { installImageFallback } from "@/lib/image-fallback";
import { useQuery } from "@tanstack/react-query";
import { getSiteStatus } from "@/lib/admin.functions";
import { installGoogleAnalytics, trackPageView } from "@/lib/site-tracking";
import { gaIdQuery } from "@/lib/analytics.functions";
import { Analytics as VercelAnalytics } from "@vercel/analytics/react";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: ErrorComponentProps) {
  const router = useRouter();
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Midnight — News, clearly" },
      { name: "description", content: "Clear, concise news on world, tech, climate and culture — without the jargon." },
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: SITE_NAME },
      { property: "og:locale", content: "en_GB" },
      { name: "twitter:card", content: "summary_large_image" },
          ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=Instrument+Serif:ital@0;1&display=swap" },
      { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
      { rel: "icon", href: "/icon-192.png", type: "image/png", sizes: "192x192" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
      { rel: "manifest", href: "/site.webmanifest" },
    ],
    // Google tag (gtag.js) is loaded in RootComponent once the measurement ID arrives from the server.
    scripts: [
      { type: "application/ld+json", children: JSON.stringify([
        { "@context": "https://schema.org", "@type": "NewsMediaOrganization", name: SITE_NAME, url: absUrl("/"), logo: absUrl("/icon-512.png"), email: CONTACT_EMAIL },
        { "@context": "https://schema.org", "@type": "WebSite", name: SITE_NAME, url: absUrl("/"), potentialAction: { "@type": "SearchAction", target: `${absUrl("/search")}?q={search_term_string}`, "query-input": "required name=search_term_string" } },
      ]) },
    ],
  }),
  beforeLoad: async ({ context, location }) => {
    setCatalogue(await context.queryClient.ensureQueryData(catalogueQuery));
    // Trends load only inside the Trends section, so they never reach news pages or search.
    if (isTrendsPath(location.pathname)) setTrends((await context.queryClient.ensureQueryData(trendsQuery)).trends);
  },
  loader: ({ context }) => context.queryClient.ensureQueryData(catalogueQuery),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

const isTrendsPath = (p: string) => p === "/trends" || p.startsWith("/trends/");

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const catalogue = Route.useLoaderData();
  setCatalogue(catalogue);
  useEffect(() => installImageFallback(), []);
  const pathname = useRouterState({ select: (st) => st.location.pathname });
  const { data: trendData } = useQuery({ ...trendsQuery, enabled: isTrendsPath(pathname) }, queryClient);
  if (trendData) setTrends(trendData.trends);
  const fullHeader = pathname === "/" || pathname.startsWith("/section/");
  useEffect(() => trackPageView(pathname), [pathname]);
  const { data: ga } = useQuery(gaIdQuery, queryClient);
  useEffect(() => { if (ga?.gaId) installGoogleAnalytics(ga.gaId); }, [ga?.gaId]);
  const { data: site } = useQuery({ queryKey: ["site-status"], queryFn: () => getSiteStatus(), staleTime: 60_000 }, queryClient);
  if (pathname.startsWith("/admin")) {
    return (
      <QueryClientProvider client={queryClient}>
        <Outlet />
        <Toaster position="top-center" className="toaster-center" />
      </QueryClientProvider>
    );
  }
  const paused = !!site?.maintenance_mode;
  const needsStories = pathname === "/" || /^\/(section|article|search|explore)(\/|$)/.test(pathname);

  return (
    <QueryClientProvider client={queryClient}>
      {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
      <AuthProvider>
      <TooltipProvider delayDuration={150}>
        <div className="app-shell aurora flex min-h-screen flex-col overflow-x-hidden">
          {!pathname.startsWith("/article/") && <ColorGlow />}
          {fullHeader ? <SiteHeader /> : <CompactHeader />}
          {/* Story pages show only the message when the database is unreachable; never half-empty layouts. */}
          {paused ? (
            <main className="flex flex-1 items-center justify-center px-4 pt-28 pb-24">
              <div className="empty-card max-w-lg p-8 text-center">
                <h1 className="font-serif text-3xl">We'll be right back</h1>
                <p className="mt-3 text-muted-foreground">{site?.maintenance_message || "The site is paused for maintenance."}</p>
              </div>
            </main>
          ) : catalogue.unavailable && needsStories ? <main className="flex flex-1 items-center px-4 pt-28 pb-24"><DataUnavailable /></main> : <Outlet />}
          <SiteFooter />
        </div>
        <Toaster position="top-center" className="toaster-center" />
        <VercelAnalytics />
      </TooltipProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
