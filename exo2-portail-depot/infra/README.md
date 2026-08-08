# `infra/`

Toute l'infrastructure du portail. Aucun code applicatif ici : le code vit dans `backend/` et
`frontend/`, et c'est ce répertoire seul qui sera déposé sur la machine de production (A6).

| Chemin | Rôle |
|---|---|
| `docker-compose.yml` | la stack de production : `db`, `minio`, `minio-init`, `backend`, `frontend`, `proxy` |
| `docker-compose.dev.yml` | la base et le stockage seuls, pour `pnpm dev` (il n'y a pas d'image de dev) |
| `nginx/nginx.conf` | le reverse proxy, unique point d'entrée public |
| `minio/` | provisionnement du stockage objet : bucket, politique d'accès, utilisateur restreint |

Y viendront `prometheus/` (F1) et `grafana/` (F2), au même niveau.

## La commande

**Depuis la racine du dépôt**, jamais depuis ce répertoire :

```bash
docker compose -f infra/docker-compose.yml --env-file .env up -d      # ou pnpm stack:up
docker compose -f infra/docker-compose.yml --env-file .env down       # ou pnpm stack:down
docker compose -f infra/docker-compose.dev.yml --env-file .env up -d  # ou pnpm db:up
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

**Les chemins relatifs de ces fichiers sont relatifs à `infra/`** — `../backend`, `./minio`,
`./nginx/nginx.conf` — puisque c'est le répertoire de projet. C'est aussi pour cela qu'on ne passe
pas `--project-directory ..` : les chemins redeviendraient ceux de la racine, dans un fichier qui,
lui, n'y est plus.

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
