# A8 (première tranche) — `./install.sh` one-click, et configuration par `DB_*`

_2026-08-07_

## Besoin

L'énoncé décrit le tout premier test de la soutenance :

> « On clone ton repo sur une machine vierge, on lance `./install.sh`, et on attend. Si a la fin on
> a des URLs cliquables et une app qui marche, tu as passe la premiere porte. Si on doit lire le
> README pour reparer une etape, non. »

et exige du script qu'il fasse « build, demarrage de la stack, migrations, seed, provisioning
Grafana, et affichage des URLs a la fin ». **« install.sh fonctionnel » est un critère
éliminatoire.**

A1 avait creusé un écart : l'API valide sa configuration de base au démarrage et refuse de démarrer
sans elle. Sur une machine vierge il n'y a ni `.env` (gitignoré, seul `.env.example` est versionné)
ni Postgres — et `install.sh` ne montait ni l'un ni l'autre. **Le premier test aurait échoué.**

Cette tranche ne clôt pas A8 : le seed dépend d'A2/B1, Grafana de F1/F2, MinIO d'A3. Elle rend le
one-click vrai sur ce qui existe, et câble les emplacements du reste.

## Le contrat retenu

**À la fin de `./install.sh`, l'application répond.** Pas « les conteneurs sont lancés » : le script
ne rend la main qu'après avoir constaté que le proxy est sain, et il n'y a aucune commande à taper
ensuite.

Deux conséquences qui ont piloté toutes les décisions :

- **L'attente des healthchecks est bloquante et vérifiée**, pas décorative.
- **Ce qui n'existe pas encore ne s'affiche pas.** Tant qu'A2/B1 ne sont pas faits, il n'y a pas de
  compte avocat à seeder : le script n'imprime ni ligne « seed », ni TODO, ni instruction. Le jour
  où le seed existe, il s'exécute et les identifiants s'affichent — sans que la promesse ait jamais
  été fausse entre-temps.

## Décisions et justifications

### `install.sh` ne fait qu'une chose

Il monte la stack docker. L'amorçage nvm + corepack (56 lignes) est **supprimé**, pas déplacé : le
build a lieu dans les images, donc installer Node ferait attendre l'évaluateur pour rien, et un
`scripts/dev-setup.sh` ne servirait qu'à une machine de développement neuve — cas qui ne se
présente pas. Git garde l'historique, et les pièges d'hôte (`PREFIX` à unset, shim corepack système)
restent documentés dans `CLAUDE.md` § Toolchain.

### Docker en cascade plutôt qu'en prérequis

« Machine vierge » ne garantit pas docker, et on ne sait pas si l'évaluateur aura root. Le script ne
parie sur rien :

| Situation | Comportement | Invite ? |
|---|---|---|
| docker utilisable | rien à faire | non |
| démon actif, utilisateur hors du groupe `docker` | bascule sur `sudo docker` pour ce run | non si sudo sans mot de passe |
| root | installation directe | non |
| sudo sans mot de passe | installation via sudo | non |
| sudo avec mot de passe | `sudo -v` **au tout début**, avant le build | une, jamais au milieu |
| ni root ni sudo | **Docker rootless dans `$HOME`** | non |
| rootless impossible (`newuidmap` absent) | échec, commande exacte affichée | — |

Points non évidents :

- **Le groupe `docker`.** Le démon écoute sur `/var/run/docker.sock`, en `root:docker` mode 660 :
  il faut être root ou membre du groupe. Une installation neuve crée le groupe sans y mettre
  personne, et l'appartenance n'est lue qu'à l'ouverture de session — `usermod -aG` ne change donc
  rien pour le shell en cours. D'où `$DOCKER="sudo docker"` pour la fin du run, et le rappel de la
  commande qui rend sudo inutile ensuite.
- **`get.docker.com` plutôt que les paquets de la distribution** : `docker-compose-plugin` manque
  sur les Debian/Ubuntu anciens, et l'ancien `docker-compose` v1 ne convient pas.
- **Ni systemd ni SysV** (conteneur, WSL sans systemd) : le script lance `dockerd` lui-même. Ce cas
  n'était pas prévu au plan ; il est apparu au premier test en conteneur.
- **Rootless** : sa seule limite réelle est l'impossibilité de publier un port < 1024. On publie
  21600, donc sans objet.

### `DB_*` plutôt qu'une `DATABASE_URL` écrite deux fois

