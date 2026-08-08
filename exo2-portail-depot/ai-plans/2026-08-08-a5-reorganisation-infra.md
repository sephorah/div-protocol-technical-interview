# A5 — Réorganisation `infra/`

Branche `refactor/a5-reorganisation-infra`, commit `a421f5f`.

## Point de départ

L'énoncé impose un répertoire `infra/` regroupant compose, reverse proxy, Prometheus et Grafana.
Seul `infra/minio/` respectait déjà la convention ; `docker-compose.yml`, `docker-compose.dev.yml` et
`nginx.conf` étaient à la racine. A6 (images tirées d'un registre) et A7 (HTTPS) en dépendent, et
F1/F2 y déposeront `prometheus/` et `grafana/`.

Le déplacement n'est pas un `git mv`. `docker compose` déduit son **répertoire de projet** du dossier
du premier fichier `-f`, et en tire deux choses : où il lit son `.env`, et le nom du projet. Vérifié
sur cette machine (Compose v2.29.7), avant de décider quoi que ce soit :

| Commande | Résultat |
|---|---|
| `cd /tmp && docker compose -f <racine>/docker-compose.yml config` | OK — `.env` lu **à la racine**, `name: exo2-portail-depot` |
| `docker compose --project-directory /tmp -f docker-compose.yml config`, depuis la racine qui a bien un `.env` | **échec** : `required variable DB_NAME is missing a value` |

Le second cas est le point important : le `.env` du répertoire courant n'est **pas** consulté, seul
celui du répertoire de projet l'est. Tel quel, `docker compose -f infra/docker-compose.yml up` aurait
donc cherché `infra/.env` (absent → échec sur `${VAR:?}`) et nommé le projet `infra`.

## Décisions, et pourquoi

### Où vit le `.env` — il reste à la racine

| Option | Verdict |
|---|---|
| `.env` déplacé dans `infra/` | **Non.** `pnpm dev` fait tourner l'API sur la machine, et `app.module.ts` résout `.env` depuis `__dirname` deux niveaux au-dessus, c'est-à-dire la racine. Il faudrait deux fichiers de secrets, dont un seul renseigné par `install.sh` |
| `--project-directory ..` | **Non.** Le `.env` et les chemins relatifs redeviennent ceux de la racine, mais le fichier compose contiendrait alors `./backend` et `./infra/nginx/nginx.conf` — des chemins qui ne sont pas les siens. Piège de lecture, et cassé au moindre appel sans le drapeau |
| `COMPOSE_FILE=` dans le `.env` de la racine, pour garder un `docker compose up` nu | **Non.** Le test ci-dessus le condamne : le nom du fichier serait éventuellement trouvé, mais l'interpolation lirait toujours `infra/.env`. Trop malin pour ce que ça rapporte |
| **`--env-file .env`, projet = `infra/`** | **Retenu.** Les chemins du fichier sont relatifs à lui-même (`../backend`, `./minio`, `./nginx/nginx.conf`), ce que tout lecteur attend, et c'est la forme que prendra le déploiement A6 |

Coût assumé : la commande canonique devient
`docker compose -f infra/docker-compose.yml --env-file .env <cmd>`, depuis la racine. Elle est écrite
**une fois par consommateur** — une variable `COMPOSE` dans `install.sh`, les scripts `stack:*` et
`db:*` du `package.json`, la bannière finale, `infra/README.md` — jamais recopiée de mémoire.

### Nom de projet explicite, et distinct par stack

`name: exo2-portail-depot` et `name: exo2-portail-depot-dev`, au niveau racine de chaque fichier.

- **Explicite** : déduit du dossier, il vaudrait désormais `infra`, et tous les volumes existants
  deviendraient orphelins. Il le redeviendrait à chaque changement de dossier de checkout — ce que
  fera la machine de production en A6.
- **Inchangé côté production** (`exo2-portail-depot` plutôt qu'un `portail-depot` plus propre) : aucun
  volume de production à reprendre, et `install.sh` reste rejouable sur une machine déjà installée.
  La cosmétique du nom ne vaut pas une manipulation de volumes.
- **Distinct côté dev** : c'est la correction d'un bug préexistant, décrit ci-dessous.

### Bug trouvé au passage : les deux stacks partageaient un nom de projet

Les deux fichiers compose étant à la racine, ils héritaient du **même** nom de projet
(`docker compose ls` le montrait). Un `pnpm db:up` pendant que la production tournait ne montait donc
pas une seconde stack : compose reconnaissait `db`, `minio` et `minio-init` comme les siens, les
trouvait configurés différemment, et les **recréait** avec la configuration de développement — volumes
`_dev` vides et ports 21632 / 21690 / 21691 publiés sur une machine partagée — pendant que le
`backend` de production continuait de tourner contre eux, `frontend` et `proxy` passant pour des
orphelins.

Hors du périmètre littéral de l'issue, mais c'est le déplacement qui obligeait à toucher au nom de
projet ; le corriger ailleurs aurait voulu dire y revenir.

### `infra/nginx/nginx.conf`, pas `infra/nginx.conf`

Un sous-dossier par composant, comme `infra/minio/`. A7 y ajoutera la configuration TLS et les
certificats, F1/F2 créeront `prometheus/` et `grafana/` au même niveau. À plat, il faudrait déplacer
une deuxième fois.

## Ce qui a été fait

| Fichier | Changement |
|---|---|
| `infra/docker-compose.yml` | déplacé ; `name:` ; `build: ../backend` / `../frontend` ; `./minio` ; `./nginx/nginx.conf` ; en-tête expliquant les deux drapeaux |
| `infra/docker-compose.dev.yml` | déplacé ; `name:` avec le scénario de collision en commentaire ; `./minio` |
| `infra/nginx/nginx.conf` | déplacé ; seules les deux commandes citées en commentaire sont mises à jour |
| `infra/README.md` | **nouveau** : contenu du répertoire, commande canonique, les deux pièges, et le test qui prend en défaut un montage `nginx.conf` mal placé |
| `install.sh` | variable `COMPOSE` unique, utilisée aux sept points d'appel ; garde `[ -f infra/docker-compose.yml ]` ; bannière avec la commande complète |
| `package.json` | `db:up` / `db:down` mis à jour ; `stack:up` / `stack:down` / `stack:logs` ajoutés |
| `CLAUDE.md`, `README.md`, `.env.example` | chemins et commandes ; les deux pièges documentés là où ils se paient |
| `issue_backlog.md` | A5 cochée, avec la note sur le nom de projet |

`compose_v2_present()` est la seule exception délibérée à `$COMPOSE` : elle sonde
`docker compose version` et ne doit pas dépendre d'un fichier.

## Tests ajoutés

**Aucun**, et c'est un choix. Les suites existantes ne touchent pas au compose : les e2e remplacent
`PrismaService` et `StorageService` par des doubles, l'intégration provisionne son propre conteneur
MinIO. Un test qui affirmerait « `infra/docker-compose.yml` existe » ne dirait rien de plus que le
`[ -f ... ]` déjà ajouté à `install.sh`, et un test qui lancerait la stack serait `install.sh`
lui-même. Elles ont toutes été rejouées pour vérifier que rien n'avait bougé (113 + 7 + 9).

Le vrai manque de couverture est ailleurs et reste ouvert : rien en CI ne vérifie que le montage de
`nginx.conf` pointe où on croit. D3 en est le bon endroit.

## Vérification

| Ce qui est vérifié | Résultat |
|---|---|
| `compose config` (prod) | `name: exo2-portail-depot`, contextes sur `<racine>/backend` et `/frontend`, montages sur `<racine>/infra/nginx/nginx.conf` et `/infra/minio` |
| `compose config` (dev) | `name: exo2-portail-depot-dev`, ports 21632 / 21690 / 21691 |
| `./install.sh` après un `down` | exit 0, cinq services healthy, **13,2 s** images en cache |
| `GET /` | **200** |
| `GET /api/v1/health` | **403** — la règle `deny all` n'existe que dans notre fichier, donc le montage est bien le nôtre |
| `GET /api/v1/nope` | **404** avec le corps JSON de Nest, pas une page nginx : le proxy passe bien |
| `logs minio-init` | bucket, policy et utilisateur restreint provisionnés |
| `pnpm db:up` stack de production démarrée | `docker compose ls` liste **deux** projets, les cinq conteneurs de production ont des identifiants **inchangés**, `/` répond toujours 200 |
| `pnpm db:migrate` puis `pnpm start:dev` | `{"status":"ok","db":"up","storage":"up"}` sur `:21610` — le chemin `pnpm dev` lit toujours le `.env` de la racine |
| `port_is_ours` | `ss` voit bien 21600 occupé, et le script annonce « Disponible » : la fonction reconnaît notre propre proxy **avec** les nouveaux drapeaux. Sans eux, `docker compose ps -q proxy` répond `no configuration file provided` — le script aurait accusé son propre proxy |
| second `./install.sh` d'affilée | exit 0 en **3,9 s** |
| `pnpm lint` / `test` / `test:e2e` / `test:integration` | 113 + 7 + 9 tests verts, deux lints sans avertissement |
| machine vierge (conteneur privilégié, arbre commité) | voir plus bas |

## Revue de code

| # | Gravité | Constat | Décision |
|---|---|---|---|
| 1 | **moyenne** | `$COMPOSE` n'est pas quoté (`$DOCKER compose $COMPOSE ps`). Un `shellcheck` le signalerait (SC2086) | Assumé et volontaire : le découpage en mots est ce qu'on veut, la valeur est un littéral sans espace ni glob, et c'est la convention déjà en place pour `$DOCKER` (qui vaut parfois `sudo docker`). Une variable tableau serait plus juste mais ferait diverger deux styles dans le même fichier |
| 2 | **moyenne** | Oublier `$COMPOSE` sur un futur appel n'est pas une erreur de syntaxe : la commande viserait un autre projet, et `port_is_ours` cesserait de reconnaître notre proxy en silence | Non corrigé par du code — il n'y a pas d'endroit où le vérifier sans réécrire `install.sh` autour d'une fonction `compose()`. Documenté dans `CLAUDE.md` § install.sh, avec le nombre de points d'appel et l'unique exception |
| 3 | faible | `--env-file .env` échoue si le fichier manque, avec un message de compose et non du script | Sans objet en pratique : l'étape « Configuration (.env) » d'`install.sh` précède tous les appels compose, et les scripts `stack:*` sont un chemin de développement |
| 4 | faible | Les volumes de développement changent de nom (`exo2-portail-depot_*_dev` → `exo2-portail-depot-dev_*_dev`) | Sans conséquence constatée : aucun volume de l'ancien nom n'existait sur cette machine (`docker volume ls`), la stack de dev n'ayant jamais tourné en parallèle. `pnpm db:up && pnpm db:migrate` reconstruit de toute façon |
| 5 | faible | `ai-plans/` conserve d'anciennes références à `docker-compose.yml` à la racine | Volontairement non réécrit : ce sont des documents datés, ils décrivent l'état du dépôt au moment où ils ont été écrits |

Aucun finding bloquant. Les commentaires des anciens fichiers ont été relus un à un plutôt que
déplacés en bloc : ceux qui nommaient un chemin ont été corrigés, ceux qui décrivaient une décision
passée (la concaténation d'URL dans `database-url.ts`) ont été laissés tels quels, ils racontent
l'histoire et non l'état.

## Limites connues

- **Le nom de projet est maintenant dans le fichier**, donc deux déploiements sur la même machine
  partageraient nom et volumes. Sans objet ici (une stack par machine), à revoir en A6.
- **Rien n'empêche la création d'un `infra/.env`.** Il serait couvert par `.gitignore` (`.env.*` et
  `.env`), mais `install.sh` ne le renseignerait pas et l'écart ne se verrait qu'au déploiement.
  Écrit en toutes lettres dans `infra/README.md` et `CLAUDE.md`, pas vérifié par du code.
- **Le montage de `nginx.conf` reste le point de rupture silencieux** de toute réorganisation
  ultérieure : mal placé, nginx sert sa page par défaut, `wget /` répond 200 et `install.sh` conclut
  au succès. Le test qui le prend en défaut (403 sur `/api/v1/health`) est documenté mais n'est
  encore joué qu'à la main.
