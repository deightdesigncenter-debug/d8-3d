# D.EIGHT DESIGN CENTER site — notes for working on this repo

Cloudflare Pages project `d8-3d` (advanced mode: `public/_worker.js`, KV binding `CASES`, D1 binding `DB` = `d8-db`
for the order book; optional `AI`, `FILES` R2, PayPal/Stripe secrets). Push to `main` deploys to https://d8-3d.pages.dev in 1–2 minutes. README.md (Vietnamese)
describes features and setup.

## Rule: test everything before every push
The owner wants the site to run without errors or jank, and every new feature checked for conflicts with the old ones.

1. Run `dev/tests/run.sh` (starts the local emulator with payment/AI mocks, then without them). Every suite must pass.
2. New feature → add checks to the matching suite (API: `*.test.mjs`; browser: `*_ui.py`), including permission
   checks for the workspace roles and what customers must NOT see (price, staff, internal notes, design files).
3. Look at the screenshots it writes (light and dark, desktop and phone) for layout problems.
4. Keep `dev/tests/perf.py` green: no layout shift (CLS 0) and screens ready fast on a throttled phone.
5. Bump `?v=` in the HTML pages and `ASSET_VERSION` in `_worker.js` when CSS/JS changes.

## Layout of the code
- `public/shell.js`: shared header/footer, EN/VI dictionary, theme (light/dark), sign-in state, `D8.can(perm)`,
  uploads, chat thread, motion helpers (`D8.busy`, `D8.done`, `D8.skel`, `D8.animIn`).
- `public/portal.*`: customer portal. `public/admin.*`: staff workspace (sidebar, dashboard, orders, portal cases,
  customers, product codes & prices, reports, Excel import, staff & permissions, settings, 3D links, contact messages). `public/stl.html`: HTML → STL tool.
- `public/orders.js` (order list/form/page, order chat), `public/books.js` (customers, product codes & prices, reports,
  import, settings), `public/tech.js` (KTV pages `#team`, `#team/<email>`, `#me` "Công của tôi", monthly pay slips),
  `public/snap.js` (3D link preview snapshot), `public/xlsx.js` (Excel read/write in the browser; a cell `{v, t}` has its own format),
  `public/viewer3d.js` (own WebGL viewer for STL / PLY / OBJ: order page "Xem trước 3D" from chat files, case design files, any `[data-v3d]` button).
