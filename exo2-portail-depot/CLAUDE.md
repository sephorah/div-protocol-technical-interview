# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Context

https://exercice-stagiaire-div.vercel.app/exo/portail-depot

Un avocat monte un dossier et doit recuperer des pieces chez son client : contrats, factures, pieces d'identite. Aujourd'hui ca se passe par mail, en pieces jointes, sans tracabilite. Tu vas construire le portail qui remplace ca.

Le produit a construire
Cote avocat (authentifie)
Il cree une demande de depot, par exemple “Dossier Martin, pieces 2026”. Il genere un lien public expirable protege par un PIN, et l'envoie a son client. Un dashboard lui montre le statut de chaque demande : en attente, complete, expiree.

Cote client (anonyme)
Il ouvre le lien sans avoir de compte, saisit le PIN, depose ses pieces et voit sa progression. Le lien expire, le PIN protege l'acces, et c'est tout ce dont il a besoin.

Ton sous-domaine : https://sephorah-aniambossou.stage2-div.rayan-drissi.com
Ta plage de ports : 21600 a 21699

Le proxy de la machine route vers toi ainsi :
  port 80  (HTTP)  ->  127.0.0.1:21600
  port 443 (HTTPS) ->  127.0.0.1:21601, en passthrough TLS

Tes services doivent ecouter sur 127.0.0.1 uniquement, dans ta plage.
Rien d autre n est joignable depuis l exterieur.

Tu peux faire ton propre certbot : le challenge http-01 arrive sur le
port 80 de la machine et t est relaye. Comme le 443 est en passthrough,
c est bien ton nginx qui termine TLS avec ton certificat.

Cette machine est PARTAGEE avec d autres candidats. Tu as techniquement
les moyens de casser leur travail. Ne le fais pas. Tout est journalise.

Ne mets pas de code source ici : construis ton image ailleurs, publie-la
sur GitHub Container Registry ou Docker Hub, et ne garde sur la machine
que ta configuration (compose, Makefile, env, conf nginx).


## Status

Early scaffold with three real pieces of infrastructure. `backend/` is NestJS 11, `frontend/` is
Vite + React 19 (default `react-ts` template). Issues **A1, A2 and A3 are done**: PostgreSQL 17 +
Prisma 7, migrations applied at container start, a `GET /api/v1/health` probe, the full domain
model with its crypto primitives (`src/crypto/secrets.ts`), and containerised MinIO behind an S3
`StorageService`. **A6 is done too**: the images are built and published to GHCR by a workflow, and
the production stack pulls them. **B1 is done**: lawyer authentication (`/auth/login`,
`/auth/logout`, `/auth/me`), a JWT in an httpOnly cookie, a **global** guard, and `src/seed.ts` — the
demonstration account `install.sh` already knew how to run. There is still no request creation (B2),
no upload route (C2), and no CI running lint or tests (D3 — the only workflow so far publishes
images).
Regenerate this file (`/init`) once the business modules exist.

**pnpm is the package manager** in both apps (`pnpm-lock.yaml` is the source of truth) — do not run
`npm install`. The version is pinned to `pnpm@11.20.0` via `packageManager` in all three manifests
so corepack resolves the same pnpm on the host and inside Docker; bumping one means bumping all
three and regenerating the lockfiles.

The two apps are **independent packages, not a pnpm workspace** — each keeps its own lockfile and
`node_modules`. The root `package.json` only orchestrates via `pnpm -C <dir> run <script>`, which
keeps each Docker build context self-contained.

Layout:
- `backend/` — NestJS API
- `frontend/` — Vite SPA
- `package.json` — root orchestration scripts (no app code)
- `infra/` — **all infrastructure, no application code** (A5): `docker-compose.yml` (production
  stack: `db`, `minio`, `minio-init`, `backend`, `frontend`, `proxy` — **pulls, never builds**),
  `docker-compose.build.yml` (the build layer, A6), `docker-compose.tls.yml` (the HTTPS layer, A7),
  `docker-compose.dev.yml` (**database and storage
  only**, for local `pnpm dev` — there is no dev image), `nginx/{nginx,nginx-tls,portal-locations}.conf`,
  `minio/`.
  `prometheus/` (F1) and `grafana/` (F2) land here too. This directory plus `.env` is the whole of
  what lives on the staging machine. `infra/README.md` documents the compose flags, the registry and
  the deployment — see § Docker and § Images and registry.
- `.github/workflows/` — **at the root of the git repository, one level up from this folder**:
  `exo2-publish-images.yml` builds and publishes the two images (A6).
- `issue_backlog.md` — the backlog derived from the exercise statement; every feature branch
  should name the issue it closes
- `README.md` — project title, staging subdomain, and a list of topics the final README must cover
- `install.sh` — **the one-click entrypoint, and the first thing the graders run** (`git clone` on
  a bare machine, `./install.sh`, wait). It does exactly one thing: bring up the docker stack. It
  installs Docker if missing, generates `.env` with random secrets, builds, starts, waits for every
  healthcheck, then prints the URLs. **Its contract is that when it returns 0, the portal
  answers** — not "the containers started". `./install.sh --build` builds images without starting.
  It no longer installs Node/nvm/pnpm: the build happens inside the images, so that would make the
  grader wait for nothing. Local development is `pnpm db:up && pnpm dev`, which assumes Node 22 and
  pnpm 11 are already installed. See § install.sh below.
- `ai-plans/` — one dated markdown per feature: plan followed, decisions, verification, code review
- `ai-logs/` — AI session logs required by the internship deliverable, saved manually via `/export`

## Architecture

Deliberately **no Next.js**: NestJS already provides the server tier, so Next would add a second
Node runtime whose only real job is proxying. SSR/SEO are unwanted — this is a private portal that
must not be indexed. The SPA builds to static assets, leaving one process to deploy and observe.

## Commands

From the repository root (these delegate to the sub-packages):

```bash
./install.sh                # the one-click: docker stack up, URLs printed (127.0.0.1:21600)
pnpm install:all            # install deps in backend/ and frontend/
pnpm build                  # build both, backend first
pnpm dev                    # both dev servers in parallel (API :21610, vite :5173)
pnpm start                  # both production builds (API :21610, serve :4000)
pnpm test                   # backend jest suite (frontend has no test runner yet)
pnpm test:e2e               # supertest suite, doubles only — no Docker
pnpm test:integration       # testcontainers suite — REQUIRES a Docker daemon
pnpm test:bare-machine      # replays the grader's first test in a container (§ install.sh)
pnpm lint                   # lint both
pnpm db:up                  # Postgres AND MinIO, for local dev (:21632, :21690, console :21691)
pnpm db:down                # stop them
pnpm db:migrate             # prisma migrate dev, against the dev database
```

**Only `test:integration` needs Docker.** `test` and `test:e2e` must stay runnable on a bare machine
— they are what CI (D3) will run. Keep it that way: a new suite that reaches the network belongs in
`*.int-spec.ts`, not in `*.spec.ts` or `*.e2e-spec.ts`.

**`pnpm dev` needs `pnpm db:up` first**, which now brings up MinIO too — the API calls `HeadBucket`
in `onModuleInit`, so it does not start without it. The API validates its database configuration at
boot and refuses to start without it, so a missing `.env` fails immediately with the variables named rather
than at the first query. Error messages **never echo a value** — `DB_PASSWORD` and `JWT_SECRET` are
secrets and error messages end up in aggregated logs.

**The connection string is built, not written.** `.env` holds `DB_HOST`, `DB_PORT`, `DB_USER`,
`DB_PASSWORD`, `DB_NAME`; `buildDatabaseUrl()` (`src/config/database-url.ts`) assembles the URL with
`encodeURIComponent`, and `validateEnv` exposes the result as `DATABASE_URL` so `PrismaService` and
the Prisma CLI keep reading the single variable they expect. That is what makes **any** password
work — the previous design wrote the URL whole in `.env` *and* re-concatenated it in
`infra/docker-compose.yml`, so a password containing `/`, `#` or `?` produced an invalid URL: `db` started
fine and `backend` failed with no visible link to the password. Between host and container only
`DB_HOST`/`DB_PORT` differ, and compose overrides just those two.

