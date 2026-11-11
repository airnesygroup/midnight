import { describe, it, expect, beforeEach } from "vitest";
import { inspectRequest, resetProtection, cacheControlFor, LIMITS } from "@/lib/protection";

const req = (path: string, method = "GET", ua = "Mozilla/5.0", ip = "1.1.1.1") =>
  ({ method, url: `https://x.test${path}`, headers: new Headers({ "user-agent": ua, "cf-connecting-ip": ip }) });

describe("protection", () => {
  beforeEach(() => resetProtection());
  it("lets a normal reader browse 300 pages a minute", () => {
    for (let i = 0; i < LIMITS.read; i++) expect(inspectRequest(req("/"), 0).action).toBe("allow");
    expect(inspectRequest(req("/"), 0)).toMatchObject({ status: 429 });
  });
  it("limits writes to 60 per minute", () => {
    for (let i = 0; i < 60; i++) expect(inspectRequest(req("/_serverFn/x", "POST"), 0).action).toBe("allow");
    expect(inspectRequest(req("/_serverFn/x", "POST"), 0)).toMatchObject({ status: 429 });
  });
  it("blocks exploit probes and scanners", () => {
    expect(inspectRequest(req("/wp-login.php"))).toMatchObject({ status: 404 });
    expect(inspectRequest(req("/.env"))).toMatchObject({ status: 404 });
    expect(inspectRequest(req("/", "GET", "sqlmap/1.7"))).toMatchObject({ status: 403 });
  });
  it("escalates repeated overruns to a temporary block", () => {
    let t = 0;
    for (let round = 0; round < 3; round++, t += 61_000) for (let i = 0; i <= LIMITS.read; i++) inspectRequest(req("/"), t);
    expect(inspectRequest(req("/"), t + 1000)).toMatchObject({ reason: "temporarily blocked" });
    expect(inspectRequest(req("/", "GET", "Mozilla/5.0", "2.2.2.2"), t).action).toBe("allow");
  });
  it("never caches private pages", () => {
    expect(cacheControlFor("/admin", "text/html")).toBe("private, no-store");
    expect(cacheControlFor("/assets/a.js", "")).toContain("immutable");
  });
});
