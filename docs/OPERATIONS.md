# OPERATIONS.md — running the hosted demo

Everything an operator needs when the demo is misbehaving, written for the
person on call at the time, which is one person.

The deployment is one Railway service (`handrail`) plus one managed Postgres, in
one project. One image serves both roles; `SERVICE_ROLE` decides which.

---

## 1. Is it broken?

Two endpoints, two different questions. Ask them in this order.

| Endpoint | Question | If it fails |
| --- | --- | --- |
| `GET /healthz` | Is the process alive? | The container is down or wedged. Check Railway's deployment status. |
| `GET /readyz` | **Can a scan actually run?** | The body names the failing check. Read §2. |

```bash
curl -s https://<host>/readyz | jq
```

`/readyz` proves Postgres *with its migrations applied*, the queue, and a real
Chromium launch. "The container is up" and "a scan can run" are different
claims, and only the second one matters to a visitor.

**A green `/readyz` is not proof the demo works.** A deployment with no worker
passes every probe and never finishes a scan — that is exactly the failure the
smoke gate exists for, and it has been observed on this deployment on purpose
(§5). When in doubt, run the smoke:

```bash
pnpm --filter @handrail/server smoke https://<host>
```

---

## 2. Reading `/readyz`

```json
{ "ready": false, "checks": [{ "name": "chromium", "ok": false, "detail": "…" }] }
```

| Check | What it means when it fails | First move |
| --- | --- | --- |
| `postgres` | The database is unreachable, or the migrations have not run. `connected, schema present` requires both. | Check the Postgres service in Railway. If it is up, the pre-deploy migration failed — see the deploy logs. |
| `queue` | pg-boss cannot reach its schema. Almost always the same cause as `postgres`. | As above. |
| `chromium` | The browser will not launch: a bad image, a wrong `PLAYWRIGHT_BROWSERS_PATH`, or the container is out of memory. | Check the deploy logs and the service's memory graph. |
| `object-storage` | The R2 bucket is unreachable or the credentials are wrong. Scans will still complete — and every report they produce will have no evidence images. | Check the four `R2_*` service variables against Cloudflare, then §8. |

`object-storage` is only present when R2 is configured. A deployment with no
object storage is **ready**: it takes no screenshots, warns about it at boot,
and says so here by the check's absence. A deployment that was told where its
bucket is and cannot reach it is **not** ready, because the reports it produces
would be missing the evidence they exist to carry.

Every check runs even after one fails, so the response is the whole picture
rather than the first thing to go wrong.

---

## 3. Deploying

`deploy.yml` runs on `main` **only after CI is green**, and does three things in
order:

1. **Migrations** — Railway's `preDeployCommand` (`railway.json`), so they run
   once, inside the platform, before the new container takes traffic. Never on
   boot: two containers starting together would race through the same DDL.
2. **Deploy** — `railway up`. Railway holds the new container until `/readyz`
   passes and keeps the old one serving until it does.
3. **Post-deploy smoke** — polls `/readyz`, submits a scan of the deployment's
   own landing page, waits for it, and validates the report against
   `@handrail/schemas`.

A manual deploy from a laptop, when that is what is called for:

```bash
railway up --service handrail --ci
```

### What the pipeline needs, once