A `DATABASE_URL` set explicitly still wins over the five variables — that is the escape hatch for a
managed or CI database. When it is used, it is *parsed* (`new URL`, then protocol / host / database
name) rather than regex-matched, so a truncated `postgresql://x` is rejected at startup instead of
failing later inside the driver.

`.env` stays at the **repo root** even though the compose files moved to `infra/` — the API reads
it too when it runs on the host, which is why every compose command carries `--env-file .env`
(§ Docker).

`.env` is resolved from `__dirname`, **not from the working directory** (`app.module.ts`). A
relative `../.env` meant the parent of the *cwd*, so `node backend/dist/main` run from the repo
root looked one level above the repo and refused to start with the file sitting right there.
`__dirname` is `backend/src` in dev and `backend/dist` once compiled — two levels up reaches the
root either way.

`pnpm start` runs the two apps in **one host**, so their ports must differ: the backend keeps
`:21610` (see § Ports and API prefix) and `frontend`'s `start` serves on `:4000` (4173 is vite
preview's own port, 5173 is vite dev). In Docker each app has its own network namespace, so the
frontend container still listens on
`:3000` — that port lives in `frontend/Dockerfile` and `infra/nginx/nginx.conf`, not in the
`start` script.

`dev` and `start` are `pnpm run "/^dev:/"` and `pnpm run "/^start:/"` — pnpm's regex form runs every
matching script in the *same* package concurrently, with prefixed output. That is why the per-app
`dev:backend` / `dev:frontend` scripts exist: they are the regex targets, not just shortcuts.
(`--parallel` is not usable here: it applies to `pnpm -r` across *workspace* packages, and these two
apps are deliberately not a workspace.) Adding a new `dev:*` script wires it into `pnpm dev`
automatically.

Docker is driven with `docker compose` commands, always from the repo root and always with both
flags — see § Docker.

From `backend/`:

```bash
pnpm install                # restore deps from pnpm-lock.yaml
pnpm start:dev              # watch-mode dev server (port 3000)
pnpm build                  # prisma generate, then tsc build to dist/
pnpm db:generate            # regenerate the Prisma client only
pnpm db:migrate             # create + apply a migration (dev)
pnpm db:migrate:deploy      # apply pending migrations (what the container entrypoint runs)
pnpm db:studio              # browse the data
pnpm lint                   # eslint --fix over src/ and test/ (flat config, eslint.config.mjs)
pnpm test                   # jest unit tests (*.spec.ts alongside sources)
pnpm test:e2e               # supertest e2e suite (test/, uses test/jest-e2e.json)
pnpm test:integration       # real-MinIO suite (test/*.int-spec.ts, test/jest-int.json, needs Docker)
pnpm test app.controller    # run a single test file by path pattern
pnpm test -t "should return"  # run tests matching a name
```

From `frontend/`:

```bash
pnpm dev                    # dev server (port 5173)
pnpm build                  # tsc -b && vite build, output to dist/
pnpm preview                # serve the production build
pnpm lint                   # scripts/verify-type-aware.sh && oxlint --deny-warnings
```

No frontend test runner is installed yet; picking one is still open.

The frontend linter is **oxlint, not eslint** — it came with the Vite 8 `react-ts` template, as the
backend's eslint came with the Nest one. Neither was a decision; both are now at the same
capability level, because `options.typeAware` is enabled in `.oxlintrc.json` (backed by the
`oxlint-tsgolint` devDependency). Both are pinned to exact versions: their version schemes are
unrelated (oxlint 1.77.0, tsgolint 7.0.2001), so a `^` range could drift into an incompatible pair.

Removing either the option or the dependency drops rules like `no-floating-promises` **silently** —
no error, just fewer findings, and a lint that stays green while checking less. That is what
`frontend/scripts/verify-type-aware.sh` exists to prevent: it writes a canary with a dangling
promise, asserts the rule fires, and deletes it. It runs before every `pnpm lint`, so the lint
cannot pass without first proving its own rules are live. The canary must live in `src/` (the only
directory `tsconfig.app.json` covers, so the only one with type information) and must **not** be
gitignored — oxlint honours `.gitignore` and would refuse to read it; `--no-ignore` does not help,
it only covers `.eslintignore`. Cleanup is the script's `trap`.

`--deny-warnings` makes the frontend lint blocking: warnings fail the command. The two
`react/only-export-components` warnings in the Chakra-generated `color-mode.tsx` are silenced with
scoped `oxlint-disable-next-line` comments rather than by splitting the file, which would diverge
from the upstream snippet on every regeneration.

The backend lint is blocking too, via `--max-warnings 0`. Its one warning was the stock
`bootstrap();` in `main.ts`. It is handled rather than silenced: `void bootstrap()` would satisfy
the rule while leaving a boot failure to surface as an unhandled rejection with a raw stack and an
incidental exit code. The `.catch` prints a named message and exits 1 — what `restart:
unless-stopped` and `docker compose logs` can actually act on. Verified by starting the API with
:21610 already bound: `Echec du demarrage de l'API Error: listen EADDRINUSE`, exit 1.

Both lints being blocking means **any new warning fails `pnpm lint`** — that is the intent, so
treat a warning as work to do, not as a reason to widen an ignore.

## Docker

Production only — there is no dev image on purpose; local development is `pnpm dev`.

```bash
# depuis la racine, les deux drapeaux sont obligatoires (voir plus bas)
docker compose -f infra/docker-compose.yml --env-file .env pull && \
docker compose -f infra/docker-compose.yml --env-file .env up -d
pnpm stack:pull && pnpm stack:up   # les memes, en plus court
# tout passe par le proxy sur 127.0.0.1:21600
```

**Since A6 the production compose builds nothing — it pulls** (see § Images and registry).

**Both flags are load-bearing, and A5 is where that started.** Compose derives its *project
directory* from the directory of the first `-f` file, and that is where it looks for `.env` and
where it gets the project name from. Since the compose files live in `infra/`:

- **`--env-file .env`** — otherwise compose looks for `infra/.env`, finds nothing, and every
  `${VAR:?}` fails. `.env` stays at the root because the API reads it there too when it runs on the
  host (`pnpm dev`, resolved from `__dirname`). **Never create `infra/.env`**: `install.sh` fills
  only the root one, and a second secrets file that nobody populates fails in production only.
  Verified: `docker compose --project-directory /tmp -f docker-compose.yml config`, run from a
  directory that *does* have a `.env`, still fails on `required variable DB_NAME is missing` — the
  cwd's `.env` is not consulted, only the project directory's.
- **`name:` inside each compose file** — otherwise the project would be called `infra` and every
  existing volume would go orphan. It also fixes a pre-existing bug: both files were at the root, so
  both inherited the *same* project name. `pnpm db:up` while production was running did not start a
  second stack — it recreated production's `db`/`minio`/`minio-init` with the dev config (empty
  `_dev` volumes, two published ports) underneath a still-running `backend`. They are now
  `exo2-portail-depot` and `exo2-portail-depot-dev`.

Consequence: **relative paths inside those files are relative to `infra/`** — `../backend`,
`./minio`, `./nginx/nginx.conf`. `--project-directory ..` was rejected for exactly that reason: it
would restore root-relative paths inside a file that no longer lives at the root. The command is
written once per consumer — `COMPOSE` in `install.sh`, the `stack:*`/`db:*` scripts, the final
banner, `infra/README.md`.

A misplaced `nginx.conf` mount is the **silent** failure mode of any move here: nginx then serves
its default welcome page, `wget /` still returns 200, `proxy` goes healthy and `install.sh` reports
success. What catches it is `curl http://127.0.0.1:21600/api/v1/health` returning **403** — the
`deny all` rule only exists in our file.

Both Dockerfiles are two-stage, each building from **its own directory**, with its own
`.dockerignore`. Paths inside are unprefixed (`dist/`, `node_modules/`). The `build:` keys no longer
live in `infra/docker-compose.yml` — they moved to `infra/docker-compose.build.yml` (§ Images and
registry). The backend's `.dockerignore` also excludes `**/*.spec.ts`: `test/` only covered the e2e
suites, and the runtime image copies `src/config/`, so two colocated spec files were shipping in a
now-public image.

