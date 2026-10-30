# MtaaSense

**Community infrastructure intelligence for Uganda.** Residents report potholes, damaged roads, blocked
drainage and localized flooding with a photo, a few words (or a voice note) and an optional map pin.
MtaaSense uses Meta's multimodal models to turn each report into a structured, evidence-backed record,
outlines the hazard in the photo, finds other reports that may describe the same incident, and gives
reviewers a workspace to compare evidence and consolidate reports into canonical incidents.

> Built for the Meta Global AI Developer Hackathon. MtaaSense is an independent community tool. It is not an
> official government service and is not endorsed by KCCA or any public authority. AI output is a
> preliminary review aid, never engineering or official verification.

---

## Status at a glance

| Area | State | Evidence |
|---|---|---|
| Muse Spark structured analysis (`muse-spark-1.3`, Responses API, strict JSON schema) | **Verified live** | 45+ real calls, all schema-valid — see [Evaluation](#evaluation) |
| SAM 3.1 segmentation (`sam-3.1`, streamed, official `meta-sam-parser`) | **Verified live** | Real masks rendered over photos; alignment checked visually |
| Muse Voice Transcribe (`muse-voice-transcribe-1.0`, `/v1/asr/transcribe`) | **Verified live (English, 1 synthetic clip)** | Not tested on real Ugandan speakers or Luganda |
| Model-assisted duplicate comparison (Muse Spark, two+ images) | **Verified live** | Labels restricted to backend-supplied IDs |
| Backend tests | **52 passing** | `uv run pytest` (real PostGIS, mocked Meta transport) |
| Frontend type-check, lint, production build | **Passing** | `pnpm typecheck && pnpm lint && pnpm build && pnpm build:vinext` |
| Backend Docker image | **Builds and passes `/ready`** | smoke-tested locally |
| Contabo VPS deployment | **Not deployed** | Artifacts in [`deploy/`](deploy/); the target VPS already hosts another app on ports 80/443 (see [Deploying](#deploying)) |
| Frontend on Cloudflare Workers (vinext) | **Deployed** — <https://mtaasense.mtaasense.workers.dev> | Pages load; API calls fail until the backend is deployed and the frontend is rebuilt with its URL |

---

## What it does

1. **Report** (`/report`, mobile-first): photo (camera or gallery), category or "let AI suggest",
   description, optional voice note with an editable transcript, optional location (map pin or device GPS
   after an explicit tap), review, submit. Large photos are downscaled in the browser; the uploaded file is kept
   as the original evidence. No location? The report is kept and listed as *unlocated* — we never invent
   coordinates.
2. **Analyse**: a persistent job runs Muse Spark on the photo + resident text. The structured result tags every
   observation as *visible in photo*, *stated by resident*, or both; gives a preliminary severity with rationale,
   uncertainties, missing information, a description/photo consistency check and a suggested SAM concept.
3. **Segment**: SAM 3.1 outlines the suggested concept (pothole, damaged road surface, drainage channel,
   standing water, puddle). Masks are rendered as SVG over the original photo; reviewers can toggle the
   overlay, show boxes, change opacity, and request other concepts. Results are cached per (image, concept).
4. **Match**: PostGIS retrieves nearby reports of the same hazard family within a time window, scores them on
   signals that actually exist (distance, category, trigram text similarity, time gap), and — when it helps —
   Muse Spark compares the photos. Nothing is merged automatically.
5. **Review** (`/review`): dashboard counts from the database, review queue, duplicate comparisons side by side
   (photos, overlays, mini-map, per-signal evidence, model verdict), confirm/reject/defer, category corrections,
   incident lifecycle (resolving requires a written note), reviewer notes and an append-only audit trail.
6. **Map** (`/map`): canonical incidents (filled, sized by report count) and unreviewed reports (hollow) on an
   OpenFreeMap/MapLibre map with category/status filters and an accessible list.
7. **Track** (`/track/{id}#token`): the resident's receipt page with live processing status. The receipt token is
   in the URL fragment, so it never appears in server logs.
8. **Usage** (`/admin`, admin only): estimated spend vs. budget, per-day spend, per-operation and per-model
   tables, every model call, and the latest evaluation results.

Every AI result carries its **provenance**: *Live model call*, *Cached result*, or *Demo fixture*.

---

## Architecture

```
 Browser (Next.js 16 App Router on Cloudflare Workers via vinext, React 19, Tailwind 4, MapLibre GL 6)
   │  same-origin /api/v1/*  ── next.config rewrites ──▶  NEXT_PUBLIC_API_BASE_URL
   ▼
 Caddy (HTTPS, 20 MB body limit) ─▶ FastAPI (uvicorn)        Worker (python -m app.workers.runner)
                                     │  routes → services       │  claims jobs: FOR UPDATE SKIP LOCKED
                                     │  Pydantic validation     │  analyze → segment + match
                                     ▼                          ▼
                             PostgreSQL 17 + PostGIS 3.5 (private network only)
                             reports · incidents · media · duplicate_suggestions · segmentations
                             processing_jobs · model_calls · audit_events · review_notes · users/sessions
                                     │
                       media volume (/data/media, outside any web root, HMAC-signed short-lived URLs)

 Meta Model API (https://api.meta.ai/v1) ◀── only backend/app/services/meta_client.py talks to it
   muse-spark-1.3  POST /responses (json_schema, strict)    sam-3.1  POST /responses (stream)
   muse-voice-transcribe-1.0  POST /asr/transcribe (multipart WAV)
```

Key decisions:

- **No Redis/Celery.** Jobs live in `processing_jobs`; workers claim with `SKIP LOCKED`, retry transient
  failures with backoff, and a reaper requeues jobs from dead workers. Jobs survive restarts.
- **Short transactions.** No DB transaction is held open across a model call (load → call → save).
- **Same-origin API via rewrites** keeps the reviewer session cookie first-party (cross-site cookies break in
  Safari). Public endpoints work the same way.
- **One model client** (`services/meta_client.py`) owns auth, timeouts, retries (429/500/503 honour
  `Retry-After`; read timeouts are never auto-retried because work may be billed), a per-process concurrency
  cap, the budget guard, usage capture and safe error codes.

```
backend/app
  api/            routes (reports, duplicates, incidents, overview, auth, media, admin), dependencies, serializers
  core/           config, security (Argon2, opaque sessions, HMAC media URLs), logging (JSON + request IDs), errors
  db/             SQLAlchemy 2 models, session
  schemas/        API + structured-output schemas
  services/       meta_client, analysis, segmentation, transcription, duplicate_matching, review, reports,
                  media (+storage abstraction), jobs, lifecycle, pricing, usage_tracking, rate_limit, fixtures
  workers/        runner
backend/alembic   migrations        backend/tests   pytest suite        backend/eval   evaluation harness
backend/seed      sample images, attribution, seed + fixture scripts
frontend/src      app routes, components (ui, map, review, report, admin), lib (typed API client, hooks)
deploy/           docker-compose.prod.yml, Caddyfile, backup.sh, restore.sh, .env.production.example
```

---

## Running locally

Prerequisites: Docker, [uv](https://docs.astral.sh/uv/) (Python 3.12 is installed by uv), Node 20+ with pnpm, ffmpeg.

```bash
# 1. Database (PostGIS on localhost:5433)
docker compose up -d db

# 2. Backend
cd backend
cp .env.example .env          # then set MODEL_API_KEY and a random SECRET_KEY
uv sync
uv run alembic upgrade head
MTAA_NEW_USER_PASSWORD='choose-a-long-password' uv run python -m app.cli create-user \
  --email reviewer@example.org --name "Reviewer" --role reviewer      # or --role admin
uv run uvicorn app.main:app --port 8000 --reload --reload-dir app     # API  → http://localhost:8000/docs
uv run python -m app.workers.runner                                   # worker (separate terminal)

# 3. Frontend
cd ../frontend
cp .env.example .env.local     # NEXT_PUBLIC_API_BASE_URL=http://localhost:8000
pnpm install
pnpm dev                       # → http://localhost:3000
```

`docker compose --profile app up` runs DB + API + worker in containers instead.

### Configuring the Meta API key

Set `MODEL_API_KEY` in `backend/.env` (local) or `deploy/.env.production` (server). It is read only by the
backend and never sent to the browser. Without it, reports are still accepted and reviewable; AI panels show
"AI unavailable" and matching runs on resident-provided data only. `GET /ready` reports
`model_api: configured|not_configured`.

### Seeding demo data

```bash
cd backend
uv run python seed/fetch_images.py                 # only if seed/images is missing (Wikimedia Commons)
uv run python -m seed.seed_demo                    # 13 sample reports; the worker analyses them live (~$0.15)
uv run python -m seed.seed_demo --confirm-incidents  # optional: confirm 4 samples as incidents
uv run python -m seed.export_fixtures              # optional: record results for fallback mode
uv run python -m seed.seed_demo --reset            # remove all sample data
```

Seeded records are `is_sample=true` and badged **Sample data** everywhere. Ugandan photos use approximate
locations from their Commons descriptions; photos taken elsewhere use *illustrative* Kampala locations and say
so in their landmark note. Image licences: [`backend/seed/images/ATTRIBUTION.md`](backend/seed/images/ATTRIBUTION.md).

**Fallback mode:** with `DEMO_FIXTURES_ENABLED=true`, *sample* reports fall back to recorded fixture results if the
live API is unavailable. Fixture results are labelled "Demo fixture" in the UI and recorded with provenance
`fixture`; real submissions never receive fixture output, and authorization is unchanged.

---

## Configuration

Backend (`backend/.env`, see [`.env.example`](backend/.env.example)):

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | `postgresql+psycopg://…` |
| `MODEL_API_KEY` | Meta Model API key (server-side only) |
| `ANALYSIS_MODEL`, `SEGMENTATION_MODEL`, `TRANSCRIPTION_MODEL` | default `muse-spark-1.3`, `sam-3.1`, `muse-voice-transcribe-1.0` |
| `ANALYSIS_REASONING_EFFORT` | default `low` |
| `MODEL_DAILY_BUDGET_USD`, `MODEL_TOTAL_BUDGET_USD` | hard stop for model calls (estimated spend) |
| `AUTO_SEGMENT_AFTER_ANALYSIS`, `DUPLICATE_MODEL_ASSIST` | optional model steps |
| `DEMO_FIXTURES_ENABLED` | labelled fallback for sample reports |
| `MEDIA_STORAGE_PATH` | persistent media directory |
| `SECRET_KEY` | signs media URLs, receipts, fingerprints (required in production) |
| `CORS_ORIGINS` | allowed frontend origins (also used for the cookie-write Origin check) |
| `COOKIE_SECURE` | `true` in production (enforced) |
| `TRUSTED_PROXY_HOPS` | how many X-Forwarded-For hops to trust for per-client rate limits |
| `REPORT_RATE_LIMIT_PER_HOUR`, `PUBLIC_GLOBAL_RATE_LIMIT_PER_HOUR` | abuse protection |

Frontend (`frontend/.env.local`): `NEXT_PUBLIC_API_BASE_URL` (public API base URL; used for the rewrite),
optional `NEXT_PUBLIC_MAP_STYLE_URL` (default OpenFreeMap Positron — free, keyless, OSM attribution shown on the map).

---

## API

Versioned under `/api/v1`; OpenAPI at `/openapi.json` (Swagger UI at `/docs` outside production).
Errors are always `{"error": {"code", "message", "request_id"}}`.

| Method & path | Access | Purpose |
|---|---|---|
| `POST /reports` (multipart, `Idempotency-Key`) | public, rate-limited | Submit a report |
| `POST /transcriptions` (multipart) | public, rate-limited | Transcribe a voice note before submitting |
| `GET /reports/{id}` | reviewer, or `X-Report-Token` receipt | Report detail with analysis, segmentations |
| `POST /reports/{id}/segment` `{prompt}` | reviewer or receipt | Queue (or return cached) SAM segmentation |
| `GET /reports` | reviewer | List/filter/paginate reports |
| `POST /reports/{id}/analyze` · `/match` · `/transcribe` | reviewer | Re-run analysis / matching / transcription |
| `POST /reports/{id}/review` `{confirm_incident\|reject\|reopen}` | reviewer | Review decision |
| `PATCH /reports/{id}` `{reviewer_category}` | reviewer | Correct category (audited) |
| `GET /reports/{id}/duplicates` | reviewer | Suggestions for a report |
| `GET /duplicate-suggestions` · `/{id}` | reviewer | Duplicate queue / detail |
| `POST /duplicate-suggestions/{id}/decision` `{confirm\|reject\|defer}` | reviewer | Decide a pair |
| `GET /incidents` · `/{id}` | public (reports only for reviewers) | Incidents |
| `PATCH /incidents/{id}` | reviewer | Status (resolve needs a note), title, priority, severity, category |
| `GET/POST /reports/{id}/notes`, `/incidents/{id}/notes`; `GET …/audit` | reviewer | Notes and audit history |
| `GET /map/features`, `GET /stats`, `GET /config` | public | Map data (no photos or text), counts, client config |
| `GET /review/summary` | reviewer | Dashboard counts |
| `GET /jobs/{id}` | reviewer or receipt | Job status |
| `GET /media/{id}?exp&sig` | signed URL | Private media (URLs minted only for authorised viewers) |
| `POST /auth/login` · `/logout`, `GET /auth/session` | — | Reviewer sessions |
| `GET /admin/usage`, `GET /admin/evaluation` | admin | Model usage and evaluation |
| `GET /health`, `GET /ready` | — | Liveness / readiness (DB, migrations, media, model config) |

### Status lifecycle (enforced in `services/lifecycle.py`)

```
report:   submitted → processing → under_review → confirmed | duplicate | rejected
          processing → processing_failed → (processing | under_review | confirmed | duplicate | rejected)
          confirmed | duplicate → resolved (via incident)      resolved → confirmed | duplicate (reopen)
          rejected → under_review (reopen)
incident: confirmed ⇄ resolved   (resolving requires a reviewer's written note; AI never resolves)
```

### Duplicate matching

Retrieval (SQL): other reports in a matchable state, same hazard *family* (road: pothole/road surface damage;
drainage: blocked drainage/flooding), created within ±45 days, and either within 150 m (`ST_DWithin` on
`geography(Point,4326)`, GiST-indexed) or — if a location is missing — with clearly similar wording
(`pg_trgm`). Up to 25 are retrieved.

Score = weighted mean over the signals that exist: location 0.40 (1 − d/150 m), category 0.20 (same 1.0, same
family 0.6), text 0.25 (best of resident-text and AI-summary trigram similarity, saturating at 0.5), time 0.15.
Without a location the score is multiplied by 0.8. Suggestions ≥ 0.45 are stored with every signal. For the top
3, Muse Spark compares the photos; candidates are given opaque labels `C1…C3` constrained by a JSON-schema enum,
and any label not in the list sent is discarded. Reviewer decisions are never overwritten by re-matching.

---

## Security & privacy

- Reviewer/admin auth: Argon2 password hashes (`pwdlib`), opaque random session tokens (only SHA-256 hashes stored),
  8-hour expiry, server-side revocation on logout, `HttpOnly; SameSite=Lax; Secure` cookie, plus an Origin check on
  cookie-authenticated writes. Roles come only from the server-side session.
- Residents need no account; a receipt token (hash stored) grants access to their own report only.
- Media is private: stored outside the web root under server-generated keys, served only via HMAC-signed URLs
  (15 min) minted for authorised viewers. The display copy is EXIF-stripped; the original upload is preserved as
  evidence. File types are sniffed from bytes (Pillow / magic numbers + ffmpeg), sizes and pixel counts are capped.
- Public map shows only category, status and location — never photos or resident text.
- Rate limits are DB-backed (per client fingerprint — a keyed hash, raw IPs are never stored — plus a global
  backstop). Request IDs on every response; JSON logs redact credential-like fields.
- Prompt-injection hygiene: resident text is wrapped in tags and declared as data; segmentation prompts are restricted
  to a fixed list; model-returned IDs are validated against what we sent.
- Production: Postgres is only on the internal Docker network; only Caddy publishes 80/443; `SECRET_KEY` and
  `COOKIE_SECURE=true` are enforced at startup; API docs are disabled.

---

## Protecting the API budget

- Every request attempt is a `model_calls` row: model, endpoint, latency, provider usage tokens, image count, audio
  duration, HTTP status, error code, provenance and **estimated** cost from the official price list
  (`services/pricing.py`, retrieved 2026-10-29). Estimates are not the account balance.
- `MODEL_DAILY_BUDGET_USD` / `MODEL_TOTAL_BUDGET_USD` stop new calls when reached.
- Standard (not Contributor) Muse Spark mode is used deliberately: Contributor mode is cheaper but may use content
  for training, which is inappropriate for residents' photos.
- `store: false` on every Responses request; images are downscaled (1280 px for analysis); reasoning effort `low`.
- Caching: identical (image, text, prompt version, model) analyses are reused (labelled *Cached result*);
  segmentations are cached per (image, concept); duplicate jobs are deduplicated while active.
- Segmentation and transcription run only when needed (one auto-segmentation per analysed hazard photo).

---

## Testing

```bash
cd backend
docker compose -f ../docker-compose.yml exec db psql -U mtaasense -c "CREATE DATABASE mtaasense_test"   # once
uv run pytest            # 52 tests
uv run ruff check . && uv run mypy app      # lint + strict typing
cd ../frontend && pnpm typecheck && pnpm lint && pnpm build
```

The suite runs against a real PostGIS database with the Meta API replaced by an `httpx.MockTransport`. It covers
report intake and validation (non-image upload, tiny image, missing text, out-of-area location, idempotent retry),
receipt-token access, signed media URLs (tampered/expired), EXIF stripping, login/session/revocation, role checks,
the cross-origin write guard, structured-output validation (malformed → retried once → failure kept reviewable;
refusal; extra fields rejected), 429 retry with `Retry-After`, no retry on 401 or read timeout, budget exhaustion,
analysis caching, SAM stream parsing (real sample output) and empty results, segmentation caching and failure
isolation, PostGIS candidate retrieval (near/far/different family/unlocated), model label validation, duplicate
confirm/reject/defer, incident resolve/reopen rules, category-correction audit, job dedupe/backoff/reaping, status
transition enforcement, rate limiting, and fixture fallback (samples only, labelled).

## Evaluation

Run with `uv run python -m eval.run_eval` (live calls, ≈ $0.20). Results below are from the run on
2026-10-30 (`muse-spark-1.3`, reasoning effort `low`, `sam-3.1`); raw outputs are written to `eval/runs/` and the
summary to [`eval/results/summary.json`](backend/eval/results/summary.json), which the admin page also shows.
**Sample sizes are small; treat these as indicative, not statistically robust.**

**Structured analysis — 17 labelled cases** (13 clear/ambiguous hazards, 1 irrelevant photo, 2 conflicting
descriptions, 1 synthetically blurred and darkened photo):

| Metric | Result |
|---|---|
| Schema-valid structured output | 17/17 |
| Category within the labelled acceptable set | 17/17 (ambiguous cases accept more than one label) |
| Hazard recall (photo shows a hazard → `is_infrastructure_hazard`) | 14/15 — the miss is the blurred/dark photo, returned as `unclear`, image quality `poor`, confidence `low` |
| Non-hazard rejection (food photo, with and without a pothole description) | 2/2 |
| Description/photo conflict flagged | 2/2 (`inconsistent`, `partially_consistent`) |
| Latency | median 6.6 s, max 9.3 s |
| Estimated cost | $0.112 for 17 calls |

**SAM 3.1 — 12 hazard photos with a tested concept:** 12/12 requests succeeded and returned ≥1 region;
the frame size SAM reported matched the input image on 12/12 (overlay alignment). Mask quality is not scored
(no ground-truth masks). Concept phrasing matters: on the same three drainage photos "blocked drain" returned
0 regions while "drainage channel" returned regions with confidence 0.60–0.94.

**Duplicate visual comparison — 4 labelled pairs** (photos only; descriptions and distances withheld):
precision for "same incident" 2/3, recall 2/2. The false positive is two different potholes on the same road
photographed in similar conditions (`possibly_same`). In the full pipeline — with distance and wording — the same
comparison was judged `likely_different`, and the true pair `likely_same` (score 0.94, 18 m apart).

Live pipeline observations (13 seeded samples + test submissions): every analysis call returned schema-valid
output (0 malformed); the mismatched sample (food photo described as a pothole) was flagged as not a hazard and
inconsistent; no SAM call was made for it.

**Not yet evaluated:** transcription accuracy on real Ugandan speakers or in Luganda (only one synthetic
English clip, transcribed correctly); deterministic duplicate retrieval on real report volumes; segmentation
IoU; severity calibration.

---

## Deploying

### Backend on the Contabo VPS

Inspect the server first (`uname -a; free -h; df -h; docker ps; sudo ss -tlnp; sudo ufw status`) and do not reuse
ports or directories that other services own.

```bash
# On the VPS (Ubuntu/Debian with Docker Engine + compose plugin)
sudo mkdir -p /opt/mtaasense && sudo chown "$USER" /opt/mtaasense
git clone <this repo> /opt/mtaasense && cd /opt/mtaasense/deploy
cp .env.production.example .env.production && chmod 600 .env.production
#   set API_DOMAIN (DNS A/AAAA record → VPS), ACME_EMAIL, POSTGRES_PASSWORD, SECRET_KEY, MODEL_API_KEY,
#   CORS_ORIGINS=https://<your-frontend-domain>
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
docker compose -f docker-compose.prod.yml --env-file .env.production exec -e MTAA_NEW_USER_PASSWORD='…' api \
  python -m app.cli create-user --email you@example.org --name "Admin" --role admin
curl -fsS https://$API_DOMAIN/ready

# Firewall: only SSH + HTTP(S)
sudo ufw allow OpenSSH && sudo ufw allow 80,443/tcp && sudo ufw allow 443/udp && sudo ufw enable
```

Note: Docker publishes ports by editing iptables directly, bypassing ufw — that is why only Caddy publishes ports
and Postgres has none. Logs: `docker compose -f docker-compose.prod.yml logs -f api worker caddy` (JSON, with
request IDs). Updates: `git pull && docker compose … up -d --build` (migrations run in the one-shot `migrate`
service before the API starts).

### Backups

`deploy/backup.sh` writes a verified `pg_dump -Fc` and a media tarball to `/var/backups/mtaasense`, keeping 14 days.
Schedule it (`15 2 * * * /opt/mtaasense/deploy/backup.sh >> /var/log/mtaasense-backup.log 2>&1`) and copy the
directory off the server. Restore with `deploy/restore.sh <db.dump> <media.tar.gz>` (asks for confirmation, stops
API/worker, restores, restarts). Test a restore on a scratch machine before relying on it.

### Frontend on Cloudflare Workers

The frontend is a normal Next.js app that also builds with [vinext](https://github.com/cloudflare/vinext)
(Cloudflare's Vite-based implementation of the Next.js API) and runs as a Worker. `next.config.ts` stays the single
source for rewrites and headers; `vite.config.ts` and `cloudflare.config.ts` hold the Workers setup.

```bash
cd frontend
npx cf auth login                                      # once, opens a device-code login
NEXT_PUBLIC_API_BASE_URL=https://<API_DOMAIN> pnpm deploy:vinext
```

The API base URL is baked into the `/api/v1/*` rewrite at build time, so redeploy whenever it changes. Then add the
frontend origin (e.g. `https://mtaasense.mtaasense.workers.dev`) to `CORS_ORIGINS` on the server and restart the API
— cookie-authenticated writes from any other origin are refused. `pnpm dev:vinext` runs the Workers build locally
on port 3001 (inside `workerd`); `pnpm dev` is still the plain Next.js dev server.

### Continuous integration and deployment

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs on every push and pull request:

- **Backend:** ruff (lint + format), mypy strict, the pytest suite against a PostGIS service container, and
  `alembic check` (migrations match the models).
- **Frontend:** typecheck, lint, the Next.js build and the vinext/Workers build.
- **Deploy frontend:** on pushes to `main` (or *Run workflow* on `main` in the Actions tab), after both check jobs
  pass, builds and deploys to Cloudflare Workers.
  Only this job receives secrets, so pull requests from forks cannot read them.

Repository settings it uses:

| Name | Kind | Value |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | secret | Account API token with **Workers Scripts: Edit** (dashboard → Manage account → API tokens) |
| `NEXT_PUBLIC_API_BASE_URL` | variable | `https://<API_DOMAIN>` once the backend is deployed |

The account ID is set in `frontend/cloudflare.config.ts` (it identifies the account; it is not a credential).

Without `CLOUDFLARE_API_TOKEN` the deploy job skips itself with a warning. The backend is not deployed by CI yet.

---

## Demo script (≈4 minutes)

Prep: seed samples, run the worker, `--confirm-incidents`, sign in as a reviewer in one window; keep
`backend/seed/images/namanve-flood-b.jpg` and `r36-pothole-b.jpg` on the phone/laptop.

1. **Home → Report a hazard.** Upload `r36-pothole-b.jpg`, type "Pothole and broken edge on the road",
   choose Pothole, and on the location step tap right next to the faint pothole dot in the Ntinda area (the
   picker shows already-reported hazards; the matching sample sits at 0.35400, 32.61200), then submit.
2. **Tracking page:** watch Received → AI analysis (Muse Spark) → Segmentation (SAM 3.1) complete live; point out
   observations tagged *visible in photo* vs *stated by resident*, the uncertainties, and the mask.
3. **Review workspace → the new report:** toggle *Show original* / overlay; try another concept.
4. **Possible duplicates:** two candidates appear — the same pothole photographed from another angle and a
   different pothole ~90 m away. Open the comparison: distance bar, wording/time signals, and Muse Spark's visual
   comparison for each. Confirm the true duplicate; mark the other as different.
5. **Incident page:** both reports linked, each with its own evidence; audit trail shows every decision.
6. **Map:** the incident appears as a filled marker; unreviewed reports are hollow.
7. **Usage:** real per-call costs and the evaluation summary.

---

## Limitations and honest notes

- The frontend is deployed on Cloudflare Workers; the backend is not deployed yet, so the live frontend cannot load
  data. Backend deployment artifacts are tested only locally (image builds, compose config validates).
- vinext is not bug-for-bug Next.js; the app was verified on it (all routes, reviewer login, map, a full resident
  submission through the Worker's API proxy), and Next's partial prerendering (`cacheComponents`) is turned off
  because vinext does not support it.
- Voice transcription is verified on one synthetic English clip; Luganda and other local languages are untested.
- Evaluation sets are small (see sample sizes above); metrics are indicative, not statistically robust.
- Segmentation quality is not measured against ground-truth masks; SAM is sensitive to phrasing ("blocked drain"
  found nothing where "drainage channel" did), so concepts are a fixed, tested list.
- Duplicate scoring weights are hand-set and not tuned on real data.
- Several sample photos are from outside Uganda (Commons has no openly licensed Ugandan pothole photos); they are
  shown at illustrative locations and labelled.
- Per-client rate limits depend on proxy headers that can be spoofed; the global cap and budget guard are the
  backstops.
- Single worker by default (keeps spend predictable); add worker replicas if volume grows.

## Credits

Sample photos: Wikimedia Commons contributors under CC BY / CC BY-SA licences — see
[`ATTRIBUTION.md`](backend/seed/images/ATTRIBUTION.md). Home-page reel: public-domain Voice of America news
footage and Wikimedia Commons contributors (CC0, CC BY-SA), cut with Remotion in [`hero-reel/`](hero-reel/);
the reel is CC BY-SA 4.0 — see [`hero-reel/ATTRIBUTION.md`](hero-reel/ATTRIBUTION.md). Map tiles: OpenFreeMap;
map data © OpenStreetMap contributors. SAM output parsing: Meta's `meta-sam-parser` (SAM License).
