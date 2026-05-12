# Syphilis 2026 DIS Case Definition Assessment

Production-ready Netlify app for the 20-question, 26-point DIS competency assessment.
Server-side scoring, per-domain analytics, supervisor dashboard with Chart.js, write-in
rubric scoring with flagged-review queue, CSV export, and email reporting via Resend.

## Layout

```
syphilis-dis-app/
├── public/                          # Static site (publish root)
│   ├── index.html                   # Tester-facing assessment
│   ├── questions.json               # PUBLIC bank — answers/rubrics stripped
│   └── admin/
│       └── dashboard.html           # Charts, rankings, alerts, flagged reviews
├── netlify/
│   └── functions/
│       ├── _questions.json          # PRIVATE source-of-truth (answers + rubrics)
│       ├── submit.js                # Server-side grading + storage + email
│       ├── analytics.js             # Aggregated metrics (secret-protected)
│       └── submissions.js           # Raw submissions + CSV export (secret-protected)
├── scripts/
│   └── build-questions.js           # Strips _questions.json -> public/questions.json
├── data/
│   └── submissions.json             # Local-dev fallback store
├── netlify.toml
└── package.json
```

## How it ties together

1. Build step (`npm run build`) generates `public/questions.json` (no answers) from
   `netlify/functions/_questions.json` (with answers + rubrics).
2. Tester opens `/?token=<id>` → answers 20 questions (MC, multi-select, write-in)
   → `POST /.netlify/functions/submit` with raw responses.
3. **`submit.js` grades server-side** so the answer key never reaches the browser:
   - MC: exact match against `correct`
   - Multi-select Q18: full credit for both correct picks with no wrong picks; 1 pt partial for either alone
   - Write-ins: keyword-group rubric — full credit if all groups matched, half credit if any matched, always flagged for supervisor review
4. Record (token, earned/max/pct, band, per-domain stats, item-level breakdown, flagged IDs, timestamp)
   is written to **Netlify Blobs** in production / `data/submissions.json` in dev.
5. Console logs an `EMAIL REPORT` block; if `RESEND_API_KEY` + `REPORT_EMAIL_TO` are set,
   sends a real HTML email via Resend.
6. Supervisor opens `/admin/dashboard.html`, enters the shared secret once (cached in
   `sessionStorage`), and sees: program KPIs, threshold-band doughnut, domain mastery bar,
   submission timeline, ranked tester table, question-difficulty ranking, write-in review queue,
   one-click CSV export.

## Proficiency thresholds (per training spec)

| Band | Score | Treatment |
|---|---|---|
| Proficient | **≥85%** | No action needed |
| Needs reinforcement | **70–84%** | Targeted refresher |
| Needs retraining | **<70%** | Full re-training required |

## Required Netlify environment variables

| Var | Purpose | Required? |
|---|---|---|
| `ADMIN_SECRET` | Shared secret for `/admin/*` and `/.netlify/functions/{analytics,submissions}` | **Yes** for prod (gates dashboard) |
| `RESEND_API_KEY` | Resend API key for email reports | Optional — falls back to console log |
| `REPORT_EMAIL_TO` | Comma-separated recipient list (supervisors) | Required if Resend is enabled |
| `REPORT_EMAIL_FROM` | Verified Resend sender (defaults to `onboarding@resend.dev` for testing) | Optional |
| `ALLOWED_TOKENS` | Comma-separated allowlist of tester tokens. If unset, any token is accepted. | Optional |

Set these in Netlify dashboard → Site → Environment variables. Distribute `ADMIN_SECRET`
out-of-band to the 3+ program supervisors who need dashboard access.

## Local dev

```bash
npm install
npm run dev          # builds public/questions.json then runs `netlify dev`
```

If `ADMIN_SECRET` is unset locally, the dashboard endpoints accept any secret (dev mode).

## Deploy

```bash
npm run deploy       # builds + `netlify deploy --prod`
```

## Storage notes

- **Production:** Netlify Blobs (free tier covers thousands of submissions, zero setup beyond
  the bundled `@netlify/blobs` dep).
- **Local dev:** falls back to `data/submissions.json`.
- The Lambda filesystem is read-only on Netlify, so the file fallback only works in `netlify dev`.
- If you ever outgrow Blobs, swap `appendRecord` / `loadSubmissions` in the two functions to point
  at Supabase (free Postgres) — both functions share the same record shape.

## Security model

- The full answer key + rubrics live only in `netlify/functions/_questions.json` (bundled into
  Lambda, never served as a static asset).
- The build step regenerates the public file every deploy — keep edits in `_questions.json`,
  never edit `public/questions.json` directly.
- Dashboard endpoints reject requests without the correct `x-admin-secret` header.
- `/admin/*` is marked `noindex, nofollow` via response headers.
- Tokens are free-form by default. Set `ALLOWED_TOKENS` to restrict who can submit
  (see "Token allowlist" section below).
- One-attempt-only: `submit.js` rejects with HTTP 409 if a token already has a submission.
  A supervisor can call `POST /.netlify/functions/reset-token` (with `x-admin-secret`) or click
  the **Reset** button on the dashboard rankings table to archive a prior attempt and let the
  tester retake after additional training.

## Token allowlist (optional)

When `ALLOWED_TOKENS` is set, `submit.js` rejects any tester whose token is not in the list.
The list is a single comma-separated string in the Netlify environment variable.

**Example:**

```
ALLOWED_TOKENS=dis-jane-doe,dis-john-smith,dis-aisha-r,dis-marcus-l,dis-priya-k
```

Distribute tokenized links to your team:

```
https://your-site.netlify.app/?token=dis-jane-doe
https://your-site.netlify.app/?token=dis-john-smith
https://your-site.netlify.app/?token=dis-aisha-r
```

Behavior:
- Token in the list → submission accepted.
- Token not in the list → HTTP 403 (`token_not_allowed`).
- Token has already submitted → HTTP 409 (`already_submitted`); the tester sees an
  "Assessment already submitted" screen.
- Supervisor clicks **Reset** in the dashboard → previous attempt is renamed
  (`<token>__archived_<timestamp>`) and kept for the audit trail; tester is unblocked.

When `ALLOWED_TOKENS` is unset (current default), any token string is accepted — useful
during pilot testing.