**Runtime images contain no pnpm and no corepack**; the entrypoints are
`backend/docker-entrypoint.sh` (which runs `prisma migrate deploy` then `exec node dist/main`) and
`node_modules/.bin/serve -s dist -l 3000`. Going through `pnpm run <script>` instead costs three
things: pnpm + corepack must ship in the runtime image, pnpm 11 tries to `pnpm install` before any
script (the image has no lockfile, so it needs `--config.verify-deps-before-run=false` or it
crash-loops), and it nests three processes per container. `corepack prepare pnpm@11.20.0
--activate` stays in the **build** stages only, where corepack runs before any `packageManager`
field is in the context and would otherwise fetch pnpm latest.

`node_modules/.bin/serve` is a shell wrapper, but it ends in `exec node`, so the shell replaces
itself and only one process remains — no need to reach for serve's `build/main.js` directly.

The trade-off: root `package.json` scripts describe local development, the Dockerfiles describe
container startup. Two places to keep in sync — if `start:prod` stops being `node dist/main`, the
Dockerfile must follow.

`init: true` on both app services is **load-bearing**. A process running as PID 1 gets no default
signal dispositions from the kernel, so `node` as PID 1 ignored SIGTERM and every `docker stop`
waited out the full 10 s timeout (measured: 10.37 s). With `init: true`, docker-init is PID 1 and
node is an ordinary child that exits on SIGTERM — the same stop takes 0.24 s. That is process exit,
not connection draining. `app.enableShutdownHooks()` is now in `main.ts`, which is what makes Nest
call `onModuleDestroy` at all — without it `PrismaService.$disconnect()` never runs and Postgres
keeps the connections until they time out. Measured after A1: `docker compose stop backend` in
**0.23 s**. Gracefully finishing in-flight uploads is still a separate concern, for when uploads
exist.

`docker-entrypoint.sh` is `set -e`, so a failed migration stops the container instead of starting
an API against a schema in an unknown state. It ends in `exec node dist/main`, so node replaces the
shell and stays the process docker signals — without `exec`, the shell would be PID 1's child and
SIGTERM would go nowhere.

Both services run `pnpm prune --prod` in the build stage, so neither image carries its build
toolchain: no `nest`/`tsc` in the backend image, no `vite` in the frontend one. The frontend is
served by `serve -s dist` — the `-s` flag is what gives the SPA its history fallback, so deep links
like `/depot/<token>` resolve instead of 404ing. Both run as the image's `node` user (uid 1000).

`proxy` (stock `nginx:alpine` with `infra/nginx/nginx.conf` bind-mounted) is the **only published
port**:
`127.0.0.1:21600:80` for everything (plus `21601:443` when the TLS layer is on — see § TLS). Both halves of that are load-bearing — the staging machine is
**shared with other candidates**, so the bind address is explicit (a bare `21600:80` would listen
on `0.0.0.0` and expose the whole portal, database included via `/api`), and 21600 is the assigned
port the machine's own proxy relays HTTP to. It routes `/` to the frontend and `/api/` to the
backend, stripping the `/api` prefix via the trailing slash in `proxy_pass`. `db`, `backend` and
`frontend` and `minio` are reachable only on the internal network. Because everything is served from one
origin, **no CORS configuration is needed** — keep it that way when adding real API calls: hit
`/api/...` as a relative URL rather than an absolute backend host.

`/api/v1/health` is deliberately **`deny all`** in `infra/nginx/nginx.conf` (an exact-match
`location =`, which
nginx evaluates before prefix locations). The probe's consumers are all on the internal network —
the backend's own Docker healthcheck hits `127.0.0.1:21610/api/v1/health` inside its container, and F1's
Prometheus will too. Published, it would only tell a scanner which dependency is down. To read
it by hand:
`docker compose -f infra/docker-compose.yml --env-file .env exec backend node -e "fetch('http://127.0.0.1:21610/api/v1/health').then(r=>r.text()).then(console.log)"`.

The probe answers `{ status, db, storage }` and **503 if either dependency is down**, not just the
database. Both checks run in `Promise.all`, so a Postgres outage cannot mask a MinIO one in the
report. A backend that cannot store anything is not healthy: every deposit would fail, and this is
the signal F2 alerts on. The values come from `HealthState` / `HealthStatus` enums rather than bare
literals, but the serialised JSON is unchanged — the docker healthcheck and `install.sh` do not
parse it beyond the status code.

`db` (`postgres:17-alpine`) has a `pg_isready` healthcheck and `backend` waits on
`condition: service_healthy`. Postgres accepts connections several seconds after its container is
"started", so without that condition `migrate deploy` fails on the first boot and the API
restart-loops until it happens to work. `backend` waits on `minio` the same way, because
`assertBucketExists()` runs in `onModuleInit`: a MinIO that is not ready yet fails the API's
*startup*, not merely its first upload. It also waits on `minio-init` with
`condition: service_completed_successfully` — the bucket and the restricted user must exist before
the API tries to authenticate as that user. `backend` has its own healthcheck too, calling `/health`
with `node -e "fetch(...)"` — the image has neither curl nor wget, and node 22 ships `fetch`.

`minio` uses `curl` on `/minio/health/live`; unlike the node images, `minio/minio` ships both `curl`
and `mc`. Its tag is pinned to `RELEASE.2025-04-22T22-12-26Z` **and to that release specifically**:
community images after May 2025 dropped the web console. A `latest` would make the admin UI vanish
without a line of this repository changing.

Compose **no longer concatenates any URL**: it passes `DB_HOST: db` and `DB_PORT: 5432` and forwards
`DB_USER`/`DB_PASSWORD`/`DB_NAME` from `.env` untouched (see § Commands for why that matters). Every
compose variable uses the `${VAR:?message}` form, which fails `docker compose up` naming the
variable instead of silently starting Postgres with an empty password.

Every healthcheck sets **`start_interval: 1s`** alongside a long `interval`. During `start_period`,
docker probes at `start_interval` instead of waiting a full `interval`, so a service flips to
`healthy` as soon as it is — which is what `install.sh` blocks on. Without it the script waited a
whole interval per service for nothing. Requires Docker ≥ 25.

**`minio-init` is deliberately absent from `SERVICES` in `install.sh`.** The wait loop only accepts
`healthy|running`, and that container provisions then exits 0 — adding it would stall the script for
the full 300 s `HEALTH_TIMEOUT` on a container that did its job perfectly. Waiting on `backend`
already covers it, since `backend` depends on it completing.

`frontend` and `proxy` have healthchecks too, not just `db` and `backend`: `install.sh` concludes on
`proxy` being healthy, and "the container started" would prove nothing. `proxy` also uses the long
`depends_on` form with `condition: service_healthy`, so the first request cannot land on a 502.

`pgdata`/`pgdata_dev` and `minio_data`/`minio_data_dev` are deliberately **different named volumes**
— a `migrate reset` or a cleanup aimed at development must not be able to reach production data, or
production's deposited files.

**No MinIO port is published in production.** Only `infra/docker-compose.dev.yml` publishes, on
`127.0.0.1` and inside the assigned range: `21690` for the S3 API (what `STORAGE_ENDPOINT` targets
during `pnpm dev`) and `21691` for the console. The machine is shared — an open MinIO console is
every client's documents.

## TLS (A7)

