# A1 — Base de données PostgreSQL et couche de persistance

_2026-08-07_

## Besoin

`issue_backlog.md` § A1, priorité **P0**. Le portail n'avait aucune persistance : le backend
était le template NestJS nu, `AppModule` n'importait rien, et `docker-compose.yml` ne
connaissait que `backend`, `frontend` et `proxy`.

A1 **bloque A2, B1, B2, C1, C2** — c'est-à-dire tout le métier. Rien d'utile ne peut être
écrit tant qu'il n'existe pas de moyen de stocker un avocat, une demande ou un fichier.

Ce chantier ne livre **aucune entité métier** : le modèle de données est l'objet d'A2. Il
livre la plomberie — un Postgres conteneurisé, un ORM branché, une chaîne de migrations jouée
au démarrage — et la preuve que cette plomberie fonctionne de bout en bout.

Critères d'acceptation repris de l'issue :

- [x] Service `db` dans le compose, volume nommé, healthcheck
- [x] ORM configuré côté NestJS, connexion lue depuis l'env
- [x] Migrations versionnées, jouées au démarrage
- [x] Un `docker compose up` sur machine vierge donne un schéma prêt — *avec la réserve
      documentée plus bas : le schéma est vide de tables métier, donc c'est la chaîne qui est
      prouvée, pas une table.*

## Décisions et justifications

| Sujet | Choix | Pourquoi |
|---|---|---|
| SGBD | **PostgreSQL 17**, conteneurisé (`postgres:17-alpine`) | ACID et intégrité stricte — détaillé ci-dessous |
| ORM | **Prisma 7** + `@prisma/adapter-pg` | Sûreté de typage, peu de boilerplate, migrations traitées sérieusement |
| Moteur Prisma | `engineType = "client"` | Pas de moteur binaire : tout passe par l'adaptateur pg. Une dépendance native de moins à faire survivre au `pnpm prune --prod` |
| Client généré | `backend/src/generated/prisma/`, hors `node_modules` | C'est ce qui le fait survivre au prune : `tsc` le compile dans `dist/` |
| Première migration | **Vide de tables métier** | Frontière nette avec A2 |
| Postgres en dev | `docker-compose.dev.yml`, service `db` seul | `pnpm dev` continue de tourner sur l'hôte avec son hot-reload |
| Migrations en prod | `prisma migrate deploy` à l'entrypoint du conteneur backend | Un `docker compose up` suffit, sans étape manuelle |

### Pourquoi PostgreSQL

**Conformité ACID et intégrité stricte des données.** Ce n'est pas un argument générique ici :
le domaine est le dépôt de pièces juridiques, où une donnée à moitié écrite est un dossier
faux. Deux endroits du produit en dépendent directement.

- Un dépôt de pièce écrit un objet dans MinIO **et** une ligne de métadonnées (A3/C2). La
  transaction garantit qu'on ne se retrouve pas avec une pièce comptée comme reçue alors que
  le fichier n'existe pas, ni l'inverse.
- **L'intégrité déclarative** — clés étrangères, `UNIQUE` sur le token public, `NOT NULL`,
  `CHECK` — fait porter les invariants par la base plutôt que par la discipline du code. Vérifier
  en code avant d'insérer ne protège de rien : entre la lecture et l'écriture il s'écoule du
  temps, et deux requêtes concurrentes peuvent passer le même contrôle avant que l'une ait
  écrit. Une contrainte `UNIQUE` déplace la vérification dans la base, où elle est faite au
  moment exact de l'écriture, de façon indivisible. Un token public en double devient
  impossible, pas seulement improbable ; une pièce ne peut pas rester rattachée à une demande
  supprimée.

Ces garanties écartent d'emblée un store documentaire sans transactions multi-documents.

**Face à SQLite**, l'argument n'est pas la charge : à l'échelle réelle de ce projet — un avocat
de démo et un évaluateur — SQLite tiendrait sans broncher. Deux autres raisons pèsent davantage.

