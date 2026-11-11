import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";
import { inspectRequest, cacheControlFor, SECURITY_HEADERS } from "./lib/protection";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isH3SwallowedErrorBody(body)) return response;

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function isH3SwallowedErrorBody(body: string): boolean {
  try {
    const payload = JSON.parse(body) as { unhandled?: unknown; message?: unknown };
    return payload.unhandled === true && payload.message === "HTTPError";
  } catch {
    return false;
  }
}

function withProtectionHeaders(request: Request, response: Response): Response {
  const res = new Response(response.body, response);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) if (!res.headers.has(k)) res.headers.set(k, v);
  if (res.status === 200 && request.method === "GET" && !res.headers.has("cache-control") && !res.headers.has("set-cookie")) {
    const cc = cacheControlFor(new URL(request.url).pathname, res.headers.get("content-type") ?? "");
    if (cc) res.headers.set("cache-control", cc);
  }
  return res;
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    const verdict = inspectRequest(request);
    if (verdict.action === "block") {
      const headers: Record<string, string> = { "content-type": "text/plain; charset=utf-8", ...SECURITY_HEADERS };
      if (verdict.retryAfter) headers["retry-after"] = String(verdict.retryAfter);
      return new Response(verdict.status === 429 ? "Too many requests. Please wait a moment." : "Not found", { status: verdict.status, headers });
    }
    try {
      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return withProtectionHeaders(request, await normalizeCatastrophicSsrResponse(response));
    } catch (error) {
      console.error(error);
      return new Response(renderErrorPage(), {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
  },
};
