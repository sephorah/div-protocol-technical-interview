# A8 — tenir « machine vierge » jusqu'au bout

Date : 2026-08-08 · Branche : `feat/a8-machine-vierge`

## Le point de départ était une prémisse fausse

La session a commencé sur l'hypothèse que la gestion de « Docker absent » avait été retirée de
`install.sh` et qu'il fallait la remettre. **Vérification faite, c'est faux.** La cascade est
intacte (`install.sh`, § Docker) : docker utilisable → root → sudo sans mot de passe → sudo avec
invite → rootless dans `$HOME` → échec en nommant la commande exacte.

Ce que le commit A8 `64f16fb` a supprimé, c'est le bootstrap **Node/nvm/pnpm**, dans le même commit
— d'où la confusion. Ce retrait était correct : relecture intégrale du script, il n'invoque ni
`node` ni `pnpm` sur l'hôte, les occurrences restantes sont des commentaires et la ligne d'aide
finale.

**Mais la relecture faite pour le prouver a trouvé un vrai trou**, et c'est lui qui a fourni le
travail réel.

## Le défaut : le script exigeait `curl` au lieu de l'obtenir

`ubuntu:24.04` ne livre **ni `curl` ni `wget`**. Le script mourait alors sur :

```
Erreur : curl est requis pour installer docker (apt install curl / dnf install curl).
```

C'est-à-dire une commande à taper à la main, sur la machine même que décrit le critère
« aucune intervention manuelle requise sur machine vierge ». Le contrat du script — « sortie 0 = le
portail répond » — n'était pas tenu.

**Pourquoi trois campagnes de mesures ne l'avaient pas vu** (A8 : 4 min 33 s, A5 : 4 min 14 s,
A6 : 2 min 02 s) : le harnais de test installait `curl` dans le conteneur **avant** de lancer le
script. Il validait donc une machine moins vierge que celle qu'il prétendait simuler. Le défaut
n'était pas dans le script seul, il était dans la façon de le vérifier — d'où le troisième travail
ci-dessous.

Reproduit avant correction :

```
$ docker run --rm -v src.tar:/src.tar:ro ubuntu:24.04 bash -c '... ./install.sh'
==> Verification de Docker
Erreur : curl est requis pour installer docker (apt install curl / dnf install curl).
=== EXIT CODE: 1 ===
```

## Ce qui a été construit

### 1. `ensure_fetcher` et `fetch_url`

Une marche de plus dans la cascade, avec sa philosophie : on ne meurt qu'après avoir épuisé les
options.

- `curl` ou `wget` présent → rien à faire (wget suffit, on n'installe pas par principe) ;
- sinon, installer curl via le gestionnaire détecté parmi `apt-get`, `dnf`, `yum`, `apk`, `zypper`,
  `pacman`, à condition d'avoir root ou sudo ;
- sinon seulement, `die` avec les commandes par distribution.

`fetch_url` regroupe les deux téléchargements qui étaient en dur (`get.docker.com` et son variant
rootless) : sans lui, ajouter le repli wget demandait de modifier chaque site d'appel, et en oublier
un ne se serait vu que sur une machine sans curl.

**Le piège de cette fonction : `apt-get update` avant `apt-get install`.** Sur une Ubuntu nue les
listes de paquets sont vides et `install -y curl` répond `Unable to locate package curl` — un
message qui accuse le paquet alors que c'est l'index qui manque. `ca-certificates` est demandé
explicitement : le premier usage de curl est un `https://`.

`can_sudo` affichait « Docker doit etre installe, ce qui demande les droits administrateur ».
`ensure_fetcher` appelant la même fonction pour curl, le message est devenu général.

### 2. macOS, et `timeout` rendu optionnel

`get.docker.com` n'installe qu'un démon Linux. La cascade y partait quand même et échouait plus loin
sur un message parlant de paquets Linux. Un `uname -s` valant `Darwin` sans Docker joignable meurt
maintenant en nommant Docker Desktop et ses trois étapes.

**`timeout` vient des coreutils GNU et n'existe pas sur macOS.** Écrit en dur dans `port_state`, la
commande absente renvoyait 127, le `if` échouait, et un port **occupé** était déclaré **libre** —
l'échec n'arrivait qu'au `up`, sans nommer le coupable. C'est exactement la dégradation silencieuse
que le commentaire de `port_state` disait vouloir éviter. `tcp_probe` le rend optionnel.

Bug reproduit sur l'ancien code, avec `timeout` retiré du `PATH` :

```
ANCIEN CODE : port 21699 (occupe) declare LIBRE  <- le bug
NOUVEAU     : port ouvert -> OCCUPE (correct) ; port ferme -> libre (correct)
```

### 3. `scripts/test-bare-machine.sh`

La recette du test machine vierge vivait tronquée en commentaire dans `CLAUDE.md`
(`bash -c '...'`), et se reperdait à chaque fois. Elle est maintenant une commande, avec assertions.

**Il n'installe rien dans le conteneur** — c'est tout son intérêt, puisque c'est l'angle mort qui a
laissé passer le trou curl. L'assertion « curl est présent après `install.sh` » est affichée même
quand elle passe : c'est la preuve centrale.

Les deux autres points load-bearing sont consignés dans son en-tête : partir de `git archive HEAD`
et non de l'arbre de travail (un fichier oublié dans un `git add` n'apparaît que comme ça), et
`-v /var/lib/docker` sans quoi le démon imbriqué empile overlayfs sur overlayfs et toute
construction meurt sur `mount source: "overlay" ... invalid argument` — panne qui ressemble trait
pour trait à un bug du projet.