- *La parité entre développement et production.* Une base fichier dans un conteneur, c'est un
  volume à gérer, une sauvegarde à écrire soi-même, et aucun outil standard pour inspecter les
  données en production. Postgres apporte les trois par défaut.
- *Le dialecte.* SQLite a un typage dynamique, des `CHECK` limités et pas de vrai
  `timestamptz`. Développer dessus puis basculer sur Postgres, c'est découvrir tous les écarts
  au moment de la bascule — au pire moment.

**Face à MySQL/MariaDB**, le choix tient à la rigueur par défaut : types plus stricts,
transactions DDL (une migration qui échoue est annulée en entier), contraintes réellement
appliquées.

### Pourquoi Prisma

- **Sûreté de typage.** Le client est généré depuis le schéma : une colonne renommée casse à la
  compilation, pas à l'exécution. Le lint backend tourne en `recommendedTypeChecked` et bloque
  au moindre warning — un ORM qui renvoie du `any` y serait un frein permanent.
- **Peu de boilerplate.** Le schéma est déclaré une fois, dans un fichier lisible ; ni entités
  décorées, ni repositories à écrire pour les cas simples.
- **Intuitif.** Le schéma se relit sans connaître l'outil, ce qui compte pour la section
  « modèle de données » du livrable (H1) : la documentation et la source sont le même fichier.
- **Migrations traitées sérieusement.** `migrate dev` génère du SQL versionné et relisible,
  `migrate deploy` le rejoue de façon déterministe en production. C'est exactement ce que
  demandent les critères « migrations versionnées » et « jouées au démarrage ».

## Le point traité honnêtement : « schéma prêt » sans aucune table

Avec un `schema.prisma` réduit au `generator` et au `datasource`, `prisma migrate dev` ne
génère **aucun fichier** — il n'y a rien à migrer. Le critère « un `docker compose up` donne un
schéma prêt » ne peut donc pas être prouvé par l'existence d'une table.

Cocher la case sans preuve aurait été malhonnête. A1 livre à la place une preuve d'exécution
réelle : un endpoint **`GET /health`** qui exécute un vrai aller-retour SQL (`SELECT 1`) à
travers le `PrismaService` et renvoie `{ status, db }`. Un 200 avec `db: "up"` prouve la chaîne
complète — variable d'env lue et validée, adaptateur pg construit, connexion ouverte, requête
exécutée. C'est exactement le périmètre d'A1, sans empiéter sur A2.

Cet endpoint n'est pas jetable : il sert au `healthcheck` Docker du backend, et F1 (métriques
Prometheus) s'appuiera dessus.

## Étapes suivies

1. **Dépendances** — `@prisma/client`, `@prisma/adapter-pg`, `prisma`, `@nestjs/config`,
   `dotenv`. `prisma` est en `dependencies` et non en `devDependencies` : le CLI doit survivre
   au `pnpm prune --prod` pour que l'entrypoint puisse jouer `migrate deploy`.
2. **`backend/pnpm-workspace.yaml`** — `allowBuilds` pour `prisma` et `@prisma/engines` (pnpm 11
   traite un script de build ignoré comme une erreur : `ERR_PNPM_IGNORED_BUILDS`).
3. **`backend/prisma/schema.prisma`** — `generator` (sortie `../src/generated/prisma`,
   `engineType = "client"`) + `datasource postgresql`, sans aucun modèle.
4. **`backend/prisma.config.js`** — la chaîne de connexion du CLI, en JavaScript ordinaire.
5. **`backend/src/config/env.validation.ts`** — `DATABASE_URL` requise et conforme à
   `postgresql://…`, sinon échec au boot en nommant la variable, **jamais sa valeur**.
6. **`backend/src/prisma/`** — `PrismaService` (`OnModuleInit`/`OnModuleDestroy`, adaptateur
   construit depuis `ConfigService.getOrThrow`) et `PrismaModule` en `@Global`.
7. **`backend/src/health/`** — `HealthController` : `SELECT 1`, 200 `{ok, up}` ou 503
   `{error, down}`, l'erreur du driver partant au log et non dans la réponse.
