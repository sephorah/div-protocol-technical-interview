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
| `docker-compose.tls.yml` | calque HTTPS : port 21601, certificat Let's Encrypt, renouvellement (A7) |
| `nginx/nginx.conf` | le reverse proxy en clair, unique point d'entrée public |
| `nginx/nginx-tls.conf` | sa variante TLS, montée par le calque par-dessus la précédente |
| `nginx/portal-locations.conf` | les `location` du portail, inclus par les deux confs |
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

**La visibilité est à vérifier, pas à supposer.** Elle décide de tout : un paquet privé exigerait un
`docker login` sur la machine de staging, donc **un credential de registre déposé sur une machine
partagée avec d'autres candidats**. Publique, elle ne coûte rien ici — le dépôt l'est déjà.

La documentation GitHub annonce qu'un paquet personnel naît **privé** et qu'il hérite des
permissions du dépôt mais *pas* de sa visibilité. **Ce n'est pas ce qui s'est produit** : au premier
push, les deux paquets étaient immédiatement tirables anonymement (constaté avec un jeton anonyme du
registre, sans aucune credential docker). Ne pas s'y fier pour autant — le contrôle prend deux
secondes, et un 403 ressemble en tout point à une image inexistante :

```bash
docker logout ghcr.io
docker pull ghcr.io/sephorah/exo2-portail-depot-backend:0.1.0   # doit réussir
```

Si ça échoue : Packages → le paquet → Package settings → Danger Zone → Change visibility → Public,
pour **chacun des deux**. Ne pas passer par le réglage de compte *Packages → Package creation →
default visibility* : il vaudrait pour **tous** les futurs paquets du compte, dépôts privés compris.
À sens unique dans les deux cas — un paquet public ne redevient jamais privé.

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
git sparse-checkout set --no-cone '/exo2-portail-depot/infra/**' \
                                  '/exo2-portail-depot/.env.example' \
                                  '/exo2-portail-depot/install.sh'
