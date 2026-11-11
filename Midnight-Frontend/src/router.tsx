import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { PageSkeleton } from "./components/states";

export const getRouter = () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 60_000, gcTime: 10 * 60_000, refetchOnWindowFocus: false, retry: 1 } } });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
    // Start loading a page as soon as a link is hovered or touched.
    defaultPreload: "intent",
    defaultPendingComponent: PageSkeleton,
    defaultPendingMs: 150,
  });

  return router;
};