8. **`src/app.module.ts`** — `ConfigModule.forRoot({ isGlobal, envFilePath: ['../.env'],
   validate })`, `PrismaModule`, `HealthModule`.
9. **`src/main.ts`** — `app.enableShutdownHooks()` (dette identifiée depuis deux sessions, cf.
   `2026-08-06-lint-backend-bloquant.md`).
10. **`backend/docker-entrypoint.sh`** — `set -e`, `prisma migrate deploy`, puis
    `exec node dist/main`.
11. **`backend/Dockerfile`** — copie de `prisma/`, `prisma.config.js` et de l'entrypoint dans
    l'image finale ; `ENTRYPOINT ["./docker-entrypoint.sh"]`.
12. **`docker-compose.yml`** — service `db` (volume `pgdata`, healthcheck `pg_isready`),
    `backend` en `depends_on: condition: service_healthy` avec son propre healthcheck sur
    `/health`, `DATABASE_URL` reconstruite dans le compose.
13. **`docker-compose.dev.yml`** (nouveau) — `db` seul, `127.0.0.1:21632:5432`, volume
    `pgdata_dev` distinct.
14. **Tests** — `test/setup-env.ts` (`setupFiles`), `test/health.e2e-spec.ts`, adaptation de
    `app.e2e-spec.ts`.
15. **`.env.example`**, scripts `db:*` à la racine, `.gitignore`, `eslint.config.mjs`,
    `CLAUDE.md`.

### Cinq pièges rencontrés en chemin

- **`ERR_PNPM_IGNORED_BUILDS`** après le `pnpm add`. `pnpm approve-builds` est interactif :
  `pnpm-workspace.yaml` a été écrit directement.
- **La sortie du build a glissé en `dist/src/main.js`**, cassant `node dist/main` — donc
  l'`ENTRYPOINT` et `start:prod`. Cause : `prisma.config.ts`, à la racine du paquet, entrait
  dans la compilation et élargissait le `rootDir` déduit par `tsc` de `src/` à la racine. Corrigé
  par un `exclude` dans `tsconfig.build.json`.
- **Prisma 7 interdit `url` dans le schéma** (P1012). J'avais mis `url = env("DATABASE_URL")`
  pour éviter d'embarquer un fichier de config dans l'image. Refusé. D'où `prisma.config.js`,
  écrit en **JavaScript** et non en TypeScript : il est lu dans l'image de production, où
  `pnpm prune --prod` a supprimé tout chargeur TypeScript.
- **Jest : `Cannot find module './internal/class.js'`** depuis le client généré, qui importe avec
  des extensions `.js` explicites que ts-jest ne résout pas seul. Corrigé par
  `moduleNameMapper: { "^(\\.{1,2}/.*)\\.js$": "$1" }` dans les deux configurations Jest.
- **Les e2e échouaient sur la validation d'env** alors que la variable était posée dans un
  `beforeAll`. `ConfigModule.forRoot()` s'évalue à l'*import* d'`app.module.ts`, donc plus tôt.
  D'où `test/setup-env.ts` chargé par `setupFiles`.

## Sécurité

- Le mot de passe Postgres est généré (`openssl rand -hex 24`) et vit dans `.env`, gitignoré.
  Rien de sa valeur n'est apparu dans la conversation : seules des sorties masquées ont été
  affichées.
- Chaque variable du compose utilise la forme `${VAR:?message}` : un `.env` incomplet fait
  **échouer** `docker compose up` en nommant la variable, au lieu de démarrer un Postgres sans
  mot de passe.
- `env.validation.ts` ne recopie jamais la valeur d'une variable dans un message d'erreur —
  `DATABASE_URL` contient le mot de passe, et un message d'erreur finit dans des logs agrégés
  ailleurs.
- Le message d'erreur du driver ne sort pas dans la réponse HTTP de `/health` (il contient
  l'hôte, le port, la base, parfois l'utilisateur) ; un test le vérifie explicitement.
- Audit demandé de `ai-logs/`, `ai-plans/` et de tous les fichiers suivis par git : **aucun
  secret réel exposé**.