### 4. `$USER` gardé sous `set -u`

Trois messages d'aide utilisaient `$USER` nu. Un `USER` non défini (conteneurs, cron) les
transformait en `USER: unbound variable` — dont la bannière finale, donc **après un déploiement
réussi**. Défaut préexistant, trouvé en relisant, corrigé.

### 5. `DB_USER` et `DB_NAME` dans `.env.example`

`install.sh` y écrivait deux **constantes** (`portail`, `portail_depot`) dans des champs laissés
vides. Rien en elles n'est secret ni propre à la machine, et les laisser vides cassait un parcours
réel : `cp .env.example .env` à la main pour `pnpm db:up` échouait sur
`${DB_USER:?definir DB_USER dans .env}`, sur une valeur indevinable.

Les deux `set_env_default` sont **conservés** : `append_missing_keys` saute toute clé déjà présente
*même vide*, donc eux seuls réparent un `.env` généré avant ce changement. La duplication est
délibérée et commentée.

`MINIO_ROOT_USER` reste généré : c'est la moitié d'un identifiant d'administration du stockage, pas
le nom d'une chose.

La ligne de partage devient : **`.env.example` porte les valeurs non secrètes, `install.sh` génère
les secrets.**

### 6. Ligne de tunnel SSH dans la bannière

En session SSH sans `DOMAIN`, `http://127.0.0.1:21600` désigne le poste de l'utilisateur, pas le
serveur. On ne peut pas afficher l'IP de la machine à la place : le port est lié à la boucle locale
exprès (machine partagée), rien n'y écoute, ce serait une URL morte. La bannière explique et donne
la commande `ssh -L`.

## Ce qui a été écarté, et pourquoi

**Alpine.** Une première version du plan l'écartait au motif qu'il faudrait renoncer à `/dev/tcp` :
c'était faux, et n'aurait valu que pour une réécriture intégrale en POSIX. La technique correcte est
un shebang `#!/bin/sh` et une douzaine de lignes qui obtiennent bash puis `exec bash "$0" "$@"`,
après quoi tout le reste est inchangé — vérifié, `/dev/tcp` est la seule construction bash-only du
script (ni `[[`, ni tableau, ni `<<<`). C'est donc bon marché.

**Écarté quand même parce que ça ne protège de rien** : Alpine est une image de base pour
conteneurs, pas un poste de travail, et toutes les machines plausibles livrent bash. La technique
est consignée dans le README pour que l'ajouter reste une demi-heure et non une réévaluation.

**La détection de désynchronisation `.env` / volume Postgres.** Envisagée après l'incident décrit
plus bas, puis écartée : elle ne peut pas se produire sur une machine neuve, où le `.env` et les
volumes naissent ensemble. C'est un inconfort de développement, pas un défaut du parcours de
l'évaluateur, et `.env.example` le documente déjà.

**La rotation des secrets à chaque lancement.** Question posée en cours de route, réponse non.
Postgres ne lit `POSTGRES_PASSWORD` qu'à l'initialisation d'un volume vide : un installateur qui
régénérerait casserait sa propre base au second lancement, sur toutes les machines. Le comportement
actuel — générer une seule fois, ne jamais écraser une valeur remplie — est le bon, et il a été
vérifié.

## Vérification

