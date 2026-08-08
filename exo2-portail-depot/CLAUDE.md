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
`StorageService`. There is still **no business module and no controller** beyond health — no auth
(B1), no request creation (B2), no upload route (C2), no CI.
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
  stack: `db`, `minio`, `minio-init`, `backend`, `frontend`, `proxy`), `docker-compose.dev.yml`
  (**database and storage only**, for local `pnpm dev` — there is no dev image), `nginx/nginx.conf`,
  `minio/`. `prometheus/` (F1) and `grafana/` (F2) land here too. `infra/README.md` documents the
  two non-obvious consequences of compose not being at the root — see § Docker.
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
docker compose -f infra/docker-compose.yml --env-file .env up --build -d
pnpm stack:up                  # le meme, en plus court
# tout passe par le proxy sur 127.0.0.1:21600
```

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

Both Dockerfiles are two-stage, each building from **its own directory** (`build: ./backend`), with
its own `.dockerignore`. Paths inside are unprefixed (`dist/`, `node_modules/`).

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
`127.0.0.1:21600:80` for everything. Both halves of that are load-bearing — the staging machine is
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

## install.sh

The graders' very first test is `git clone` on a bare machine, `./install.sh`, wait. "If we have to
read the README to repair a step, no." So the script's contract is **exit 0 means the portal
answers**, and nothing it cannot deliver on gets mentioned: there is no "seed pending" line, no
TODO, no instruction. When the seed exists (A2/B1) it runs and prints credentials; until then the
script is silent about it.

It does one thing — the docker stack. Node/nvm/corepack bootstrapping was **removed**, not moved:
the build happens inside the images, so installing Node would make the grader wait for nothing.
`pnpm db:up && pnpm dev` is the development path and assumes Node 22 + pnpm 11 are present.

Docker is handled as a **cascade**, because a bare machine may not have it and `install.sh` cannot
install a system daemon without root: already usable → root → passwordless sudo → sudo with one
prompt (`sudo -v`, called early so the prompt lands before the build, never mid-way) → **rootless
Docker in `$HOME`** → fail naming the exact command. Every docker call goes through `$DOCKER`,
which becomes `sudo docker` when the daemon is up but the user is not in the `docker` group —
group membership is only read at login, so `usermod -aG` cannot help the current shell.
`get.docker.com` is used rather than distro packages: `docker-compose-plugin` is missing from older
Debian/Ubuntu. After install, if neither `systemctl` nor `service` exists (containers, WSL without
systemd), the script starts `dockerd` itself.

**Every compose call goes through `$DOCKER compose $COMPOSE`**, where
`COMPOSE="-f infra/docker-compose.yml --env-file .env"` — one variable, seven call sites (`ps`,
`build`, `up`, `logs`, `exec`, and the two inside `port_is_ours`/`health_of`). Missing one is not a
syntax error: that call would silently target a *different* project (compose would look for a
compose file in the cwd, find none, and either fail or answer about nothing), so `port_is_ours`
would stop recognising our own proxy. The only deliberate exception is `compose_v2_present`, which
probes `docker compose version` and must not need a file. `cd "$(dirname "$0")"` at the top is what
makes both relative paths valid regardless of the caller's cwd.

Four details that are easy to undo by accident:

- **`chmod 600 .env` must come after the value substitutions.** `set_env_value` writes a temp file
  and moves it into place, which resets the mode to the umask. Doing it before leaves `.env` at 644.
- **Port 21600 is checked before the build**, otherwise the failure arrives minutes late. A port held
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
- **The final banner must stay in raw docker commands.** It prints
  `docker compose -f infra/docker-compose.yml --env-file .env down`, not `pnpm stack:down`: the
  script no longer installs Node or pnpm, so the banner cannot tell the grader to run a pnpm script
  they may not have. The heredoc is unquoted (`<<BANNER`), which is what interpolates `$COMPOSE` —
  quoting the delimiter would print the variable name.

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

The bare-machine path can only be exercised in a container, so it is the most likely to rot. Run it
against `git archive HEAD`, not the working tree: a file left out of `git add` shows up there and is
invisible otherwise.

```bash
docker run --rm --privileged -v /var/lib/docker -v "$PWD:/src:ro" ubuntu:24.04 bash -c '...'
```

The `-v /var/lib/docker` is required — without it the nested daemon runs overlayfs on overlayfs and
every build dies with `mount source: "overlay" ... invalid argument`, which looks exactly like a
project bug and is not one.

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