## Vérification

| Test | Résultat |
|---|---|
| `docker compose config --quiet` | exit 0 |
| `docker compose up --build -d` sur volumes vierges | `db` **healthy**, `backend` **healthy** |
| Logs backend | `No migration found`, `No pending migrations to apply`, `Mapped {/health, GET}`, `Nest application successfully started` |
| `curl localhost:8080/api/health` (avant la code review) | `{"status":"ok","db":"up"}`, **200** |
| Persistance : `CREATE TABLE tmp_check` → `down` → `up` | table toujours présente |
| **`docker compose stop db` puis `/api/health`** | `{"status":"error","db":"down"}`, **503** ; retour en 200 après redémarrage |
| `POSTGRES_PASSWORD= docker compose config` | `required variable POSTGRES_PASSWORD is missing a value: definir POSTGRES_PASSWORD dans .env`, exit 15 |
| `docker compose stop backend` | **0,23 s** (arrêt propre, cf. `enableShutdownHooks`) |
| Image lancée sans `DATABASE_URL` | `Configuration d'environnement invalide : - DATABASE_URL est absente ou vide.`, **exit 1** |
| `docker-compose.dev.yml` + `ss -ltn` | `LISTEN 127.0.0.1:21632` — **jamais** `0.0.0.0` |
| `prisma migrate deploy` depuis l'hôte | lit bien `../.env` via `prisma.config.js` |
| `node dist/main` sur l'hôte contre la base de dev | `{"status":"ok","db":"up"}`, 200 |
| `pnpm lint` / `pnpm build` | exit 0 / exit 0 |
| `pnpm test` / `pnpm test:e2e` | 1/1 et 4/4 |
| Tailles d'images | backend 490 Mo, frontend 292 Mo |

Les chemins d'échec sont le cœur de cette vérification : un `/health` qui répondrait 200 alors
que la base est tombée serait pire qu'absent — c'est ce que consomment le healthcheck Docker et,
plus tard, les alertes Grafana (F2).

Conteneurs et volumes détruits ensuite (`docker volume ls | grep pgdata` → vide).

## Code review et corrections appliquées

La relecture du diff a produit huit findings, tous corrigés dans la foulée.

| # | Gravité | Finding | Correctif |
|---|---|---|---|
| 1 | élevé | `proxy` publiait `8080:80`, donc sur `0.0.0.0` et hors plage, sur une machine partagée | `127.0.0.1:21600:80` |
| 2 | élevé | `DATABASE_URL` reconstruite dans le compose : un `POSTGRES_PASSWORD` contenant `/`, `#`, `?` ou `%` produit une URL inanalysable | avertissement sur `POSTGRES_PASSWORD` dans `.env.example` (+ `openssl rand -hex 32` prescrit) et détection au démarrage par la validation |
| 3 | moyen | l'avertissement d'encodage n'était que sur `DATABASE_URL`, alors que `POSTGRES_PASSWORD` sert aux deux usages | les deux blocs de `.env.example` le disent, et expliquent pourquoi les deux écritures peuvent diverger |
| 4 | moyen | `envFilePath: ['../.env']` était relatif au cwd : `node backend/dist/main` depuis la racine cherchait le `.env` du parent du dépôt | chemin dérivé de `__dirname` |
| 5 | moyen | `/api/health` public : publiait l'état de la base à qui scanne | `location = /api/health { deny all; }` dans nginx — les deux consommateurs sont internes |
| 6 | faible | la regex `^postgres(ql)?:\/\/.+` acceptait `postgresql://x` | `new URL` + contrôle du protocole, de l'hôte et du nom de base |
| 7 | faible | `.dockerignore` n'excluait pas `src/generated/` | exclu : un client périmé ne peut plus entrer dans le contexte de build |
| 8 | faible | `migrate deploy` à chaque démarrage, donc à chaque réplique | documenté dans l'entrypoint (verrou consultatif Prisma, à sortir dans un job dédié si l'API est répliquée) |

