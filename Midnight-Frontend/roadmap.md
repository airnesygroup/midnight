# Site accent colours (Nov 12)
- [x] Replace pink/purple site gradients with neutral surfaces and solid red accents; preserve header colour glow.
- [x] Verified solid red search and article arrow rims at 1337 and 390 in light/dark; neutral page backgrounds, preserved header images, no page errors.

# Admin analytics (Nov 5)
- [ ] Make Overview all-time and filter every Analytics metric by the selected period.
- [ ] Add active-reading, idle/hidden-tab and bot estimates with anonymous visit journeys in Visitor analysis.
- [ ] Test time/counting rules and verify authenticated dashboard readback.

# Homepage headline and placement (Nov 4)
- [x] Enlarge the main image headline and prevent repeated stories across homepage news sections.
- [x] Test selection rules and verify live layouts at 1280, 949 and 390: 180 unique article placements, larger headline, no overflow or page errors.

# Remaining homepage category layouts (Nov 4)
- [x] Apply the Technology/Business/Climate layout to Sport, Culture, Health & Science, Food, Travel, Style and Entertainment; keep Latest, World and Opinion unchanged.
- [x] Verify live category rows and untitled lists on desktop, medium and phone screens (1280, 949, 390); no duplicates, extra headings, overflow or page errors.

# Homepage category layouts (Nov 3)
- [x] Give Technology a titled big-photo row followed by two untitled Technology card columns; add matching Business and Climate sections beneath it.
- [x] Verify live category content and section order without changing Latest, World or Politics.

# Article headline sizing (Nov 2)
- [x] Reduce main photo headline size at all widths and allow an extra line.
- [x] Allow featured titles three lines, horizontal titles two, and large-photo titles four; keep row text within image height.
- [x] Verify live stories at phone, medium and large widths (390, 949, 1280, 1536); 18 story checks passed.

# Admin articles (Nov 1)
- [ ] Diagnose and repair article document validation failures without bypassing validation.
- [ ] Add confirmed individual/bulk deletion and bulk featured controls; retain other existing bulk actions.
- [ ] Search and filter articles by stored source, across all pages.
- [ ] Test rules and verify authenticated admin operations with temporary stories only.

# Filter strips and credentials (Oct 31, 11:10)
- [x] Open the secure form for the existing MongoDB and admin credentials.
- [x] Keep both article and trending filter strips inset equally while scrolling.
- [x] Add independent typed calendar-date filters to articles and trends, preserving the existing style.
- [ ] Run date-filter tests and check the available page states (paused: workspace credits exhausted).

# Second header menu + dark-mode borders (Oct 31, 10:40)
- [x] Compact-header menu: light/dark switch plus Sign in/Sign up when signed out, or profile summary when signed in.
- [x] Small screens: Report button moves from the compact header into that menu.
- [x] Compact-header hamburger matches header one (size and style).
- [x] Dark mode, small screens only: subtler gradient border on both search bars and the article jump arrow.

# Migration into this project (Oct 31, 10:35)
- [x] Copy code, keep MongoDB, recreate icons, reconnect MONGODB_URI + COMMUNITY_ENCRYPTION_KEY; stories load; 66/66 tests pass.
- [ ] Verify reader sign-up/sign-in and /admin against MongoDB (blocked: test network hit the 3-accounts-per-day sign-up limit; needs a real reader or admin sign-in).

# Oct 31, 09:35
- [ ] Verify reader sign-up/sign-in.
- [x] Admin logo visible in dark mode.
- [x] Hover menus no longer flicker/close.
- [x] Show light/dark toggle on header when the More categories menu is hidden.

# Finish outstanding requests (Oct 31, 09:17)
- [ ] Verify reader signup/signin and admin signin with real sessions; remove verification data.
- [ ] Remove theme-check-tmp admin and leftover scratch files.
- [ ] Verify small-screen layouts, search, both themes and smaller search icons.
- [ ] Resolve the three failing story-rule checks without fabricating or altering editorial data.
- [ ] Request publishing after security check; connect themidnightnews.com (domain confirmation required).