cd exo2-portail-depot && ./install.sh
```

**`--no-cone` n'est pas décoratif.** Le mode *cone*, qui est le défaut, ne sait sélectionner que des
**répertoires** : la même commande sans lui échoue sur `'exo2-portail-depot/.env.example' is not a
directory`, et l'ajouter `--skip-checks` ne fait que traiter le fichier comme un dossier — il ne
serait pas extrait. Le mode `--no-cone` accepte les motifs façon `.gitignore`, d'où les `/` initiaux
et le `**`.

`find . -name '*.ts' | wc -l` doit répondre `0`. Mettre à jour, c'est `git pull` puis `./install.sh`
— cette machine n'a ni Node ni pnpm, donc pas les scripts `pnpm stack:*`, et `install.sh` enchaîne
de toute façon le `pull` et le `up`.

## HTTPS Let's Encrypt (A7)

Le proxy de la machine relaie le `:80` par le `Host` et le `:443` **en passthrough TLS** vers
`127.0.0.1:21601` : il ne déchiffre rien, il lit le SNI et recopie les octets. Le certificat, la clé
privée et la terminaison TLS sont donc entièrement chez nous.

**L'interrupteur est `DOMAIN` dans `.env`**, pas un drapeau. Vide — poste de développement, machine
de l'évaluateur — le portail reste en clair sur `127.0.0.1:21600` et rien de ce qui suit n'existe.
Renseigné, `install.sh` ajoute `docker-compose.tls.yml`, obtient le certificat et publie le 21601.
Un drapeau aurait dû être retapé à chaque redéploiement, et l'oublier une fois aurait fait retomber
le portail en clair sans que rien ne le signale.

| Fichier | Rôle |
|---|---|
| `nginx/portal-locations.conf` | les `location` du portail, **inclus** par les deux confs — jamais dupliqués |
| `nginx/nginx.conf` | serveur `:80` en clair + le challenge ACME |
| `nginx/nginx-tls.conf` | serveur `:80` (challenge + 301) et serveur `:443` ; **remplace** le précédent |
| `docker-compose.tls.yml` | port 21601, montages TLS, boucle de rechargement nginx, service `certbot` |

### La séquence, sur la machine

```bash
# 1. renseigner DOMAIN, ACME_EMAIL, et ACME_STAGING=1 pour l'essai
./install.sh          # certificat de TEST, aucun quota entamé
# 2. ACME_STAGING=0, puis
./install.sh          # le certificat de test est supprimé, le vrai est émis
```

**L'essai en staging n'est pas optionnel** : la production plafonne à 5 certificats identiques par
semaine, donc quatre erreurs de configuration grillent le domaine pour sept jours. Le certificat de
test n'est reconnu par aucun navigateur, ce qui est exactement le point — il valide le mécanisme,
pas la confiance.

### Trois choses non devinables

**L'amorçage passe par la pile en clair.** nginx **refuse de démarrer** si `ssl_certificate` désigne
un fichier absent : impossible donc de démarrer en TLS pour obtenir le certificat qui permettrait de
démarrer en TLS. `install.sh` monte la pile en clair, laisse certbot obtenir le certificat **au
travers d'elle** (méthode `--webroot` : certbot dépose le jeton dans le volume `certbot_www`, c'est
nginx, déjà en marche, qui le sert), puis redémarre avec le calque. C'est pourquoi le
`location /.well-known/acme-challenge/` existe dans les **deux** confs — dans la conf TLS il précède
la redirection 301, sans quoi les *renouvellements* échoueraient, Let's Encrypt sondant toujours en
clair.

**Le certificat s'appelle `portail`, pas le domaine** (`certbot --cert-name portail`). C'est ce qui
permet à `nginx-tls.conf` de ne nommer le domaine nulle part : nginx ne lit pas l'environnement, et
le mécanisme de templates de l'image officielle est hors-jeu ici — ses scripts
`/docker-entrypoint.d/` ne s'exécutent que si la commande à lancer est `nginx`, or le calque la
remplace par un `sh -c` pour la boucle de rechargement. `DOMAIN` reste donc une source de vérité
unique, dans `.env`.

**Le rechargement est périodique, pas déclenché.** `certbot` tourne dans un autre conteneur : son
`--deploy-hook` ne peut pas signaler nginx sans le socket docker, qu'on refuse de monter — c'est un
accès root déguisé sur une machine partagée. nginx se recharge donc toutes les 6 h, et certbot tente
un renouvellement toutes les 12 h. `certbot renew` est un **no-op tant qu'il reste plus de 30 jours**
avant l'échéance : aucun quota consommé, rien de réécrit.

### Vérifier

```bash
D=sephorah-aniambossou.stage2-div.rayan-drissi.com
curl -I "https://$D"                                    # 200
curl -I "http://$D"                                     # 301 vers https
curl -s -o /dev/null -w '%{http_code}\n' "https://$D/api/v1/health"   # 403, la sonde reste privée
openssl s_client -connect "$D:443" -servername "$D" </dev/null 2>/dev/null | grep -E 'issuer|Verify'

# le renouvellement, sans toucher au certificat réel :
docker compose -f infra/docker-compose.yml -f infra/docker-compose.tls.yml --env-file .env \
  run --rm --entrypoint certbot certbot renew --dry-run
```

Le `403` sur la sonde est le même test qu'en clair et pour la même raison : il prouve que c'est
**notre** configuration qui est chargée. En HTTPS il prouve en plus que l'extraction des `location`
n'a pas laissé la sonde en libre accès de ce côté-là.

Revenir en arrière : vider `DOMAIN` dans `.env` et relancer `./install.sh`. Le certificat reste dans
le volume (un `down` sans `-v` le préserve — c'est ce qui évite de rentamer les quotas), mais les
navigateurs déjà venus resteront bloqués sur HTTPS pendant la durée du HSTS, 180 jours.

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