HTTPS is **switched on by `DOMAIN` in `.env`, never by a flag** — a flag would have to be retyped at
every redeploy, and forgetting it once would silently drop the portal back to cleartext. Empty
(grader's machine, dev laptop) the stack is exactly what it was before A7. Set, `install.sh` adds
`infra/docker-compose.tls.yml`, obtains the certificate and publishes `127.0.0.1:21601:443`. The
three keys (`DOMAIN`, `ACME_EMAIL`, `ACME_STAGING`) are read by **`install.sh` alone** — not by
compose, not by the app — so the three-file rule does not apply to them; that is stated in
`.env.example` so the next reader does not "fix" the missing `${VAR:?}`.

The nginx config is split in three: `portal-locations.conf` holds the `location` blocks and is
`include`d by both servers, `nginx.conf` is the cleartext one, `nginx-tls.conf` the TLS one. The
layer mounts the latter **over** `/etc/nginx/conf.d/default.conf` — compose merges `volumes` by
**target path**, which is the whole mechanism; the two configs are never loaded together. The
fragment must sit **outside `conf.d/`**: that directory is included at `http` level, where a bare
`location` is a syntax error.

Five things are non-obvious:

- **Bootstrapping goes through the cleartext stack.** nginx refuses to start when `ssl_certificate`
  names a missing file, so the first certificate cannot be obtained by the TLS stack itself.
  `install.sh` brings up the plain stack, lets certbot use it (`--webroot`: certbot drops the token
  in the shared volume, the already-running nginx serves it), then restarts with the layer. Hence
  `certbot_www` is declared in the **base** compose too, and the ACME `location` exists in **both**
  configs — in the TLS one it precedes the 301, or renewals would break, ACME always probing over
  cleartext.
- **The certificate lineage is named `portail`, not the domain** (`certbot --cert-name portail`).
  That is what lets `nginx-tls.conf` never name the domain — necessary because nginx does not read
  the environment, and the official image's template mechanism is unusable here: its
  `/docker-entrypoint.d/` scripts only run when the command is `nginx`, and the layer replaces it
  with `sh -c` for the reload loop.
- **Reloading is periodic, not event-driven.** certbot runs in another container; `--deploy-hook`
  cannot signal nginx without the docker socket, which is a disguised root on a shared machine.
  nginx reloads every 6 h, certbot renews every 12 h. `certbot renew` is a **no-op above 30 days
  remaining**, so it consumes no quota.
- **The layer's certbot never issues, only renews.** Issuance is `install.sh`'s `run --rm`: a loop
  that also issued would retry `certonly` forever on failure and burn the production quota (5
  identical certificates per week) in hours. The same quota is why `letsencrypt` is a named volume.
- **No OCSP stapling.** Let's Encrypt dropped OCSP URLs from its certificates in May 2025 and
  switched its responders off in August 2025; `ssl_stapling on` would only log warnings now.

`docker-compose.tls.yml` must never be renamed `docker-compose.override.yml`, for the same reason as
the build layer: compose loads that name on its own.

## Images and registry (A6)

`infra/docker-compose.yml` **pulls, it does not build**:
`ghcr.io/sephorah/exo2-portail-depot-{backend,frontend}:${IMAGE_TAG:-0.2.0}`. That is what makes
`infra/` + `.env` a complete deployment unit, which is the statement's requirement — no source code
on the staging machine. The workflow that publishes lives at
**`.github/workflows/exo2-publish-images.yml`, at the root of the git repository
(`div-protocol-internship/`), not in this folder**, and its `context:` is therefore
`exo2-portail-depot/backend`.

Six things are non-obvious:

- **`IMAGE_TAG`'s default is written in the compose file, deliberately not in `.env`.** The version
  belongs to the code, not to the machine. In `.env`, `install.sh` would never rewrite it
  (`set_env_default` only fills empties), so a machine would stay pinned to a stale version with
  nothing to signal it — and it would drag in the three-file rule (`.env.example`, `install.sh`,
  compose). Overriding still works, and that is the rollback: `IMAGE_TAG=0.1.0 … up -d` — 0.1.0
  being the last version *before* authentication, so rolling back to it removes the login route and
  the demo account, silently.
- **`infra/docker-compose.build.yml` is the only place a `build:` survives**, and it must never be
  named `docker-compose.override.yml`: compose loads that name **automatically** whenever it sits in
  the project directory, so a stack everyone believes is pulled would silently build. It keeps the
  base file's `image:`, which tags the local build under the GHCR name — docker then prefers the
  local image and the *production* compose starts offline. That is what `./install.sh --from-source`
  does, and it is the only way to try the production compose before publishing: only `build` gets
  the extra `-f`, `pull`/`up`/`ps`/`logs`/`exec` stay on the production file alone.
- **The base file stays first in the `-f` order**: it sets the project directory, so reversing them
  shifts every relative path.
- **GHCR rather than Docker Hub.** `GITHUB_TOKEN` authenticates the run with no secret to store,
  permissions are the repository's, and Docker Hub caps anonymous pulls at **100 per 6 h per IP** —
  the staging machine is shared with other candidates, so its IP is too.
- **Check the packages' visibility, never assume it.** GitHub's documentation says a personal
  package is born *private* and inherits the repository's permissions but **not** its visibility.
  Observed on the first push: both packages were anonymously pullable straight away (verified with
  an anonymous registry token, no docker credentials involved). Either way the check is
  `docker logout ghcr.io && docker pull …` — a 403 is indistinguishable from a missing image. If it
  fails, flip **each** package in its own settings; do **not** use the account-wide default
  (*Packages → Package creation*), which would apply to every future package of the account,
  private repositories included. Public visibility is what avoids storing a registry credential on
  a shared machine, and costs nothing here since the repository is public.
- **`metadata-action` also publishes a `latest` tag** on a version tag (`flavor: latest=auto`).
  Nothing pins it — the compose pins `IMAGE_TAG` — and it is left enabled because it tracks the
  newest release on its own. Do not point production at it, for the same reason `edge` exists and
  is unused there.
- **Actions are pinned to commit SHAs**, version in a comment: the job holds `packages: write`, and
  a mutable `@v7` tag would put registry write access one upstream compromise away. There is no
  `pull_request` trigger, for the same reason.

Verification order matters: the local build catches *compose* mistakes (wrong image name, a variable
lost with the `build:` key, a moved mount) in seconds and offline, but a locally rebuilt image is
**not** the deployed artifact. Before tagging a version, run the image CI published —
`IMAGE_TAG=sha-<short> docker compose -f infra/docker-compose.yml --env-file .env up -d`. That is
why every push to `main` publishes a `sha-` tag alongside `edge`.

Known trade-offs, both recorded in the README's limitations: `linux/amd64` only (emulating arm64
under QEMU to compile `argon2` would take the job from ~3 min to ~15 min for a platform nobody
deploys), and the production pins a **tag**, which is mutable — only a digest identifies content.

## install.sh

The graders' very first test is `git clone` on a bare machine, `./install.sh`, wait. "If we have to
read the README to repair a step, no." So the script's contract is **exit 0 means the portal
answers**, and nothing it cannot deliver on gets mentioned: there is no "seed pending" line, no
TODO, no instruction. When the seed exists (A2/B1) it runs and prints credentials; until then the
script is silent about it.

It does one thing — the docker stack. Node/nvm/corepack bootstrapping was **removed**, not moved:
the build happens inside the images, so installing Node would make the grader wait for nothing.
`pnpm db:up && pnpm dev` is the development path and assumes Node 22 + pnpm 11 are present.

**Since A6 the nominal path builds nothing**: `pull`, then `up -d`. The `pull` is its own step
rather than a side effect of `up` so that its failure can be *explained* — `up` would only say
`manifest unknown`. **A failed pull stops the script**; it does not fall back to building, because
the staging machine has no sources and the fallback would only hide which of the three real causes
applies (package still private, `IMAGE_TAG` does not exist, registry unreachable). For the same
reason the script must **never** test for the existence of `backend/` or `frontend/` — a production
checkout has neither, and that is the acceptance criterion. `--from-source` replaced the old
`--build`, whose consumer was a CI that the GitHub Actions workflow now is; it adds the build layer
to the `build` command **only**, so what then starts is the production compose alone.

