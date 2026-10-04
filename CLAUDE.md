# CLAUDE.md

Guidance for Claude Code working in this repository.

---

## 1. Rules of engagement

### Never deploy without asking for that specific deploy

Build it, test it, verify it — then **stop and ask**. Wait for a yes.

- One approval covers **one** deploy. It never carries forward, not even to the
  next change minutes later in the same session.
- Being given the deploy commands is **not** permission to run them.
- An unanswered "shall I deploy?" is a **no**. If the reply is a new task
  instead of an answer, the question is still open — do not assume consent.
- Making a change and shipping it are separate steps. Several changes may want
  to be batched into one deploy — that is the user's call, not Claude's.

This applies to anything user-facing: S3/CloudFront, the EC2 backend, sending
real email, and writes to the production databases.


### Flag knock-on effects

Product rules here interact. A change to a size list can silently empty a
dropdown elsewhere. Say so explicitly rather than letting it be discovered in
production.

---

## 2. What this is

**UniVicoustic configurator** — a web configurator for acoustic wall panels at
`configurator.univicoustic.com`. Users pick a product, surface, size, thickness,
colour and pattern, and get a live wall preview they can download.

---

## 3. Architecture

| Piece | Stack | Where it lives |
|---|---|---|
| Frontend | React 19, CRA via **CRACO**, Tailwind + shadcn/ui, vanilla three.js | `frontend/` |
| Backend | FastAPI + SQLite (`analytics.db`, `auth.db`) | `backend/` |
| Hosting (frontend) | S3 `univicoustic-frontend` → CloudFront `E2IM7ENU181X52` | — |
| Hosting (backend) | EC2 `13.200.172.178`, systemd `univicoustic-backend`, nginx | — |
| Panel images | S3 `univicoustic-assets` → CloudFront `EM4CCSPNL02GH` (`d27tzvhakjjy0q.cloudfront.net`) | — |

No CI. No Docker. Deploys are manual (see §6).

---

## 4. The files that matter

### `frontend/src/data/skus.js`
**Source of truth for product data.** Colours, sizes, thicknesses, emboss and
groove patterns, and the URL builders for panel textures.

Most product-rule changes are a **data edit here**, not new logic. Prefer that.

### `frontend/src/pages/Configurator.jsx`
The main component (~5,900 lines). Holds all configurator state, the surface
tabs, every selector, deep-link hydration and the download flow.

### `frontend/src/components/FlatEmbossedPreview.jsx`
Renders the wall for wood, fabrics, ombre and VMD. Layered stack:
panel columns → T-Patti → emboss overlay → furniture. Also owns the
download/capture path (`html-to-image`).

### `backend/server.py`
API + the analytics dashboard (server-rendered HTML).

### `backend/auth.py`
OTP signup, email-only login, JWT. Env-driven: `OTP_ENABLED`,
`SIGNUP_NOTIFY_TO`.

---

## 5. Conventions that already exist — follow them

**Product rules live in data.** Patterns carry `availableSizes` and
`excludedThicknesses`; dropdowns are built by unioning those. Add a field rather
than a special case where possible.

**Every restriction needs a guard effect.** Hiding an option is not enough — the
user can select it first and change the other field after, stranding an invalid
combo with no tile on screen to clear it. Watch both values in a `useEffect` and
clear the stale one. This also covers restored tabs, saved favourites and deep
links in one place. See the thickness and size guards in `Configurator.jsx`.

**Never mutate the live DOM during a capture.** The download is async; visible
mutation flashes the real preview at the user. Use `html-to-image`'s `filter`
option to exclude nodes from the internal clone instead.

**Blob URLs for panel images.** `use-blob-panel.js` keeps exactly one decoded
full-resolution image in memory, pre-decodes before swapping, and revokes the
old URL only once the new one is ready.

**LF line endings for anything copied to the server.** Windows CRLF breaks the
Python files: `tr -d '\r' < file.py > file.lf` before `scp`.

---

## 6. Deploy runbook — ASK FIRST (see §1)

### Frontend
```bash
cd frontend && npm run build
aws s3 cp build/index.html s3://univicoustic-frontend/index.html --cache-control "no-cache, no-store, must-revalidate" --content-type "text/html"
aws s3 sync build/ s3://univicoustic-frontend/ --exclude "index.html" --cache-control "public, max-age=31536000, immutable"
aws cloudfront create-invalidation --distribution-id E2IM7ENU181X52 --paths "/*"
```
`index.html` must stay `no-cache`; hashed assets are immutable for a year.

### Backend
SSH only — not SSM-managed. Key at
`D:\varun\projects\HELPER\server-keys\univicoustic-backend.pem`, user `ec2-user`.

```bash
scp -i <key> file.py ec2-user@13.200.172.178:~/backend/
ssh -i <key> ec2-user@13.200.172.178 "sudo systemctl restart univicoustic-backend"
```
Back up the file being replaced and syntax-check it **before** restarting. The
server has its own `~/backend/.env`, separate from the committed one — check
there, not locally, for what production is actually running.

---

## 7. Verify before claiming it works

There is no test suite. Before reporting a change as done:

- Run `npm run build` — it catches JSX and import errors.
- Write a throwaway script that parses `skus.js` (or stubs the module) and
  asserts the new rule across every case, including the ones that should be
  unaffected. Put it in the scratchpad, not the repo.
- Say plainly what was verified and what was not. If something could not be
  checked — a Safari-only bug, a real email landing in an inbox — say so and ask
  the user to confirm rather than implying it was tested.