Le findings 2 et 6 se corrigent au même endroit : remplacer la comparaison à une expression
régulière par une vraie analyse d'URL fait des deux cas un échec au démarrage, nommé, plutôt
qu'une erreur de driver plus tard.

**Compromis assumé sur le finding 5.** `deny all` rend la sonde inconsultable depuis l'extérieur,
y compris pour moi sur staging. C'est voulu : ses deux consommateurs — le `healthcheck` docker,
qui tape `127.0.0.1:3000/health` dans le conteneur, et Prometheus (F1) — sont sur le réseau
interne. La consultation manuelle passe par `docker compose exec`, documenté dans `nginx.conf`.

### Vérification des correctifs

| Test | Résultat |
|---|---|
| `ss -ltn` après `up` | `LISTEN 127.0.0.1:21600` — plus rien sur 8080 ni sur `0.0.0.0` |
| `curl 127.0.0.1:21600/` | **200** (front servi) |
| `curl 127.0.0.1:21600/api/health` | **403** (deny) |
| `/health` depuis le conteneur backend | `{"status":"ok","db":"up"}` |
| healthcheck docker du backend | `healthy` |
| Image lancée avec `DATABASE_URL=postgresql://user:pa/ss@db:5432/portail` | `DATABASE_URL n'est pas une URL analysable — un mot de passe contenant / # ? ou % doit etre encode-URL`, **exit 1** |
| Image lancée avec `postgresql://user:p@db:5432` (sans base) | `DATABASE_URL ne nomme aucune base de donnees`, exit 1 |
| `node backend/dist/main` depuis la racine du dépôt (aucun `.env` dans le parent) | démarre et répond `{"status":"ok","db":"up"}` |
| `pnpm lint` / `pnpm build` | exit 0 / exit 0 |
| `pnpm test` (dont 12 cas neufs sur `validateEnv`) | **14/14** |
| `pnpm test:e2e` | 4/4 |

`backend/src/config/env.validation.spec.ts` couvre les cas de la review, dont celui qui vérifie
qu'un mot de passe présent dans une URL invalide **n'apparaît pas** dans le message d'erreur.

## Allocation de ports retenue

La machine de staging est **partagée** et impose la plage `21600-21699`, en écoute sur
`127.0.0.1` uniquement. L'allocation est décidée maintenant pour ne pas la reprendre à chaque
issue :

| Port | Usage | Issue |
|---|---|---|
| `21600` | proxy nginx, HTTP — **publié depuis la code review d'A1** | A1 |
| `21601` | proxy nginx, HTTPS (443 en passthrough TLS) | A7 |
| `21632` | **Postgres, développement local uniquement** | **A1** |
| `21690+` | Prometheus / Grafana | F1/F2 |

En production, `db` ne publie **aucun** port : seul le proxy publie.

## Limites connues

- **La chaîne de migration est prouvée par `/health`, pas par une table** — conséquence directe
  du choix « migration initiale vide ». La première vraie migration arrive avec A2, et c'est
  elle qui validera définitivement le critère.
- **Pas de base de test dédiée.** Les e2e remplacent `PrismaService` par un double : ils
  prouvent le contrat HTTP de la sonde, pas la connexion réelle. Une base `_test` (ou
  Testcontainers) devient nécessaire avec A2/D1.
- **Le port 21601 (HTTPS, passthrough TLS) n'est pas encore servi.** Le proxy ne termine pas TLS
  et n'a pas de certificat : c'est A7 (certbot, challenge http-01 relayé sur le port 80).
- **Pas de pooling externe** (PgBouncer) : sans objet à cette échelle, une seule instance d'API.
- **Pas de stratégie de sauvegarde/restauration** — hors périmètre A1, à mentionner dans les
  limites du README (H1).
- **`install.sh` ne connaît toujours pas docker** : monter la stack complète en une commande est
  l'objet d'A8.
- **Arrêt propre ≠ requêtes en vol terminées.** `enableShutdownHooks` + `init: true` donnent la
  sortie du processus et la fermeture des connexions Prisma, pas le drainage des uploads en
  cours. Ce sera à traiter quand les uploads existeront (C2).