- `public/about.html` + `site/about.js` + `site/about-dict.js` ("Giới thiệu", `dev/tests/about_ui.py`): layout modelled on
  luminadental.com.au (centred heads, picture/text chequerboard, card rows, closing call to action). Featured full-mouth case,
  17 CAD screenshots with a filter, 3 screen recordings (MP4 + WebM, `preload="none"`, play only while on screen, never by
  themselves with reduced motion; no pause / play button — owner's rule 2026-10-26: they keep running, a clip paused any other
  way starts again, and only with reduced motion the browser's own controls appear), 6 more cases, one image viewer (`<dialog>`). Media in `public/site/about/` with neutral
  names. The owner has the doctors' and patients' consent for these cases; still never put patient or client-lab names,
  faces (exocad HTML "2D Images") or prices on the page — the test checks. Header "About" links here; the homepage About
  section is a short teaser that links to it. Order: case → recordings → CAD screens → more cases. No finished-product
  photos anywhere (owner's rule 2026-10-26: D.EIGHT only designs, it does not make the final product; the tests check).
- Type (owner's choice 2026-10-25): one family, Be Vietnam Pro (300–700). `--f-display` = Be Vietnam Pro; page headings
  (home, About, legal / portal bands) are bold, sentence case, slightly negative tracking; small labels, buttons, eyebrows
  stay in spaced caps. Lexend Exa is gone. Noto Serif Display stays only for the serif accent lines (slogans, English in VI).
- Homepage, Lumina-style: "Why D.EIGHT" is a 4×2 picture/text chequerboard of real CAD screens (2 columns on tablet,
  stacked on phone); a full-width strip of the 3 screen recordings (`#recordings`, same play-on-screen and no-button rules, logic in
  `site/home.js`; captions are `pointer-events: none`) links to `/about#screens` and `/about#clips`.
- Free revisions (owner's rule 2026-10-26): the owner decides. Settings `freeRevisions` (default 2, 0–20, staff.manage) is public in
  `/api/config` and printed into `.rev-n` spans (home, terms) by `D8.fillRev`; per case `job.revFree` / `job.revUsed` via
  `POST /api/jobs/<id>/revisions` (billing.edit only); review → in_design adds one used. `jobView` sends `rev: {free, used, custom}`
  to staff and the customer (raw fields stay internal). Tests: `dev/tests/revisions.test.mjs` (also with `R2=1`).
- Case files: in R2 (`FILES`) they are kept with the case (`exp: 0`, shown "lưu cùng ca"); in KV they expire after 60 days.
  privacy / terms carry both texts in `<!--store:r2-->` / `<!--store:kv-->` blocks; `publicPage` keeps the one that matches.
  Never add an R2 lifecycle rule for `jf:`.
- People on the site: Danny Do = client contact (WhatsApp, email, contact form); Nhut Hoa = design technician (About › team).
- Customer codes (owner's rule): `DR` (doctor / clinic) or `LAB` + year + running number shared by both (DR202601, LAB202602), given by
  the server; the prefix follows the kind. Price levels: list price (MAX) = prices.customer_id 0, MID = -2, MIN = -3; `customers.tier`
  ('' / mid / min, schema v3). Lookup: customer's own price → their level → list price. `/api/pricelist` imports the owner's Excel layout
  (No. · SERVICE · DESCRIPTION · UNIT · UNIT PRICE, group heading rows) into one list (list / mid / min / customer / tech); new services get
  codes from group prefix + number (CB07). Never commit the owner's real price files; tests build made-up ones.
- Notifications: `D8.notify.set(source, items)` feeds the header bell (workspace and portal). Portal cases are counted from the list
  the page already loaded (KV list calls are limited to 1,000/day on the free plan); orders come from `/api/todo` (D1).
- `/api/tech` (team: staff.manage / techpay.manage / reports.view) and `/api/tech/<email>` (also the KTV themself with
  cases.design); pay fields only with techpay.manage, or techpay.own for one's own page (on in the default designer role).
- Order book (D1, schema auto-created and migrated: `SCHEMA_V1`, `SCHEMA_V2`): codes `yymmddxx` (26102101 = stage 1),
  next stage `C2`, `C3`…, redo `R1`, `R2`…, redo then next stage `R1C2` (owner's rules; old `26/10/21/01` is normalised). Free-plan D1
  limits: ≤50 queries per request, ≤100 bound params per query — bulk writes go through `json_each(?)`. The local D1
  mock (`dev/server.mjs`, node:sqlite) counts queries; `NO_DB=1` runs without it. `orderOut` strips money unless
  `billing.view`, tech cost unless `techpay.*`; KTVs never see prices.
- A D1 binding under another name than `DB` is picked up too (`withDb`, found by the methods on its prototype chain — never
  by reading properties, because service bindings like `ASSETS` answer any property as an RPC stub); `/api/book/status`
  lists the bindings (staff.manage only). Local: `DB_AS=name` binds the mock that way; the mock `ASSETS` behaves like an RPC stub.
- KTV privacy (owner's rule, `dev/tests/privacy.test.mjs` with two KTVs): a KTV sees only what is assigned to them; `/api/staff/team`
  leaves out the other KTVs for a KTV who does not run the team; 3D links carry their maker (`u`) and are listed / deleted
  only by them unless `links.all`; `/api/settings` needs staff.manage or billing.edit.
- Settings KV `cfg:settings`: `onlinePay` and `autoTrial` are OFF by default (owner's choice); `spamWords` / `blockEmails` are the owner's
  own block lists (newline-joined, lower case).
- Contact form anti-spam (`submitContact`, `dev/tests/contact.test.mjs` + `contact_ui.py`, also run with `TS=1`): honeypot `website`,
  signed time token from `/api/contact/token` (HMAC with the session key, ≥3 s, ≤24 h; the page fetches it on first focus and waits),
  optional Cloudflare Turnstile (`TURNSTILE_SITE_KEY` + `TURNSTILE_SECRET`; `TURNSTILE_API` points at the mock locally), link / keyword /
  disposable-email filters, `CONTACT_PER_IP` per address per day (KV `msgip:`) and `MSG_DAILY_CAP`. Bots get a quiet ok; filtered people
  get a 400 with our email. Blocked messages go to D1 `spam_log` (schema v4, 30 days) for review / restore (`messages.view`).
- Main domain (`settings.siteHost`, `dev/tests/domain.test.mjs` + `domain_ui.py`): set from Settings only while the site is open at
  that host (server checks `url.hostname`, never `.pages.dev`). Then every other host 301s GET pages / `/v/` links there (not `/api/`,
  not branch previews `<x>.d8-3d.pages.dev`); `/admin?stay=1` sets cookie `d8stay` to stay on the old host for a day. Pages carry
  `https://d8-3d.pages.dev` in canonical / og tags; `publicPage` swaps in the right origin and, at the main domain only, drops noindex
  for `/`, `/about`, `/privacy`, `/terms`; `/robots.txt` opens and `/sitemap.xml` is served there.
- Team at work (`dev/tests/team.test.mjs`, owner's request 2026-10-26): 4 KTVs + 1 QC at the same moment on portal cases and the
  order book (receive files, design, send to QC / not done, QC pass / fail with note, fix, deliver, privacy, to-do counts, KV use).
  run.sh starts it with `NET_MS=25 KV_EDGE_MS=60000`: every KV / D1 / R2 call waits like a network call and KV keeps a copy per
  location (`x-test-colo` header, 60 s like Workers KV). Without NET_MS the emulator answers at once, requests never overlap and
  races stay hidden; `KV_RATE=1` adds the 1 write / s per key limit (429). New order codes (staff orders and portal cases) are taken
  inside the INSERT (`insertNextCode`: MAX(seq)+1 of the day in the same statement — no duplicates, no gaps); never go back to
  reading `nextSeq` first and inserting after. A new customer and its login are one batch and the login is never replaced there
  (no duplicate customers when a new customer's first cases arrive together). A case whose order could not be made gets
  `needsOrder` (internal, stripped in `jobView`) and `saveJob` tries again.
- Portal cases live in D1 (owner's choice 2026-10-26, after the team test showed KV losing customer messages / files when two
  people saved within a minute): table `jobs` (schema v5: id, owner, designer, qc_by, stage, status, created, updated, `ver`,
  `meta` = the old KV list metadata, `doc` = the whole case JSON). `saveJob` updates `WHERE ver = ?`; 0 rows → conflict error →
  `handleJobs` runs the whole case request again on the fresh case (up to 6 times, then 409). Work that must not run twice
  (payment page, AI calls) goes through `memo`. Outside case requests use `updateJob(env, id, fn)`. `__ver` is a non-enumerable
  property, never in JSON. Cases the old site saved in KV are copied by `kvJobsLeft` (100 per call, lists stay complete
  meanwhile; meta `jobs_kv` = when nothing was left; re-checked once a minute for 15 minutes, then never), or one by one when
  opened (`loadJob`). The KV `job:` / `own:` copies are left as a backup of the day of the move; never write cases to KV while
  D1 is bound. Without D1 (`NO_DB=1`) cases stay in KV as before. Never turn on D1 read replication for `jobs` without the
  Sessions API. Never roll the deployment back to before 2026-10-26: that code reads cases from KV only.
  Tests: `dev/tests/move.test.mjs` (old KV cases → D1, needs a fresh server) and the team test, both in run.sh with
  `KV_RATE=1`. Settings › file storage shows `cases` (store, count, left).
- `public/_worker.js`: API. Staff/roles in KV `cfg:staff` and `cfg:roles`; owners = `ADMIN_EMAILS`.
  Every staff endpoint checks a permission (`can(...)`); `jobView` strips fields per viewer.
- Motion rules: 200–300 ms, ease-out curves, transform/opacity only, off under `prefers-reduced-motion`.
- Payments: provider success sets `pay = "check"`; only staff with `billing.edit` confirm it (`/pay/confirm`).
- The owner communicates in Vietnamese; English text shown to customers needs a Vietnamese copy for the owner.