C'est la correction de fond du finding 2 de la code review d'A1. Avant, la chaîne de connexion était
définie à deux endroits : en entier dans `.env` pour l'hôte, et **reconstruite par concaténation**
dans `docker-compose.yml` pour le conteneur. Un `DB_PASSWORD` contenant `/`, `#` ou `?` produisait
une URL invalide — `db` démarrait normalement et `backend` échouait sans rapport visible avec le mot
de passe. La seule parade était de le documenter.

Désormais `.env` porte `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, et
`buildDatabaseUrl()` (`backend/src/config/database-url.ts`) assemble l'URL avec
`encodeURIComponent`. `validateEnv` expose le résultat sous `DATABASE_URL`, donc `PrismaService` et
le CLI Prisma continuent de lire la variable qu'ils attendent. Entre l'hôte et le conteneur, seuls
`DB_HOST` et `DB_PORT` changent, et le compose ne surcharge que ces deux-là.

Une `DATABASE_URL` explicite l'emporte toujours : c'est l'échappatoire pour une base managée ou une
base de CI. Dans ce cas elle est **analysée** (`new URL`, puis protocole / hôte / nom de base), pas
comparée à une regex.

### `prisma.config.js` repasse en TypeScript — correction d'une erreur d'A1

A1 avait converti ce fichier en JavaScript sur une justification **fausse** : « un `prisma.config.ts`
exigerait un chargeur TypeScript, que `pnpm prune --prod` a supprimé ». Vérifié dans l'arbre de
dépendances :

```
prisma (dependencies, survit au prune) → @prisma/config → c12 → jiti
```

`jiti` transpile le TypeScript lui-même. Le paquet `typescript` est bien supprimé par le prune, mais
ce n'est pas lui qui charge ce fichier.

La contrainte réelle est indépendante de l'extension : **ce fichier ne doit pas entrer dans la
compilation `tsc`**, sinon le `rootDir` déduit passe de `src/` à la racine du paquet et la sortie
devient `dist/src/main.js`. C'est l'`exclude` de `tsconfig.build.json` qui la traite.

Bénéfice : le fichier **importe** `buildDatabaseUrl` au lieu d'en dupliquer la logique. Il importe
depuis les *sources* et non depuis `dist/`, parce que `pnpm build` lance `prisma generate` avant
`nest build` — sur un clone neuf, `dist/` n'existe pas encore. D'où le `COPY src/config` dans
l'image finale : deux fichiers, contre une seconde implémentation qui pourrait diverger.

### Healthchecks : `start_interval`, et deux services de plus

`frontend` et `proxy` n'avaient pas de healthcheck ; sans eux `install.sh` ne pourrait attendre que
« le conteneur est lancé », ce qui ne prouve rien. `proxy` passe aussi en `depends_on` forme longue
avec `condition: service_healthy`, pour que la première requête ne tombe pas sur un 502.

`start_interval: 1s` (Docker ≥ 25) fait sonder chaque seconde pendant `start_period` au lieu
d'attendre un `interval` complet : un service bascule à `healthy` dès qu'il l'est. Sans lui, le
script attendait un intervalle entier par service pour rien.

### Nommage

Règle du dépôt, appliquée rétroactivement : **identifiants en anglais**, commentaires et messages
utilisateur en français. Les identifiants français introduits par A1 (`problemes`, `analyser`,
`ATTENDU`, `PROTOCOLES`, `creerApp`, `reponse`, `corps`) sont renommés.

## Étapes suivies

1. **A1 commité d'abord** (`1704fcd`, branche `feat/a1-persistance-postgres`) : empiler A8 sur un
   diff non commité aurait rendu les deux code reviews impossibles à distinguer.
2. `backend/src/config/database-url.ts` + `database-url.spec.ts`.
3. `env.validation.ts` réécrit (DB_*, `DATABASE_URL` prioritaire, identifiants anglais) +
   `env.validation.spec.ts`.
4. `prisma.config.js` → `prisma.config.ts`, `tsconfig.build.json` mis à jour.
5. `test/setup-env.ts`, `health.e2e-spec.ts` (renommages).
6. `docker-compose.yml` : `DB_*`, healthchecks `frontend`/`proxy`, `start_interval`, `depends_on`
   long. `docker-compose.dev.yml` suit. `.env.example` réécrit.
7. `install.sh` réécrit.
8. `README.md` (section Démarrage), `CLAUDE.md` (§ install.sh, § Commands, § Docker, § Persistence).

## Vérification

### Le test de l'énoncé, dans ses conditions

Conteneur Ubuntu 24.04 neuf, **sans docker**, dépôt copié, utilisateur non-root :

```bash
docker run --rm --privileged -v /var/lib/docker -v /tmp/portail-src.tgz:/src.tgz:ro ubuntu:24.04 ...
```

| Résultat | |
|---|---|
| docker absent au départ | confirmé (`command -v docker` → rien) |
| docker installé par le script | oui, `get.docker.com`, démon démarré à la main faute de systemd |
| stack montée, quatre services healthy | oui |
| `curl http://127.0.0.1:21600/` | **200** |
| `curl http://127.0.0.1:21600/api/health` | **403** (deny volontaire) |
| durée totale | **4 min 33 s** |

