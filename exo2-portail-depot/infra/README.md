# `infra/`

Toute l'infrastructure du portail. Aucun code applicatif ici : le code vit dans `backend/` et
`frontend/`, et c'est ce répertoire seul — plus `.env` — qui vit sur la machine de production.
Depuis A6, `docker-compose.yml` ne construit plus rien : les images sont **publiées sur GHCR** par
`.github/workflows/exo2-publish-images.yml` et **tirées** par la machine.

| Chemin | Rôle |
|---|---|
| `docker-compose.yml` | la stack de production : `db`, `minio`, `minio-init`, `backend`, `frontend`, `proxy`. **Il ne construit rien**, il tire |
| `docker-compose.build.yml` | calque qui réintroduit les `build:`, pour essayer ce compose avant de publier |
| `docker-compose.dev.yml` | la base et le stockage seuls, pour `pnpm dev` (il n'y a pas d'image de dev) |
| `nginx/nginx.conf` | le reverse proxy, unique point d'entrée public |
| `minio/` | provisionnement du stockage objet : bucket, politique d'accès, utilisateur restreint |

Y viendront `prometheus/` (F1) et `grafana/` (F2), au même niveau.

## La commande

**Depuis la racine du dépôt**, jamais depuis ce répertoire :

```bash
docker compose -f infra/docker-compose.yml --env-file .env pull       # ou pnpm stack:pull
docker compose -f infra/docker-compose.yml --env-file .env up -d      # ou pnpm stack:up
docker compose -f infra/docker-compose.yml --env-file .env down       # ou pnpm stack:down
docker compose -f infra/docker-compose.dev.yml --env-file .env up -d  # ou pnpm db:up
```

Une **version** particulière se demande par `IMAGE_TAG`, dont le défaut est écrit dans le compose :

```bash
IMAGE_TAG=sha-1a2b3c4 docker compose -f infra/docker-compose.yml --env-file .env up -d
```

Les deux pièges tiennent au fait que les fichiers compose ne sont pas à la racine. Aucun des deux
n'est devinable, et le second est silencieux.

**`--env-file .env` n'est pas facultatif.** Compose déduit son *répertoire de projet* du dossier du
premier `-f`, et c'est là qu'il cherche son `.env` — donc `infra/.env`, qui n'existe pas. Le `.env`
vit à la racine parce que `pnpm dev` fait tourner l'API sur la machine et que `app.module.ts` l'y
résout depuis `__dirname`. En avoir un second ici, que `install.sh` ne renseignerait pas, est
exactement l'écart qui ne se voit qu'en production : **ne pas créer `infra/.env`**. Sans le drapeau,
l'échec est au moins bruyant — `${VAR:?}` nomme la première variable manquante.

**Le nom de projet est écrit dans chaque fichier** (`name:`), et pas déduit du dossier. Déduit, il
vaudrait `infra`, et tous les volumes existants deviendraient invisibles. Les deux fichiers en
portent un **distinct** — `exo2-portail-depot` et `exo2-portail-depot-dev` : quand ils étaient tous
deux à la racine, ils partageaient le même, si bien qu'un `pnpm db:up` pendant que la production
tournait ne montait pas une seconde stack mais recréait `db` et `minio` de la production avec la
configuration de développement, volumes vides et ports publiés compris.

**Les chemins relatifs de ces fichiers sont relatifs à `infra/`** — `./minio`, `./nginx/nginx.conf`,
et `../backend` dans le seul calque de build — puisque c'est le répertoire de projet. C'est aussi
pour cela qu'on ne passe pas `--project-directory ..` : les chemins redeviendraient ceux de la
racine, dans un fichier qui, lui, n'y est plus.

## Les images (A6)

`docker-compose.yml` **tire**, il ne construit pas. Les deux images sont publiées sur GHCR par
`.github/workflows/exo2-publish-images.yml` (à la racine du dépôt git, pas ici) :

