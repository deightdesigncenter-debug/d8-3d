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
- `public/_worker.js`: API. Staff/roles in KV `cfg:staff` and `cfg:roles`; owners = `ADMIN_EMAILS`.
  Every staff endpoint checks a permission (`can(...)`); `jobView` strips fields per viewer.
- Motion rules: 200–300 ms, ease-out curves, transform/opacity only, off under `prefers-reduced-motion`.
- Payments: provider success sets `pay = "check"`; only staff with `billing.edit` confirm it (`/pay/confirm`).
- The owner communicates in Vietnamese; English text shown to customers needs a Vietnamese copy for the owner.