Docker is handled as a **cascade**, because a bare machine may not have it and `install.sh` cannot
install a system daemon without root: already usable → root → passwordless sudo → sudo with one
prompt (`sudo -v`, called early so the prompt lands before the build, never mid-way) → **rootless
Docker in `$HOME`** → fail naming the exact command. Every docker call goes through `$DOCKER`,
which becomes `sudo docker` when the daemon is up but the user is not in the `docker` group —
group membership is only read at login, so `usermod -aG` cannot help the current shell.
`get.docker.com` is used rather than distro packages: `docker-compose-plugin` is missing from older
Debian/Ubuntu. After install, if neither `systemctl` nor `service` exists (containers, WSL without
systemd), the script starts `dockerd` itself.

**The cascade has a step before it: `ensure_fetcher`.** The script used to *require* `curl` and die
telling the grader to run `apt install curl`. `ubuntu:24.04` ships neither `curl` nor `wget`, so on
the exact machine the acceptance criterion describes, the one-click asked for a manual command.
Three recorded bare-machine campaigns (A8, A5, A6) missed it **because the test harness installed
curl before running the script** — it was validating a machine less bare than the one it claimed to
simulate. `ensure_fetcher` now accepts `wget` if present, else installs curl through whichever of
`apt-get`/`dnf`/`yum`/`apk`/`zypper`/`pacman` exists, and only then gives up. `fetch_url` is the
single download helper both installers go through. **`apt-get update` before `apt-get install` is
load-bearing**: on a bare Ubuntu the package lists are empty and `install -y curl` answers `Unable to
locate package curl`, blaming the package when the index is what is missing.

**There is deliberately no macOS guard, and re-adding one would be a regression.** A `Darwin` check
dying with our own Docker Desktop message was written, then removed: `get.docker.com` **detects
macOS itself** and exits with `ERROR: Unsupported operating system 'macOS' / Please get Docker
Desktop from …` (line 763 of the upstream script). Ours replaced a correct message with another one,
and its text asserted that the rest of the script works on macOS — a claim nobody here can verify,
there being no Mac. macOS is simply not a covered system, and the code says so in a comment where
the guard used to be.

**`timeout` is optional, via `tcp_probe`.** This one is *not* about macOS support, which is why it
stayed: it is about the script degrading silently when a command is absent. `timeout` comes from GNU
coreutils; hard-coded, a missing one returned 127, the `if` failed, and `port_state` declared an
occupied port *free* — the failure then surfaced at `up` without naming the culprit. Reproduced on
the old code (with `timeout` stripped from `PATH`), fixed on the new.

**Alpine is deliberately not covered**, and the technique is recorded here so the decision stays
reviewable rather than becoming a hole: the shebang is `bash`, absent from Alpine, so nothing runs at
all. Covering it means `#!/bin/sh` plus a dozen POSIX lines that obtain bash and `exec bash "$0"
"$@"` — after which everything else is unchanged, `/dev/tcp` included (verified: it is the only
bash-only construct in the script). It is cheap; it is skipped because it protects nothing. Alpine is
a container base image, and Ubuntu/Debian, Fedora/RHEL and macOS all ship bash.

**`$USER` is never used bare.** Under `set -u` an unset `USER` turned three help messages into
`USER: unbound variable`, including the final banner — i.e. after a *successful* deployment.

**Every compose call goes through `$DOCKER compose $COMPOSE`**, where
`COMPOSE="-f infra/docker-compose.yml --env-file .env"` — one variable, seven call sites (`ps`,
`pull`, `up`, `logs`, `exec`, and the two inside `port_is_ours`/`health_of`). `COMPOSE_BUILD` adds
the build layer and is used by the single `build` call. Missing one is not a
syntax error: that call would silently target a *different* project (compose would look for a
compose file in the cwd, find none, and either fail or answer about nothing), so `port_is_ours`
would stop recognising our own proxy. The only deliberate exception is `compose_v2_present`, which
probes `docker compose version` and must not need a file. `cd "$(dirname "$0")"` at the top is what
makes both relative paths valid regardless of the caller's cwd.

Four details that are easy to undo by accident:

- **`chmod 600 .env` must come after the value substitutions.** `set_env_value` writes a temp file
  and moves it into place, which resets the mode to the umask. Doing it before leaves `.env` at 644.
- **Port 21600 is checked before the images are fetched**, otherwise the failure arrives after the
  download (or, with `--from-source`, minutes late). A port held
  by *our own* proxy is not a conflict (compose recreates it), or a second `./install.sh` would fail
  against itself. But that check must come **after** the `.env` step: `port_is_ours` shells out to
  `docker compose ps`, which cannot parse a `.env` missing a `${VAR:?}` variable. With the order
  reversed, a `.env` predating a new required variable made the script die on "port already in use"
  — naming our own proxy as the intruder.
- **An existing `.env` is topped up, not left alone.** `append_missing_keys` copies over any key
  `.env.example` has gained since, with its comments; `set_env_default` then fills only what is
  empty, so a value already chosen is never overwritten and secrets are never regenerated. Without
  this, a `.env` predating A3 made `docker compose up` fail on `${STORAGE_ACCESS_KEY:?}` — the script
  stopped honouring "exit 0 means the portal answers". Note `set_env_default` uses `if`, not `&&`:
  `a && b` returns 1 when the key is already filled, which `set -e` would read as a script failure.
  **Secrets are generated exactly once, at the first run** — verified by three consecutive
  `./install.sh` producing the same `DB_PASSWORD`. Do not make them rotate per run: Postgres reads
  `POSTGRES_PASSWORD` only when *initialising* an empty volume, so a regenerating installer would
  break its own stack on the second run of every machine. Rotation is a separate operation
  (`ALTER USER` + restart), not a side effect of installing.
- **`.env.example` carries the non-secret values; `install.sh` generates the secrets.** `DB_USER` and
  `DB_NAME` are constants (`portail`, `portail_depot`) and now live in `.env.example` with their
  value: left empty, a hand-made `cp .env.example .env` for `pnpm db:up` failed on
  `${DB_USER:?definir DB_USER dans .env}`, on a value nobody can guess. The two `set_env_default`
  calls stay anyway — `append_missing_keys` skips any key already present *even when empty*, so they
  are what repairs a `.env` generated before the change. `MINIO_ROOT_USER` stays generated: it is
  half of a storage-admin credential, not the name of a thing.
- **A `.env` password and an existing Postgres volume can diverge**, and it looks like a project bug:
  the backend restart-loops on `P1000`, the script waits out its 300 s and prints raw logs. It cannot
  happen on a fresh machine (`.env` and the volume are born together), only on a dev machine whose
  `.env` was regenerated while the volumes survived. The fix is `down -v`, documented in
  `.env.example`. **Diagnosing it has a trap**: the postgres image's `pg_hba.conf` is `trust` for the
  local socket and for `127.0.0.1` *inside its own container*, and `scram-sha-256` for everything
  else. So `docker compose exec db psql` — the shortest command to type, hence the one a human
  reaches for — accepts **any** password and appears to exonerate the configuration. Measured on this
  stack:

  | From | Address Postgres sees | Rule | Wrong password |
  |---|---|---|---|
  | `backend` container → `db` | `172.19.0.5` | `scram-sha-256` | rejected |
  | the host (`pnpm dev`) → published `21632` | `172.17.0.1` | `scram-sha-256` | rejected |
  | `docker compose exec db psql` | *(none, local socket)* | `trust` | **accepted** |
  | `docker compose exec db psql -h 127.0.0.1` | `127.0.0.1` | `trust` | **accepted** |

  Note row 2: docker's port publishing **NATs**, so a connection from the host to `127.0.0.1:21632`
  reaches Postgres as the bridge gateway, not as loopback — `pnpm dev` really does authenticate. The
  rule to apply: **test through the same path the real client uses.** The same principle is why
  `test-bare-machine.sh` probes `/api/v1/health` *through nginx* expecting **403**: the backend
  itself answers **200** on that route (verified from inside its container, which is exactly what its
  docker healthcheck does), so only the proxied path can tell whether **our** `nginx.conf` is
  mounted — a default nginx would serve its welcome page and never deny anything.