> **As of 2026-08-01 this table is a plan, not a description.** `RAILWAY_TOKEN`
> was never added, so every `Deploy` run has failed at its first step and the
> live deployment is whatever was last pushed by hand with `railway up`.
> Tracked as [#91](https://github.com/vrajjshah/handrail/issues/91); it needs a
> credential only the repo owner can mint. Until then, deploying means the
> manual `railway up` below.

| Where | Name | Why |
| --- | --- | --- |
| Repo → Secrets → Actions | `RAILWAY_TOKEN` | A Railway **project token**, from the project's Settings → Tokens. The only secret the workflow needs. **Not set — see the note above.** |
| Repo → Secrets → Actions | `ADMIN_TOKEN` | Optional. Lets the smoke bypass the rate limit rather than spending a visitor's three-an-hour. Must match the service variable. |
| Repo → Variables → Actions | `PUBLIC_URL` | The deployment's URL, so the smoke knows what to test. |
| Railway → service variables | `DATABASE_URL` | Set as the reference `${{Postgres.DATABASE_URL}}`, never a literal — the value then never leaves the platform. |
| Railway → service variables | `ADMIN_TOKEN` | Optional; unset means nothing can bypass the rate limits, and the server says so at boot. |
| Railway → service variables | `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` | Where screenshots go. **All four or none** — a partial set fails at boot naming what is missing. See §8. |

Note what is *not* in that list: nothing R2-shaped is a GitHub secret. CI holds
no cloud credentials at all, the same way it holds no model API key, and the
`*.r2.test.ts` suite is deliberately not a CI job (§8).

---

## 4. Rollback

**Roll back first, diagnose second.** The demo is a portfolio surface, not a
service with an SLA — a broken one is worse than an old one.

### 4.1 The break came from a variable

The fastest and most common case. Revert the variable; Railway redeploys.

```bash
railway variables --service handrail --set 'SERVICE_ROLE=both'
railway deployment list --service handrail          # wait for SUCCESS
pnpm --filter @handrail/server smoke https://<host> # confirm with the gate that caught it
```

**Rehearsed for real on 2026-07-26** — see §5.

### 4.2 The break came from the code

Railway keeps every previous image. Roll back to the last good one:

- **Dashboard:** the service → Deployments → the most recent `SUCCESS` before
  the bad one → **Rollback**. This is the fastest path and needs no build.
- **From a laptop**, if the dashboard is not to hand:

  ```bash
  git checkout <last-good-sha>
  railway up --service handrail --ci
  ```

  A rebuild, so slower — but it needs nothing but the CLI. **Rehearsed for real
  on 2026-07-29** — see §5.4.

  If `railway up` is refused or unavailable, `railway deployment up` is the same
  command under the subcommand tree.

Then put the fix through the normal path: branch → PR → CI → merge. **Do not
hot-fix `main` to chase a rollback**; the deploy pipeline is gated on CI for the
same reason everything else is.

### 4.3 A migration is the problem

Drizzle migrations here are additive so far, and there are no down-migrations.
If a migration is the cause: roll the *code* back per §4.2 — an older server
against a newer schema is usually fine when the change was additive — then write
a forward migration that undoes it. Never edit a migration that has run.

---

## 5. The rehearsals

Both were performed against the live deployment on **2026-07-26**, deliberately,
because a rollback procedure nobody has executed is a document rather than a
plan.

### 5.1 A container that cannot start is never promoted

`PLAYWRIGHT_BROWSERS_PATH` was pointed at a directory with no browsers in it.

- The new deployment stayed `DEPLOYING`, then went **`FAILED`**.
- Railway's healthcheck (`/readyz`, `railway.json`) refused to promote it.
- **The previous deployment kept serving throughout.** Public `/readyz` stayed
  `200` the whole time, because the broken container never took traffic.

The lesson to keep: gating the healthcheck on `/readyz` rather than `/healthz`
is what makes this true. A liveness-only gate would have promoted it.

### 5.2 A container that starts and cannot work *is* promoted — and the smoke catches it

`SERVICE_ROLE=api`, so the API serves and nothing consumes the queue.

- The deployment went **`SUCCESS`** and took traffic.
- `/healthz` `200`, `/readyz` `200`, the landing page `200`. **Every probe green.**
- The smoke gate failed:

  ```
  smoke: readyz is green
  smoke: submitted scan_ef46f886-94aa-4e2b-b88a-e158b70b6436
  smoke: FAILED at scan — the scan did not finish within 60000ms
  Exit status 1
  ```

This is the whole argument for the smoke gate. Health probes cannot distinguish
a deployment that works from one that merely starts.

### 5.3 The rollback

`SERVICE_ROLE` reverted to `both` per §4.1. New deployment `SUCCESS`, the broken
one `REMOVED`, and the same gate that caught the break confirmed the fix:

```
smoke: report valid: evaluated 6 of 55 criteria, 0 finding(s)
smoke: deployment is healthy
```

### 5.4 A code-caused break, and the image rollback (§4.2)

The one §5.1–5.3 could not cover: those broke *configuration*, so reverting
configuration is all they proved. This broke **code**.

`runScanJob` was edited so the scan completes and the report is never saved — a
worker regression, uncommitted, deployed straight from the working tree with
`railway up`.

- The deployment went `SUCCESS` and took traffic.
- `/healthz` `200`, `/readyz` `200`, the landing page `200`.
- **The scan itself reported `completed`.** This is the sharpest version of the
  point: not only did every probe pass, the scan said it had worked.
- The smoke gate failed anyway, at the step after:

  ```
  smoke: scan completed in phase report
  smoke: FAILED at report — expected 200, got 409
  Exit status 1
  ```

**Rollback**, per §4.2's CLI path: `git checkout --` the offending file to
return the tree to the last good commit, then redeploy. The same gate confirmed
the fix:

```
smoke: report valid: evaluated 6 of 55 criteria, 0 finding(s)
smoke: deployment is healthy
```

Deployment history afterwards: the good build `SUCCESS`, the broken one
`REMOVED`.

**Both rollback paths in §4 have now been executed for real.** Note what §5.4
adds over §5.2: a deployment can report a *completed scan* and still be broken,
so the gate has to validate the artifact rather than the status.

---

## 6. Cost and limits

The demo is deliberately cheap and deliberately capped. `HOSTED_LIMITS`
(`apps/server/src/security/limits.ts`) is the single place these live:

- 3 scans/hour/IP, global concurrency 2.
- 5 pages, 10 minutes, a token cap and $0.50 per scan.
- `deterministic` mode by default, which costs nothing.

If the bill moves, look at `/api/meta` first — it reports `costUsdTotal` across
every scan the deployment has run.

---

## 7. Data

- **Screenshots may contain personal data.** They live in a private R2 bucket,
  are deleted 14 days after capture by the bucket's own lifecycle rule (§8),
  and are never logged — neither the bytes (redacted by type, not by key name)
  nor the signed URLs that fetch them (redacted by recognising
  `X-Amz-Signature` in the value, not by key name either).
- **A signed URL is a bearer capability.** Anyone holding one can fetch the
  screenshot until it expires, with no credential of their own. They live five
  minutes, are never cached, and are minted per request — see §8.
- `client_ip` is stored on `scans` for rate limiting and abuse forensics. It is
  not in `ScanRecord`, so it cannot reach a response body.
- Postgres holds everything else: scans, events, findings, the `artifacts`
  pointers, and the queue. Railway's managed backups are the recovery story; a
  lost scan is cheap to re-run.

---

## 8. The artifact bucket

Screenshots are the only thing this service stores outside Postgres, and the
only thing it stores that may be somebody else's personal data. Three rules
govern it, and they are worth knowing before touching anything.

**The bucket is private.** There is no public development URL and no custom
domain in front of it. Every read is a presigned GET that this service mints,
valid for five minutes. `GET /api/artifacts/:id` no longer serves bytes — it
`302`s to one of those URLs. The stable, unsigned path is what a report embeds;
the capability it hands out is per-request and short-lived.

**Retention is enforced by the bucket, not by the application.** A 14-day
expiration lifecycle rule on the `artifacts/` prefix is what actually deletes a
screenshot. It keeps working if this service is dead, mis-deployed, or rolled
back to a version that never heard of retention — which an application-side
sweeper would not.

**The application's job is to agree with it.** Three things hold that:

1. `artifacts.expires_at` is `created_at + 14 days`, written on every row.
2. The API returns `410 Gone` the moment `expires_at` passes, without waiting
   for Cloudflare to get round to the delete, and it clamps every signed URL so
   the capability cannot outlive the artifact. A lifecycle rule somebody
   deleted cannot quietly extend retention in practice.
3. `pnpm test:r2` reads the bucket's real lifecycle configuration and fails
   when it does not match `ARTIFACT_RETENTION_DAYS`.

### Setting it up, once

In the Cloudflare dashboard, R2 → the bucket:

1. Create the bucket. **Do not** enable the public development URL and do not
   attach a custom domain.
2. Settings → Object lifecycle rules → add a rule: prefix `artifacts/`, "delete
   uploaded objects" after **14** days.
3. Manage API tokens → create an **Object Read & Write** token scoped to this
   bucket only. That token's access key id and secret are two of the four
   service variables; the account id is in the R2 overview.

### Verifying it

```bash
R2_ACCOUNT_ID=… R2_ACCESS_KEY_ID=… R2_SECRET_ACCESS_KEY=… R2_BUCKET=… pnpm test:r2
```

Seven checks: the bucket is reachable, bytes round-trip, a signed URL fetches
them, an **unsigned** one is refused, a signature stops working when it
expires, and — the one this suite exists for — the bucket's lifecycle rule is
the same number the application believes it is.

**This is not a CI job and must not become one.** CI holds no cloud
credentials. Everything provable without a bucket is proved in
`apps/server/src/artifacts/artifacts.test.ts` against an in-memory object
store, which runs in the ordinary three-OS `unit` job. Run `test:r2` by hand
after changing the bucket, the retention constant, or the R2 client.

### Verifying it on the deployment

**The post-deploy smoke will not catch a broken R2.** It scans the deployment's
own landing page, which has zero findings by design — and a screenshot is only
attached as evidence to a finding that has a bounding box. So a healthy
deployment and a mis-configured one produce the same smoke-passing report.
Extending the smoke to demand an artifact id would fail on a *working* deploy.

What does prove it, by hand, once after setting the variables:

```bash
curl -s https://<host>/readyz | jq '.checks[] | select(.name=="object-storage")'
railway connect Postgres -- -c 'select count(*), min(expires_at) from artifacts'
```

Then scan a public site that actually has findings, and open its report:

```bash
curl -sS -X POST https://<host>/api/scans -H 'content-type: application/json' \
  -H "x-admin-token: $ADMIN_TOKEN" -d '{"url":"https://example.com"}' | jq -r .scan.id
curl -sSI "https://<host>/api/artifacts/<id-from-the-report>"   # expect 302 + no-store
```

Three things to see: `object-storage` green, rows in `artifacts` with an
`expires_at` fourteen days out, and `report.html` with images in it.