# Move into this Lovable project (Oct 31, 08:28)
- [x] Copy site code from archive, keep MongoDB (user's choice), recreate missing icons.
- [x] Reconnect MongoDB (MONGODB_URI, COMMUNITY_ENCRYPTION_KEY) and check stories load.
- [ ] Verify sign-up/sign-in and /admin against MongoDB.

# Theme sweep (Oct 31, 08:32)
- [ ] Open every page, pop-up, confirmation dialog and toast in dark mode; fix anything off-theme or with invisible text (also re-check light).

# Header toggle (Oct 31)
- [x] Show light/dark toggle on the header itself on large screens (menus on small).
- [x] Online preview loads stories (database works when hosted).

# Dark mode + favicon (Oct 31)
- [x] Dark mode is true dark (not blue) across all screens, cards, tabs; keep premium style; light mode untouched.
- [x] Move light/dark toggle into the menu dropdown, off the header.
- [x] Favicon + Google-discoverable icon from our logo.

# Header updates (Oct 31)
- [x] Compact header: signed-in profile only; signed-out Report (account-state tests pass; live signed-in session unavailable).
- [x] Small screens: mirrored hamburger, no ticker, centre search fills available width.
- [x] Dropdown: separately scrolling categories with always-visible padded sign-up and Report actions.

# Category access (Oct 30)
- [x] Include every category in More categories and the small-screen hamburger menu, including scrolling-header categories.

# Trends pill + categories (Oct 29, 09:44)
- [x] Trends hashtag pill: premium glassy brand gradient.
- [x] Hashtag list opens on hover.
- [x] Add 36 standard news categories (space, astronomy, agriculture, AI, energy...).

# Security + speed (Oct 28, 09:22)
- [x] Bot/abuse limits: gentle for normal readers, strict only on anomalies.
- [x] Layered protection against flooding and common attacks (headers, input limits, admin lockout).
- [x] Data caching and page-speed optimizations.
- [ ] Clarify "DMS" with user.

# SEO + domain (Oct 28, 09:07)
- [x] Site address themidnightnews.com used for canonical, og:url, sitemap, robots.
- [x] sitemap.xml with all pages, sections and articles.
- [x] Structured data, share tags, article interlinking.
- [x] Emails use @themidnightnews.com everywhere.
- [x] Google Analytics (GA4) + Vercel Analytics added.
- [x] Confirm earlier requests (hero animation, stars, admin/user activity, batched admin loading) are done.

# Admin follow-ups (Oct 28, 08:39)
- [x] Team tab shows team activity again (as before).
- [x] Readers: sort/filter by most comments, likes, replies, saves, etc.
- [x] Overview chart lines back to black (no pink gradient fill).
- [x] Remove "Staff only" text on admin sign-in/up form.
- [x] Analytics page shows every total (saves, likes, comments, replies, readers…).
- [x] Admin comment cards match article cards (photo + gradient).
- [x] Phone layout: rearrange admin article/comment/message cards cleanly.
- [x] Admin header gradient no longer covers the top (logo, titles).
- [x] Main site: replace old round spinner with the modern loader.

# Admin requests (Oct 28, 07:56)
- [x] Team tab lists team members; empty card "No team members yet. Add new ones."
- [x] Rename "Members" → "Readers" (Midnight users), listing app users from MongoDB.
- [x] Bulk actions (select many) on lists.
- [x] Centered confirmation pop-up before destructive/saving actions; two-step confirm for the most serious.

# Admin redesign requests (Oct 28, 07:42)
- [x] Own premium dropdown for the time filter + exact "last N days" entry.
- [x] Left menu fixed (scrolls inside), collapses with screen size; hamburger drawer on phones.
- [x] Whole admin responsive at every width: no overflow, no cramped text or cards.
- [x] Search + filters (time, section, status, type…) on Articles, Comments, Members, Activity log, Team.
- [x] Members lists the readers stored in MongoDB.
- [x] One clean animated brand loader used for every loading state (admin + site).
- [x] Switch toggles clearly visible when off.
- [x] All inputs/search/textareas visibly styled; brand focus ring, never black.
- [x] Admin cards, buttons, hovers, story rows match the site's premium look (photo + glow cards).

# Move into new project (Oct 28, 07:32)
- [x] Copy code, recreate tables, email sign-in, reconnect MongoDB, default admin.
- [ ] Import existing users and relink their comments/likes/saves (waits on user export).
- [ ] Import old page views / audit log (waits on export or skip).

# Migration into this project (Oct 27, 13:08)
- [x] Copy site code, apply sign-up schema, enable email + Google sign-in.
- [x] Replace missing Midnight Report image.
- [x] Connect MongoDB (stories and comments load).
- [ ] Import existing user accounts (waits on user export).

# Requests (Oct 27, 13:44)
- [x] Phone header: halve the gap between search and menu button.
- [x] Jump arrow: premium site-style colours (not blue/purple, not black).
- [x] Discussion: more space below "Sign in to join the discussion" (scales with screen).
- [x] Discussion card max height = 3/4 of current.
- [x] Scrolling inside the discussion continues to the page at its ends (both directions).
- [x] Write one short sample Midnight Report into MongoDB (only if the connection is allowed); report page shows latest by default; nothing hard-coded.

# Requests (Oct 27, 13:14)
- [x] Phone-width compact header: signed in → profile icon + Report; signed out → Report only (no Sign in).
- [x] Profile Saved and Liked tabs use the same card design as the Comments tab.
- [x] Missing images show one of ~20 fixed gradients (picked per image), never alt/placeholder text.
- [x] Premium custom scrollbars (page, discussion, any scroll area) in brand colours.
- [x] Whole site responsive at every width: no sideways overflow, nothing cramped or broken.
- [x] Remove social sign-in (Google and others); email + password only.
- [x] Removed forgot password and confirmation emails (user's choice); sign-up is instant, max 3 accounts per network per day.
- [x] Make sure user information stored in MongoDB is encrypted.
- [x] Article Like/Save/Share/Discuss: one line always; drop text labels (icons only) when they don't fit.
- [x] Article page: floating arrow at bottom centre; points down near the top (jumps to the start of the discussion), points up at the discussion (jumps back to top).

# Current requests (Oct 27, after migration)
- [x] Connect MongoDB (MONGODB_URI, COMMUNITY_ENCRYPTION_KEY) and rerun all tests incl. Technology link + wind search checks.
- [x] Clean loading skeletons + empty/error cards everywhere; on failure keep layout with empty cards or show one message, no stray hardcoded titles.
- [x] Fastest possible loading (caching, preloading, lighter pages).
- [x] Like/save: only icon fills; instant updates + smooth animations on like, save, share, discuss, comment.
- [x] Discussion in one card scrolling inside itself.
- [x] Verify sign-in screen changes.
- [x] Verify home page shows article links.
- [x] Midnight Report image kept as local file in src/assets.

# Blocked earlier
- [x] Real publication dates, readership and share counts (not in data).

# Requests (Oct 27, 12:41)
- [x] Wider gap between profile icon and Report button on large screens.
- [x] Each comment/reply in its own visible card (distinct from background).
- [x] Remove "N replies" line; the Reply button shows count and toggles reply input + replies; reply textarea half height.
- [x] Profile comments tab: cards with article image on left + live effect, like article cards.
- [x] Explore categories: cards with small matching image on left + live effect.
- [x] Section pages: infinite scroll; load only important content first.

# Blocked
- [x] Comments load with the newly saved key.
- [x] Some stories in MongoDB point at photos (asset:news-tech.jpg, asset:news-science.jpg) that were not in the upload.

# Requests (Oct 27, 12:54)
- [x] Comment/reply cards use the site's frosted-glass style, not grey.
- [x] Reply box clears and closes after posting.
- [x] Discussion: no fixed height, grows with content up to double the old maximum.
- [x] More space between profile icon and Report button from medium screens up.

# Requests (Oct 28, 06:44)
- [x] Google Analytics (GA4 via @next/third-parties-style gtag; Vercel-compatible env var), no ID yet.
- [x] Admin dashboard at /admin: own visit stats + GA, per-article views, edit/pause articles, site pause, security, sessions, audit log.
- [x] Default admin login admin / admin@admin.com / admin (user's explicit choice), changeable; admins can add editors.

# Requests (Oct 28, 06:59)
- [x] Midnight Report image: dark gradient when no image, never crash.

# Trends finish-up (Oct 29, 07:02)
- [x] Trends page shows trends on first load.
- [x] Each trend opens its own page.
- [x] Checked hashtag dropdown and sort buttons.
- [x] Removed the 3 sample trends and the sample Midnight Report (Oct 27).

# MongoDB-only backend (Oct 30, 13:04)
- [x] Confirm sign-in, sign-up and all user data run on MongoDB only (code already does).
- [x] Add .env.example listing every setting the code reads.
- [x] Save MONGODB_URI and COMMUNITY_ENCRYPTION_KEY securely (waiting on user).

# Logo + header polish (Nov 12)
- [x] Continuous inner line in logo letters.
- [x] Subtler borders on jump arrows and search bars.
- [x] Header colour glow only on article pages.

- [x] Keep square cards but remove the gap above them under the section lead photo (/section/*)
- [x] Square cards stretch so the left column bottom lines up with the side list at every screen size