- **The final banner must stay in raw docker commands.** It prints
  `docker compose -f infra/docker-compose.yml --env-file .env down`, not `pnpm stack:down`: the
  script no longer installs Node or pnpm, so the banner cannot tell the grader to run a pnpm script
  they may not have. The heredoc is unquoted (`<<BANNER`), which is what interpolates `$COMPOSE` —
  quoting the delimiter would print the variable name. That interpolation is also why `COMPOSE` must
  keep pointing at the production file alone: folding the build layer into it would print a `down`
  command mentioning a file the staging machine does not have.

**Adding a required variable therefore means touching three files together**: `.env.example` (the
key and its documentation), `install.sh` (a `set_env_default` if it is a secret), and
`infra/docker-compose.yml` (the `${VAR:?}` entry). `set_env_value` exits 3 if the key is absent from
`.env.example`, which is the guard against doing only two of the three.

Measured (this machine): **2 min 11 s** cold with Docker present, **4 min 33 s** on a truly bare
machine (Docker install included), **13 s** with images cached, **5,8 s** when the stack is already
up. The cold time is two `pnpm install` plus two builds — 1 min 19 s of the total. **A6 (pulling
published images instead of building) is the only thing that changes its order of magnitude.**
A BuildKit `--mount=type=cache` on the pnpm store was tried and dropped: its gain is on rebuilds,
which the one-click never does.

A3 added a fourth image to pull (`minio/minio`) but no build stage, so the cold figure is unchanged
in kind. Measured after A3, volumes destroyed and backend rebuilt for the new dependencies:
**1 min 06 s**.

A5 moved the compose files but changed no build stage. Re-measured after it: **13,2 s** with images
cached, **3,9 s** with the stack already up, and **4 min 14 s** on a bare machine, Docker install
included — the figures hold.

**A6 removed the build from the nominal path**, and the figures above are superseded. Measured after
publication: **2 min 02 s** on a truly bare machine, Docker install included (was 4 min 14 s),
**35,3 s** when Docker is present and only the portal images are missing, **14,8 s** with everything
cached. `--from-source` still builds and takes 13,2 s on warm layers — it is the pre-publication
check, not the one-click. Publishing itself takes **1 min 56 s** in CI, off the grader's critical
path entirely.

The bare-machine path can only be exercised in a container, so it is the most likely to rot. It is
now **one command** — the recipe used to live here as `bash -c '...'`, elided, and was re-derived
from scratch every time:

```bash
./scripts/test-bare-machine.sh              # ubuntu:24.04, root tier
./scripts/test-bare-machine.sh debian:12    # any other base image
pnpm test:bare-machine                      # the same
```

It asserts exit 0, `/` → 200, `/api/v1/health` → **403**, `.env` at **600**, and prints the duration.
Measured with `ensure_fetcher` in place: **1 min 52 s and 2 min 28 s** on two runs (was 2 min 02 s
before — the gap between runs is network variance, the delta against A6 is
`apt-get install curl`, which the script now does instead of refusing to continue). Three things in
it are load-bearing:

- **It runs against `git archive HEAD`, not the working tree**: a file left out of `git add` shows up
  there and is invisible otherwise.
- **`-v /var/lib/docker` is required** — without it the nested daemon runs overlayfs on overlayfs and
  every build dies with `mount source: "overlay" ... invalid argument`, which looks exactly like a
  project bug and is not one.
- **It installs nothing in the container.** No `apt-get install curl`, nothing. That is precisely the
  blind spot that let three campaigns of bare-machine measurements pass over an `install.sh` which
  died on a bare Ubuntu. Adding a package here reintroduces it.

Its scope is the **root** tier of the docker cascade (`id -u` = 0 in the container). The *sudo* and
*rootless* tiers are still manual. macOS is not covered at all.

## Authentication (B1)

`@nestjs/jwt` alone — **no Passport**: its `PassportStrategy` types are weak enough to trip
`no-unsafe-call`, which the blocking lint refuses, and its reason to exist (Google, SAML, LDAP) does
not apply to a portal with one account.

Seven things are non-obvious:

- **Every route is closed by default.** `JwtAuthGuard` is registered as `APP_GUARD` **from
  `AuthModule`**, and `@Public()` is the only way out. A new controller is therefore born protected;
  `/public/*` (C1, C2) will have to carry `@Public()` explicitly, and `@Public()` already sits on
  `/auth/login`, `/auth/logout`, the health probe and the scaffold's root route. Registered from
  `AuthModule` and not `AppModule` because a provider resolves its dependencies in the module that
  declares it, and `JwtService` lives there. `app.useGlobalGuards()` is **not** an alternative: it
  instantiates the guard outside the injection container, so it would receive neither `JwtService`
  nor `Reflector`.
- **The health probe being `@Public()` is load-bearing.** Behind the guard it answers 401, docker
  declares the container unhealthy, and `backend` restarts in a loop with nothing in the logs
  mentioning authentication. What keeps the probe off the internet is a different mechanism: the
  `deny all` rule in `infra/nginx/portal-locations.conf`.
- **The cookie's `Secure` flag is decided per request**, from `X-Forwarded-Proto` via `req.secure`,
  never from `NODE_ENV`. The images carry `NODE_ENV=production`, but the grader's portal answers in
  cleartext on `127.0.0.1:21600`: a `Secure` cookie there is set and never sent back, so login fails
  silently, in production, for them only. That is what `app.set('trust proxy', 1)` in
  `app.setup.ts` is for — without it Express ignores the header and the cookie ships without
  `Secure` even over HTTPS.
- **`configureApp()` (`src/app.setup.ts`) is called by `main.ts` AND by the e2e suite.** The suites
  build the application with `Test.createTestingModule`, which does not go through `main.ts`.
  Duplicated, the four settings drift and the suite ends up testing an application that does not
  exist — a missing cookie-parser alone makes every authenticated route 401, a missing
  `ValidationPipe` makes a malformed body 200.
- **The payload carries `sub` and nothing else**, and the guard re-reads the account on every
  request. It costs one indexed lookup and buys the only revocation this design has: a deleted
  account stops being able to use tokens issued before its deletion. `verifyAsync<JwtPayload>` is a
  cast, not a validation, hence the explicit check on `sub` — without it a token with no subject
  reaches Prisma with `id: undefined` and answers 500 where every other rejection is a 401.
- **An unknown e-mail must cost the same as a wrong password.** `AuthService` verifies against a
  decoy argon2id hash computed once in `onModuleInit`. An early `if (lawyer === null) throw` looks
  like a simplification and reinstates the account enumerator; a unit test compares the two paths.
- **There is deliberately no rate limiting on `/auth/login`.** Behind the machine's SNI passthrough
  every request carries the same address, so a per-IP limit is a global one — an attacker would
  consume the quota and lock the lawyer out. G1 will limit per link token. What bounds the cost
  instead is `@MaxLength` on the DTO: argon2id's cost grows with its input, and the route is
  anonymous.

`JWT_EXPIRES` is **15m**, and the cookie's `Max-Age` comes from the same `durationToMilliseconds`
parser (now in `src/config/duration.ts`), so the two cannot diverge. The value is passed to
`JwtModule` in **seconds** rather than as `"15m"`: jsonwebtoken types `expiresIn` as a template
literal that a value read from the environment is not, and converting is better than casting the type
away.

### Refresh tokens (B1c)

The access token is short-lived and **irrevocable**; the refresh token is what makes a session
closable. It is an opaque 256-bit secret stored as a SHA-256 hash in `RefreshToken`, rotated on every
use, per **RFC 9700 § 4.14.2** — which mandates rotation *or* cryptographic client binding for public
clients, and says nothing about durations.

Six things are non-obvious:

- **Rotated rows are KEPT, never deleted.** Their presence is the only thing that makes a reuse
  recognisable: deleted, a stolen token would look exactly like an unknown one and no detection would
  ever fire. `purgeExpired` only removes rows past a deadline, and runs at login.
- **A 30-second race window is what keeps the feature from turning on its user.** Two tabs refreshing
  at once present the same token; the second arrives after the first has rotated it and looks like a
  theft. Inside the window the request is refused *without* revoking the family — the browser shares
  cookies across tabs, so the retry succeeds. Remove it and normal two-tab use logs the lawyer out.