| | |
|---|---|
| Images | `ghcr.io/sephorah/exo2-portail-depot-backend`, `…-frontend` |
| Tag `X.Y.Z`, `X.Y` | posés par un tag git `exo2-vX.Y.Z` — c'est ce qu'épingle la production |
| Tag `sha-<court>`, `edge` | chaque push sur `main` |

GHCR plutôt que Docker Hub pour trois raisons, dont une décisive : le `GITHUB_TOKEN` du run
authentifie sans secret à gérer, les permissions sont celles du dépôt, et surtout Docker Hub
plafonne les pulls anonymes à **100 par 6 h et par IP** — or la machine de staging est partagée avec
d'autres candidats, donc son adresse IP aussi.

**Une manipulation manuelle, une seule fois.** Un paquet GHCR naît **privé** : il hérite des
permissions du dépôt, *pas* de sa visibilité, et aucun endpoint de l'API ne change cela. Après le
premier push, passer **les deux paquets** en *Public* dans leurs Settings — sans quoi un `pull`
anonyme répond 403, ce qui ressemble en tout point à une image inexistante. Le réglage de compte
*Packages → Package creation → default visibility* le ferait automatiquement, mais il vaudrait pour
**tous** les futurs paquets du compte, dépôts privés compris : écarté délibérément. La visibilité
publique est ce qui évite de déposer un credential de registre sur une machine partagée ; elle est
sans coût ici, le dépôt étant lui-même public. À sens unique : un paquet public ne redevient jamais
privé.

Vérifier que c'est bien fait :

```bash
docker logout ghcr.io
docker pull ghcr.io/sephorah/exo2-portail-depot-backend:0.1.0   # doit réussir
```

### Essayer ce compose avant de publier

Il ne sait que tirer : sa première exécution demanderait donc une image qui n'existe pas encore.
Le calque construit les mêmes images **sous leur nom GHCR**, que docker préfère au registre :

```bash
./install.sh --from-source   # construit avec le calque, démarre avec le compose de PRODUCTION
```

Ce que ça prend en défaut, c'est le compose — nom d'image, variable perdue en retirant `build:`,
montage déplacé — pas le code, dont les tests s'occupent. Et ce n'est **pas** la vérification
finale : une image reconstruite en local n'est pas l'artefact déployé (autre instant, autre cache,
autre index de paquets). Avant de poser un tag de version, on fait tourner celle que le CI a
publiée, avec `IMAGE_TAG=sha-<court>`.

## Déploiement : la machine sans code source

L'énoncé l'exige — sur la machine ne vivent que compose, nginx, `.env`. Un `git clone` partiel suffit
et garde la traçabilité de version, là où un `scp -r infra` la perd :

```bash
git clone --filter=blob:none --sparse https://github.com/sephorah/technical-interview.git
cd technical-interview
git sparse-checkout set exo2-portail-depot/infra \
                        exo2-portail-depot/.env.example \
                        exo2-portail-depot/install.sh
cd exo2-portail-depot && ./install.sh
```

`find . -name '*.ts' | wc -l` doit répondre `0`. Mettre à jour, c'est `git pull` puis `./install.sh`
— cette machine n'a ni Node ni pnpm, donc pas les scripts `pnpm stack:*`, et `install.sh` enchaîne
de toute façon le `pull` et le `up`.

## Vérifier un déplacement de fichier

`docker compose ... config` résout les chemins en absolu : c'est la façon la moins coûteuse de
constater qu'un montage pointe où on croit.

Une erreur en particulier ne se voit pas autrement : si le montage de `nginx/nginx.conf` tombe à
côté, nginx sert sa page d'accueil par défaut, le healthcheck `proxy` (`wget /`) passe, et
`install.sh` conclut « le portail répond ». Le test qui le prend en défaut est le 403 sur
`/api/v1/health`, la règle `deny all` n'existant que dans *notre* configuration :

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:21600/               # 200
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:21600/api/v1/health  # 403
```
