# Midnight MongoDB preparation

## Status
Schemas, MongoDB collection validators/indexes, API data-access contracts, and an explicit content export are ready. **MongoDB is not connected.** No login, signup, admin, profile, comment, save, like, session or tracking functionality is implemented. Current screens still use the existing catalogue until a real connection is configured and verified. No fake API, silent fallback or invented credentials have been added.

The export contains all 53 current articles, section definitions, information pages, home placements and the ONE available sample Midnight Report. The report calendar currently lists placeholder dates; these are not real editions and are deliberately not exported as reports. Existing article bodies, dates and counters are generated sample data; their values are retained with explicit sample provenance, not promoted to measured news data. New counters and unknown creation times remain null.

## Source of truth
- `src/lib/mongodb/schemas.ts`: validated application documents for 17 collections (including `trends`).
- `src/lib/mongodb/contracts.ts`: read-only repository interface, current query/sort names and responses.
- `src/lib/mongodb/indexes.ts`: uniqueness, listing and cleanup indexes.
- `src/data/report.ts`: existing report copy shared by the screen and export; no copy changed.
- `mongodb/schema.json`: generated MongoDB JSON Schema validators and indexes.
- `mongodb/content-seed.json`: explicit, reviewable sample-content migration.
- `mongodb/asset-manifest.json`: image references that must be hosted before import.

Regenerate with `bun scripts/generate-mongodb-schema.ts` and `bun scripts/export-mongodb-content.ts`.

After deploying the existing images to permanent HTTPS URLs, export with `MONGODB_EXPORT_ASSET_BASE_URL` set to that public base. This is a non-secret asset URL, not a database key. Then run `mongodb/install.mongosh.cjs` manually through mongosh against the intended database. The installer rejects unresolved image references and preserves existing records on reruns. No data is seeded by page requests.

## Connection prerequisite
MongoDB Atlas database access normally requires a **connection URI with database-user credentials**, plus a database name and permitted network access. An Atlas Administration API key manages Atlas resources; it is not a substitute for database credentials. If the future key belongs to an HTTP gateway, its service and HTTPS URL must be identified first.

Atlas Data API / App Services reached end of life September 30, 2025; do not build against it. Cloudflare now documents a MongoDB driver approach, but it must be validated in this project's deployed runtime before adoption. A documented, authorized HTTPS gateway is another option, not an assumed existing service. Credentials must be supplied later using the secure secret form, never pasted into chat or included in browser code. Activate a separate backend before adding runtime server functionality; MongoDB remains the requested editorial store.

References:
- https://developers.cloudflare.com/workers/databases/third-party-integrations/mongodb/
- https://developers.cloudflare.com/workers/tutorials/connect-to-mongodb-atlas/
- https://www.mongodb.com/docs/atlas/app-services/data-api/data-api-deprecation/
- https://www.mongodb.com/docs/drivers/node/current/connect/mongoclient/

## API behavior for the later connection
Implement `EditorialRepository` on the server, behind TanStack server functions. Routes must call the repository through server functions and Query-backed loaders, never query database credentials from the browser. Public reads explicitly project public fields and require `status: published`; owner/admin reads of hidden records must have separate authorized paths. Unavailable storage returns an explicit error, never empty-success or bundled sample fallback.

- Article detail remains `/article/$slug`; IDs remain stable database references, not a replacement URL scheme.
- Search preserves current case-insensitive substring matching across title, tag, desk and excerpt using `q`. Escape regex input if MongoDB regex is used; do not switch to full-text stemming silently.
- Section membership still uses section `tags`, including Health & Science's combined tags.
- Sorts remain latest/oldest by publication time, popular by views, trending by views per minute since publication, with slug tie-breaking. Trending uses request time, not the sample catalogue clock. Missing measurements stay unknown and cannot be manufactured for ranking.
- `offset` skips matching rows; optional `limit` caps returned rows; `total` counts all matches before pagination. Set an operational cap before exposing public pagination.
- Top news remains featured stories ordered by editorial headlineWeight. Home placements preserve the current order and fixed section counts.
- Report date lists come only from stored published editions; selecting a date fetches that edition, not the same copy under a new date.
- HTML content must be sanitized with a proven allowlist before storage AND rendering; allow editorial formatting, never script/event handlers/unsafe URLs or untrusted inline CSS. The prepared export escapes paragraph text; rich HTML rendering is not switched on yet.

## Future security, not active functionality
Profiles are linked by `userId` to the future identity provider; roles are in a separate server-controlled collection. Never allow self-selected admin signup privileges; admin access requires a verified grant/invitation. Email/password only is the required initial provider mode; no OAuth buttons or providers yet. No passwords or raw session tokens belong in profiles or public DTOs. Passwords must use a vetted auth provider's password hashing (not reversible encryption). Private data needs TLS in transit, encryption at rest, least-privilege access and appropriate field-level encryption where required; this preparation does not assert that any hosted encryption is configured or that security is absolute.

Sessions store token digests, idle and absolute expiry, last activity and revocation. Store session/rate-limit expiry fields as **BSON Dates**, not ISO strings, for MongoDB TTL indexes; convert at the repository boundary. TTL is delayed cleanup, NOT authorization: every protected request checks revocation and both expiry deadlines server-side. Secure HttpOnly cookies, CSRF protection, password reset/verification and login throttling belong in the later auth implementation.

Comment frequency/length and session lifetimes have no user-supplied values yet. The disabled security-policy export uses null for undecided values; activation fails until limits are chosen. The Zod schema enforces this cross-field rule; MongoDB's generated structural validator does not encode it, so ALL future policy writes must run application validation. Comments are plain text, with parent/root references; handlers must verify replies belong to the same article, reject cycles, enforce ownership/moderation, and atomically apply rate limits. Article likes/saves and comment likes have unique per-user indexes. Event/counter updates must be idempotent/atomic; avoid client-supplied counts and do not claim a share action proves an externally completed share. Restricted actions will open a login/signup popup, while article reading remains public.

Profile libraries query interaction and comment collections rather than embedding unbounded arrays in profiles. No arbitrary client MongoDB commands or collection names are exposed. Security limits and grant semantics must have handler-level tests when implemented.

## Midnight Trends (`trends` collection)
Trends are written by the external trend generator straight into the `trends` collection. They are fully detached from news: they never appear in sections, the general search, or news article recommendations, and their hashtags never link to news categories.

- Shape: see `trendSchema` in `src/lib/mongodb/schemas.ts` (validator in `mongodb/schema.json`). Required: `id`, `slug` (lowercase-hyphen), `title`, `subtitle`, `excerpt`, `body` (paragraphs), `summary`, `hashtags` (at least one, e.g. `"Fashion"`), `img`, `imageAlt`, `readingMinutes`, `time`, `publishedAt` (ISO), `createdAt`, `updatedAt`, `source_name`, `source_url`, `views`, `shares`, `headlineWeight` (0–100), `featured`, `status`, `provenance`, `schemaVersion: 1`.
- Only `status: "published"` trends are shown. Pages live at `/trends` and `/trends/<slug>`.
- Comments, likes and shares use the discussion id `trends--<slug>`, so counters never mix with news stories.
- New trends show within about a minute (per-server cache).