- **Revoking the whole family is OUR decision, not the RFC's** — it speaks of "the active refresh
  token". We go further because the server cannot tell the thief from the victim.
- **Two deadlines, and the asymmetry is load-bearing.** `expiresAt` (7d ceiling) is **copied** on
  rotation; `idleExpiresAt` (3d) is **recomputed**. Copy the idle one and the lawyer is logged out
  mid-work on day three; recompute the ceiling and the session becomes immortal. Two unit tests exist
  for that alone.
- **`validateEnv` refuses `SESSION_IDLE_EXPIRES >= SESSION_EXPIRES`**: the idle deadline could never
  be reached, so the protection would be off while the variable looks configured. That cross-check is
  why `durationToMilliseconds` lives in `config/` — configuration must not import from `auth/`.
- **The claim is an atomic compare-and-set** (`updateMany ... where revokedAt: null`, then check
  `count`), wrapped with the successor's INSERT in one `$transaction`. A read-then-write would let two
  concurrent requests both believe they won; splitting the pair would let a failed INSERT leave the
  presented token revoked with no replacement, i.e. one database hiccup ending a seven-day session.
- **`refresh()` must NOT clear the cookies on a `raced` refusal** (`auth.controller.ts`). It is the
  client half of the race window: the browser holds the cookie the other tab has just obtained, and
  clearing it logs the lawyer out for having two tabs open — cancelling the very protection the 30 s
  constant buys. Every other refusal is terminal and does clear. An e2e case asserts both halves.
- **`purgeExpired` deletes on the ceiling only**, never on `idleExpiresAt`: a rotated row keeps the
  idle deadline it was given, so purging on it would remove the older links of a live chain, and
  replaying one would read as `unknown` rather than `reused` — detection silently shrinking to the
  last three days.

The refresh cookie is scoped to `${API_PREFIX}/auth`, so the browser never attaches the long-lived
secret to an ordinary API call. Moving the routes out from under that prefix would break renewal
silently — the e2e suite asserts the path.

`src/seed.ts` compiles to `dist/seed.js`, which `install.sh` already detects and runs. **The demo
account is identified by the request it owns, never by its e-mail address**: keyed on the address,
changing `SEED_LAWYER_EMAIL` would not rename the account but create a second one, leaving the first
reachable with its old password. `DEMO_REQUEST_TITLE` is therefore the marker of the whole
demonstration dataset, and the `upsert`-by-address branch only covers a database whose demo request
was deleted by hand. The rest is idempotent the same way, except for the public link, which is
**revoked and re-created in one transaction** — the PIN is hashed, so a preserved link
could not have its PIN reprinted, and a demonstration link whose PIN nobody knows is worth nothing.
The three `SEED_LAWYER_*` variables are deliberately **not** in `validateEnv`: the API never reads
them, and requiring them would tie its startup to a demo fixture. They are guarded by `${VAR:?}` in
compose and by an explicit non-empty check in the seed — `getOrThrow` accepts an empty string.

## Data model (A2)

Five entities: `Lawyer` → `DepositRequest` → (`RequestedItem` → `UploadedFile`, `PublicLink`).
Four things are counter-intuitive and expensive to relearn:

- **Status is not a column.** `expired` depends on the wall clock, so a stored column would be
  wrong between the expiry instant and whatever job flips it. It is derived: `now > expiresAt` →
  expired, else every item received → complete, else pending. Same for "number of expected items",
  which is `count(RequestedItem)`. Do not "optimise" either into a column.
- **`PublicLink` is a table, not three columns on the request.** Regenerating means revoke +
  insert, so an old PIN cannot survive a regeneration. That invariant rests on a **partial unique
  index written by hand in the migration** (`WHERE "revokedAt" IS NULL`): Prisma cannot express a
  conditional index, and regenerating the migration drops it silently.
- **No secret is stored in clear, the token included.** `tokenHash` is SHA-256 (the token carries
  256 bits, so a fast hash suffices and stays indexable); `pinHash` and `passwordHash` are argon2id
  via `argon2` (`src/crypto/secrets.ts`) with the OWASP parameters `m=19456, t=2, p=1` — measured
  at 67 ms against 312 ms for the library defaults, which were rejected because
  `/public/:token/unlock` is open to an anonymous client and G1 (rate limiting) does not exist yet.
  Consequence: the link is displayed exactly once, at creation.
- **`mimeType` is a `String`**, not an enum: C2 wants the allowed types to be configurable, and a
  Postgres enum would force a migration to change a validation list.

There is no `AccessLog`: the statement classifies the audit log as a bonus (G2), and its cost of
addition will be the same later — unlike `PublicLink`, whose late extraction would have needed a
data migration plus a rewrite of every query touching the token, PIN or expiry.

MinIO keys are prefixed `requests/<requestId>/items/<itemId>/` (`buildStorageKey`) so that object
deletion can work **by prefix** — see § Object storage below for why that is the only workable
option.

`argon2` needs an `argon2: true` entry in `backend/pnpm-workspace.yaml` — pnpm 11 rejects install
scripts by default. It does **not** compile: the package ships `prebuilds/linux-x64/argon2.musl.node`,
which is what `node:22-alpine` needs. If installs ever start taking minutes, check for a `build/`
directory in `node_modules/argon2` — that would mean the prebuild stopped matching.

## Object storage (A3)

MinIO behind `@aws-sdk/client-s3` + `@aws-sdk/lib-storage`. `StorageService` (`src/storage/`) is
`@Global` like `PrismaService`, so business modules do not import `StorageModule`.

Seven things are non-obvious and expensive to relearn:

- **The application never provisions.** `minio-init` (image `minio/mc`, script
  `infra/minio/provision.sh`) creates the bucket, the policy and a restricted user, then exits;
  `StorageService.assertBucketExists()` only checks, and **fails** if the bucket is missing. A3
  shipped the opposite — `ensureBucket()` creating it at boot — and that was wrong three ways: the
  API needed MinIO's *root* credentials, a misspelt `STORAGE_BUCKET` silently created the wrong
  bucket and everything appeared to work, and two replicas booting together raced on
  `CreateBucket`. Do not move creation back into the service; a unit test asserts no
  `CreateBucketCommand` is ever sent.
- **The env prefix says who reads the variable.** `STORAGE_*` is read by the application;
  `MINIO_ROOT_USER`/`MINIO_ROOT_PASSWORD` never are — compose passes them only to `minio` and
  `minio-init`. Verified in the running stack: `process.env.MINIO_ROOT_USER` is `undefined` inside
  the backend, `CreateBucket` answers `AccessDenied`, and `ListBuckets` returns only `portail-depot`.
- **Nothing in the code names MinIO** — only the endpoint knows. That is the whole point of the
  `STORAGE_*` naming: MinIO is an implementation of S3, not the contract. Pointing at
  a managed S3 later is an endpoint change, not a rewrite.
- **The policy has two ARN scopes and that is where silent errors live.**
  `arn:aws:s3:::<bucket>` covers `HeadBucket`/`ListObjectsV2`/`GetBucketLocation`;
  `arn:aws:s3:::<bucket>/*` covers `GetObject`/`PutObject`/`DeleteObject`. `s3:ListBucket` is the
  trap — the SDK call is named `ListObjectsV2`, but it queries the *bucket*, so the permission goes
  on the ARN **without** `/*`. Placed on `/*` it is never found and MinIO answers a detail-free
  `AccessDenied`. Multipart also needs `s3:ListMultipartUploadParts` and `s3:AbortMultipartUpload`,
  which only large files reveal. See `infra/minio/README.md`.
- **`putObject` uses `Upload`, never `PutObjectCommand`.** The latter demands `ContentLength`, which
  in C2 could only come from the client's declared `Content-Length` — the one value that must not be
  trusted. `Upload` needs no size up front and switches to multipart on its own. Do not "simplify"
  it back.
- **`forcePathStyle: true` is hard-coded**, with no env var: MinIO has no virtual-hosted DNS, so
  `bucket.host` does not resolve. Making it configurable would be a knob nobody ever turns.