**Piège du harnais de test** : sans `-v /var/lib/docker`, le démon imbriqué fait de l'overlayfs sur
overlayfs et **tous** les builds meurent sur `mount source: "overlay" ... invalid argument`. J'ai
d'abord attribué cette panne au cache BuildKit que j'avais ajouté et je l'ai retiré — à tort, le
message était identique sans lui. C'est le harnais qu'il fallait corriger.

Palier rootless (même conteneur, **aucun sudo**) : la branche est bien empruntée, l'installeur
rootless refuse faute d'`iptables`/modules noyau dans le conteneur, et le script sort en **1** avec
un message encadré indiquant l'alternative. Pas d'échec silencieux.

### Sur cette machine

| Test | Résultat |
|---|---|
| `./install.sh` sans `.env` | `.env` généré, stack montée, URLs affichées |
| `curl :21600/` | **200** |
| `curl :21600/api/health` | **403** ; sonde interne `{"status":"ok","db":"up"}` |
| migrations | `prisma migrate deploy` exécuté à l'entrypoint |
| idempotence (2ᵉ appel) | `.env existant : conserve tel quel`, port « Disponible » (le nôtre) |
| permissions `.env` | **600** |
| `.env` versionné ? | non, `git check-ignore` OK |
| port 21600 pris par un tiers | échec **avant le build**, port et processus nommés, exit 1 |
| `pnpm lint` / `build` | exit 0 |
| `pnpm test` | **30/30** (12 cas neufs sur `buildDatabaseUrl` et `validateEnv`) |
| `pnpm test:e2e` | 4/4 |
| `docker compose config` (prod + dev) | valides |

**Un défaut trouvé et corrigé par la vérification** : `.env` sortait en **644**. `set_env_value`
écrit un fichier temporaire puis le déplace, ce qui réinitialisait le mode posé juste avant. Le
`chmod 600` est passé après les substitutions.

### Durées mesurées

| Cas | Durée |
|---|---|
| Machine vierge sans docker | **4 min 33 s** |
| À froid, docker présent, aucune image ni cache | **2 min 11 s** |
| Images en cache, stack arrêtée | 13 s |
| Stack déjà debout | 5,8 s |

Décomposition du build à froid (1 min 19 s sur les 2 min 11 s) :

| Étape | Durée |
|---|---|
| `pnpm install` backend | 20,8 s |
| `pnpm build` + `prune` backend | 22,6 s |
| `COPY node_modules` backend vers l'image finale | 20,0 s |
| `pnpm install` frontend | 12,3 s |
| `pnpm build` + `prune` frontend | 12,3 s |

Le reste (~50 s) est le pull de `postgres:17-alpine` et `nginx:alpine`, l'`initdb` du volume neuf,
les migrations et les healthchecks. C'est du travail réel : deux installations de dépendances et
deux compilations. **Seule A6 — tirer des images publiées au lieu de les construire — change
l'ordre de grandeur**, et l'énoncé l'exige de toute façon.

Un cache BuildKit sur le store pnpm a été essayé puis retiré : son gain porte sur les rebuilds, que
le parcours one-click ne fait jamais.

## Code review et corrections appliquées

