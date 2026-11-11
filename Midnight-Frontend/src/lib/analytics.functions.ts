import { createServerFn } from "@tanstack/react-start";
import { queryOptions } from "@tanstack/react-query";

/** Returns the public GA4 measurement ID stored as a project secret (it is safe to show in the browser). */
export const getGaId = createServerFn({ method: "GET" }).handler(async () => {
  const id = process.env["GOOGLE_ANALYTICS_MEASUREMENT_ID"]?.trim();
  return { gaId: id && /^G-[A-Z0-9]+$/i.test(id) ? id : null };
});

export const gaIdQuery = queryOptions({ queryKey: ["ga-id"], queryFn: () => getGaId(), staleTime: Infinity });
