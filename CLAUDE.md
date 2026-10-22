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
  import, settings), `public/snap.js` (3D link preview snapshot), `public/xlsx.js` (Excel read/write in the browser).
- Order book (D1, schema auto-created and migrated: `SCHEMA_V1`, `SCHEMA_V2`): codes `yymmddxx` (26102101 = stage 1),
  next stage `C2`, `C3`…, redo `R1`, `R2`…, redo then next stage `R1C2` (owner's rules; old `26/10/21/01` is normalised). Free-plan D1
  limits: ≤50 queries per request, ≤100 bound params per query — bulk writes go through `json_each(?)`. The local D1
  mock (`dev/server.mjs`, node:sqlite) counts queries; `NO_DB=1` runs without it. `orderOut` strips money unless
  `billing.view`, tech cost unless `techpay.*`; KTVs never see prices.
- A D1 binding under another name than `DB` is picked up too (`withDb`, found by the methods on its prototype chain — never
  by reading properties, because service bindings like `ASSETS` answer any property as an RPC stub); `/api/book/status`
  lists the bindings (staff.manage only). Local: `DB_AS=name` binds the mock that way; the mock `ASSETS` behaves like an RPC stub.
- Settings KV `cfg:settings`: `onlinePay` and `autoTrial` are OFF by default (owner's choice).
- `public/_worker.js`: API. Staff/roles in KV `cfg:staff` and `cfg:roles`; owners = `ADMIN_EMAILS`.
  Every staff endpoint checks a permission (`can(...)`); `jobView` strips fields per viewer.
- Motion rules: 200–300 ms, ease-out curves, transform/opacity only, off under `prefers-reduced-motion`.
- Payments: provider success sets `pay = "check"`; only staff with `billing.edit` confirm it (`/pay/confirm`).
- The owner communicates in Vietnamese; English text shown to customers needs a Vietnamese copy for the owner.