- **Deletion is by prefix, never by list of keys.** `UploadedFile` cascades with its
  `DepositRequest`, and `storageKey` exists *only* in those rows: once the SQL delete has run, no
  query can say which objects belonged to it and they stay orphaned forever. The prefix
  `requests/<requestId>/` derives from the request id alone. `deleteByPrefix` also **refuses an empty
  prefix** — an empty prefix matches the whole bucket.
- **`DeleteObjects` does not throw on a per-key failure**: it answers 200 with the failures in
  `Errors`. Counting the keys sent would report objects as erased while they are still there, so the
  service raises on `Errors` and counts `Deleted`. This was a real bug caught in review.

`inspectStorage` (`src/config/env.validation.ts`) validates the five variables at startup, parses
`STORAGE_ENDPOINT` with `new URL` and checks the bucket name against the S3 rules. It is called
**before** the explicit-`DATABASE_URL` short-circuit and merged into *both* returns — forgetting the
second one would silently strip the storage configuration whenever a managed database is targeted. A
test covers exactly that. Unlike `inspectUrl`, it has no "names no host" check: `http`/`https` are
WHATWG *special* schemes, so a hostless URL either throws or has its first path segment promoted to
host; the branch would be dead code. `postgresql:` is not special, which is why the check is
reachable there.

**`storage.int-spec.ts` runs under the real restricted policy**, not root: it reads the very same
`infra/minio/app-policy.json`, provisions the ephemeral container with it, and drives the service
with the restricted credentials. That is what makes a missing permission fail in Jest rather than on
a lawyer's first upload — the 12 MB case is the only thing exercising the multipart permissions. Two
of its tests assert the *absence* of privilege (`CreateBucket` denied, other buckets invisible); the
second asserts both that its own bucket is listed and that another is not, so an empty listing
cannot pass it silently.

`testcontainers` pulls three transitive build scripts (`cpu-features`, `protobufjs`, `ssh2`) that
make `pnpm install --frozen-lockfile` exit 1. They are **explicitly refused** (`false`) in
`backend/pnpm-workspace.yaml` rather than allowed: they only compile optional native accelerations
for dockerode's SSH transport, which testcontainers does not use — it talks to the local unix socket.

## Ports and API prefix

`PORT` (21610), `API_PREFIX` (`/api/v1`) and `BIND_ADDRESS` are **required and have no fallback** —
`validateEnv` rejects a missing one, and `main.ts` reads them through `ConfigService`. A
`process.env.PORT ?? 3000` made the API listen outside the assigned range as soon as the variable
was absent.

**`BIND_ADDRESS` is load-bearing**: `app.listen(port)` with no address listens on `0.0.0.0`, which
made the API reachable around the proxy on a shared machine. It is `127.0.0.1` on the host and
`0.0.0.0` in the container (isolated network, no published port, and nginx must reach the service).

Three files freeze these values and must change together, since nginx does not read the
environment: `.env`, `infra/nginx/nginx.conf` and the `healthcheck` in `infra/docker-compose.yml`.
In `nginx.conf`,
`proxy_pass http://backend:21610` carries **no trailing slash** — a trailing slash would strip the
prefix Nest now serves itself, and everything would 404. The `deny all` rule targets
`= /api/v1/health`: desynchronising it breaks nothing visible, it just makes the probe public
again.

## Persistence

PostgreSQL 17 + **Prisma 7**, with `@prisma/adapter-pg`. `PrismaService` is `@Global`, so business
modules do not need to import `PrismaModule`.

Four things about this setup are non-obvious and easy to break:

- **The generated client lives in `backend/src/generated/prisma/`, not in `node_modules`.** That is
  what makes it survive `pnpm prune --prod`: `tsc` compiles it into `dist/`, out of reach of the
  prune. It is gitignored and regenerated by `pnpm build` — never commit it, a committed client
  drifts from the schema silently.
- **Prisma 7 forbids `url` in `schema.prisma`** (error P1012). The connection string reaches the
  CLI through `backend/prisma.config.ts` and the runtime through the adapter. That file stays
  **TypeScript even though it ships in the runtime image**: the CLI loads it through jiti, which
  arrives via `prisma → @prisma/config → c12 → jiti`, all production dependencies, and transpiles TS
  itself. The `typescript` package is indeed pruned, but it is not what loads this file. (An earlier
  version of this document claimed the opposite and the config was needlessly converted to JS.)
  It imports `buildDatabaseUrl` from `src/config/` — from the *sources*, because `pnpm build` runs
  `prisma generate` before `nest build`, so `dist/` does not exist yet on a fresh clone. That is why
  the Dockerfile copies `src/config` into the runtime image alongside it.
- **`prisma.config.ts` must stay out of `tsconfig.build.json`.** This is the real constraint, and it
  is independent of the extension: if the file enters the compilation, the `rootDir` tsc infers
  widens from `src/` to the package root, the output becomes `dist/src/main.js` and `node dist/main`
  finds nothing. It happened once.
- **Jest needs `moduleNameMapper: {"^(\\.{1,2}/.*)\\.js$": "$1"}`** in both configs. The generated
  client imports with explicit `.js` extensions, which ts-jest does not resolve on its own.

`backend/pnpm-workspace.yaml` also had to allow the `prisma` and `@prisma/engines` build scripts
(see Toolchain).

The e2e suites replace **both** `PrismaService` and `StorageService` with doubles, and
`test/setup-env.ts` sets `DATABASE_URL` and the five `STORAGE_*` — loaded via `setupFiles`, because
`ConfigModule.forRoot()` is evaluated when `app.module.ts` is *imported*, so a `beforeAll` runs too
late. **Any new required variable must be added there**, or every e2e suite fails at import. The
suites therefore need no database, no MinIO and no `.env`.

That also means **they do not prove the real connections work**. For storage, `test/storage.int-spec.ts`
does (testcontainers, real MinIO). For the database there is still no equivalent: `docker compose up`
+ `curl /api/v1/health` is the only proof, and a real test database will be needed with D1.

## Toolchain

**Node 22 and pnpm 11.20.0**, pinned via `packageManager` in all three manifests. pnpm 11 requires
Node >= 22.13, so Node 20 cannot run it at all — `nvm alias default 22` is set. Changing the pnpm
version means changing all three `packageManager` fields, both Dockerfiles' `corepack prepare`
lines, and regenerating both lockfiles (`lockfileVersion: 9.0`) together, never piecemeal.

Two pnpm 11 behaviours the setup has to work around:

- **Build scripts are opt-in.** `backend/pnpm-workspace.yaml` holds `unrs-resolver`, `prisma` and
  `@prisma/engines`
  (written by `pnpm approve-builds`); without it `pnpm install --frozen-lockfile` exits 1 with
  `ERR_PNPM_IGNORED_BUILDS`. That file must be COPYed in the Dockerfile alongside the lockfile.
- **`pnpm run` verifies deps first** and shells out to `pnpm install` when `node_modules` and the
  lockfile disagree. This is why the runtime images call `node` directly instead of `pnpm run`; if
  you ever reintroduce pnpm as an entrypoint, it needs `--config.verify-deps-before-run=false` or
  the container crash-loops.

Two host-level gotchas, if pnpm suddenly resolves to the wrong version: `/usr/local/bin/pnpm` is a
shim from the *system* corepack (0.34.1, root-owned) which cannot launch pnpm 11 — the working shim
is the one installed into nvm's Node 22 `bin/`. And the shell profile exports `PREFIX`, which makes
`nvm use` refuse to run until it is unset.

## Context

"Exercice 2 — Portail dépôt", part of the `div-protocol-internship` delivery. The git repository is
the parent directory (`div-protocol-internship/`), not this folder; it has no commits yet, so
`exo2-portail-depot/` is currently untracked.

Deployed at: https://sephorah-aniambossou.stage2-div.rayan-drissi.com

## Deliverable requirements

The README must ultimately document: setup, architecture with justified choices, data model, test
strategy, observability scope with rationale for the chosen metrics, and known limitations. Keep
these sections in mind when making design decisions — the reasoning behind a choice is part of the
deliverable, not just the code.