| # | Gravité | Finding | Correctif |
|---|---|---|---|
| 1 | élevé | `install.sh` concluait sur les healthchecks, qui sondent **depuis l'intérieur** des conteneurs : ils prouvent que nginx sert, pas que la publication du port fonctionne depuis la machine — or c'est cela, le contrat | vérification côté hôte avant la bannière (`curl` → HTTP 200, repli `/dev/tcp` en bash pur) |
| 2 | élevé | le démon rootless était lancé en simple `&` : fermer le terminal l'emportait, laissant des conteneurs vivants et une stack impilotable | `setsid nohup … & disown` |
| 3 | moyen | le repli du test de port (`docker run -p …`) confondait « port occupé » et « docker run a échoué » (réseau coupé, image inaccessible) : on aurait envoyé chercher un conflit inexistant | remplacé par une connexion TCP en bash pur, plus honnête sur ce qu'elle prouve |
| 4 | moyen | `set_env_value` ne faisait **rien** si la clé manquait de `.env.example` : `.env` sortait incomplet et l'échec n'apparaissait qu'au démarrage | `exit 3` de l'awk → `die` nommant la clé et la dérive `.env.example` / `install.sh` |
| 5 | moyen | le fichier temporaire de `set_env_value` contenait le mot de passe en clair, créé au umask (644) avant le `chmod 600` final | `umask 077` posé avant toute écriture |
| 6 | faible | `.env.example` absent n'était pas détecté (`cp` échouait avec un message de shell) | contrôle explicite |

**Une régression introduite par le correctif 3, trouvée par le test.** Écrit
`port_state "$HTTP_PORT"; port_status=$?`, l'appel devient une commande simple renvoyant 1 : sous
`set -e` le script s'interrompt **avant** l'affectation, et l'échec « port occupé » devenait
totalement muet — sortie 1 sans message. Corrigé en `port_status=0; port_state … || port_status=$?`,
et le cas est désormais couvert par le test du port occupé, qui vérifie le message *et* le code.

### Vérification des correctifs

| Test | Résultat |
|---|---|
| run nominal | `Le portail repond depuis la machine (HTTP 200)`, **exit 0** |
| port pris par un tiers | message nommant le port et le processus, **exit 1**, avant le build |
| clé retirée de `.env.example` | `la cle DB_USER est absente de .env.example…`, **exit 1** |
| `.env` après génération | **600**, aucun `.env.tmp` résiduel |
| idempotence | exit 0, `.env` conservé |
| machine vierge sans docker (rejoué après corrections) | **exit 0**, portail servi, 5 min 4 s |
| `pnpm lint` / `test` / `test:e2e` | 0 / 30 / 4 |

### Findings signalés, non corrigés

- **Le cache de `sudo -v` expire au bout de ~15 min** (défaut `sudoers`). Sur une machine très lente
  où le build dépasserait ce délai, `sudo docker compose` redemanderait le mot de passe en cours de
  route. Improbable (build mesuré à 1 min 19 s), et le contourner supposerait de garder une session
  sudo vivante en tâche de fond — pire remède que le mal.
- **`port_is_ours` s'appuie sur `docker compose ps -q proxy`**, qui ne liste que les conteneurs en
  cours. Après un `docker compose stop` (et non `down`), un tiers pourrait avoir pris le port sans
  qu'on le voie ; l'échec arriverait alors au `up`, avec le message de docker.
- **`health_of` accepte `running`** pour un service sans healthcheck. C'est volontaire — un service
  futur sans sonde ne doit pas bloquer le script — mais ça affaiblit le contrat en silence si l'on
  retire une sonde existante.

## Limites connues

- **A8 n'est pas close, et ce qui manque est éliminatoire** : le seed (compte avocat de démo + une
  demande) attend A2 et B1. Son emplacement est câblé, le script reste muet en attendant.
- **Grafana, Prometheus et MinIO** ne sont pas dans le compose (F1/F2, A3) : le bloc d'URLs les
  accueillera sans changer de structure.
- **Un seul cas d'échec subsiste sur docker** : ni root, ni sudo, et `newuidmap` absent.
- **`curl | sh` en root** reste une modification système lourde et non réversible par le script.
- **Les branches d'installation de docker ne s'exercent qu'en conteneur**, jamais sur la machine de
  développement : ce sont celles qui rouilleront le plus vite. Les deux scénarios sont écrits dans
  `CLAUDE.md` § install.sh, à rejouer avant chaque rendu.
- **`infra/`** (A5) n'est pas fait : déplacer le compose changera tous les chemins du script, à
  faire d'un bloc avec A5/A6.
- **Aucune vérification de l'espace disque** avant le build (~800 Mo d'images) : docker échouera de
  lui-même, avec un message moins guidé que le reste du script.