| Ce qui est prouvé | Résultat |
|---|---|
| Le trou existait | `ubuntu:24.04` : ni curl ni wget ni git ; `install.sh` sort en **1** sur « curl est requis » |
| Le trou est refermé | `./scripts/test-bare-machine.sh` → **exit 0 en 2 min 28 s**, curl installé par le script, `/` **200**, `/api/v1/health` **403**, `.env` **600** |
| Repli wget | conteneur avec wget seul : `ensure_fetcher` n'installe rien, Docker s'installe via wget |
| `ensure_fetcher`, palier **root** | `id -u` 0 : curl installé via `apt-get`, script poursuivi |
| `ensure_fetcher`, palier **sudo** | utilisateur non privilégié (uid 1001) avec sudo : curl installé via `sudo apt-get`, script poursuivi |
| `ensure_fetcher`, **ni root ni sudo** | même conteneur sans sudo : exit 1, message nommant les trois commandes par distribution — pas d'échec muet |
| Non-régression machine équipée | `./install.sh` ici : **15 s**, cinq services healthy, HTTP 200 |
| Garde macOS | `uname` truqué à `Darwin` : le script meurt en nommant Docker Desktop, exit 1 |
| `timeout` absent | `PATH` amputé : port occupé toujours détecté (l'ancien code le déclarait libre) |
| Bannière SSH | `SSH_CONNECTION` défini → la ligne `ssh -L` apparaît ; absent → elle n'apparaît pas |
| Secrets non régénérés | trois `./install.sh` consécutifs → même `DB_PASSWORD` (`bf657bf910e3`) |
| `.env.example` autoportant | `cp` + secrets seuls → `docker compose config` passe sur le compose dev **et** prod |
| `.env` ancien réparé | `DB_USER=` vide → rempli à `portail` par `set_env_default`, `.env` en 600 |

**Non vérifié** : un vrai macOS (pas de machine disponible — la branche a été exercée en truquant
`uname`, ce qui teste la logique et le message, pas le comportement de Docker Desktop) ; le palier
*rootless* de la cascade Docker, inchangé par ce lot mais non rejoué.

**Trouvé par la relecture du diff, et corrigé** :

- une contradiction dans le README, qui annonçait Alpine couvert « côté paquets » vingt lignes avant
  de dire que le script n'y démarre pas ;
- `INNER="${INNER//PORT/$PORT}"` dans le harnais remplaçait la sous-chaîne `PORT` **partout** : un
  futur `REPORT` serait devenu `RE21600`. Marqueurs `@@PORT@@` / `@@SUBDIR@@` à la place ;
- un commentaire mentionnant `--prefix`, option qui n'est pas utilisée ;
- **le trou de vérification le plus important** : mes deux premiers tests tournaient en root, donc la
  branche `can_sudo` d'`ensure_fetcher` n'avait jamais été exécutée. Les deux paliers manquants ont
  été testés et ajoutés au tableau ci-dessus. « Ça marche sur mon cas de test » n'est pas une
  relecture.

## Deux erreurs de méthode, consignées

**Un harnais de test faux vaut pire qu'aucun test.** Le harnais machine vierge préinstallait curl,
donc trois campagnes de mesures ont certifié un parcours qui échouait. C'est la raison d'être de la
règle « n'installer rien dans le conteneur », écrite en majuscules dans l'en-tête du nouveau script.

**Un diagnostic peut être innocenté à tort par un test trop permissif.** Pendant l'incident du
volume Postgres, un `psql -h 127.0.0.1` lancé *dans* le conteneur `db` a répondu « mot de passe
OK » — l'image postgres est en `trust` sur `127.0.0.1`, donc elle accepte **n'importe quel** mot de
passe. La même connexion depuis un autre conteneur du réseau échouait bel et bien. Conclusion notée
dans `CLAUDE.md` : pour tester une authentification Postgres, se connecter depuis le réseau, jamais
depuis la boucle locale du serveur.

## Incident rencontré (sans lien avec ce lot)

La vérification de non-régression a échoué sur cette machine : backend en boucle sur
`P1000 Authentication failed`. Cause : le volume `pgdata` local avait été créé avec un `DB_PASSWORD`
antérieur à celui du `.env` courant. Postgres ne relit ce mot de passe qu'à l'initialisation d'un
volume vide — comportement déjà documenté dans `.env.example`.

Écarté comme cause : `install.sh` ne régénère pas les secrets (prouvé par trois runs identiques), et
le commit n'a modifié aucune clé de `.env`. Résolu par `down -v` après vérification du contenu
(cinq tables métier à zéro ligne, bucket MinIO vide, aucune donnée métier possible puisque les
modules B/C n'existent pas) et accord explicite.

## Fichiers touchés

- `install.sh` — `fetch_url`, `detect_package_manager`, `install_curl_with`, `ensure_fetcher`,
  `tcp_probe`, garde Darwin, `$USER` gardé, bannière SSH
- `.env.example` — `DB_USER` et `DB_NAME` renseignés, commentaire expliquant pourquoi
- `scripts/test-bare-machine.sh` — nouveau
- `package.json` — `test:bare-machine`
- `CLAUDE.md` — § install.sh, § Commands
- `README.md` — Démarrage, Limites connues
- `issue_backlog.md` — A8, critère 4
