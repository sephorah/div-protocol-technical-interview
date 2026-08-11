# A6 — Images Docker publiées sur GHCR et tirées en production

_2026-08-08 — branche `feat/a6-images-publiees`_

## Le problème

L'énoncé interdit le code source sur la machine de staging : « construis ton image ailleurs,
publie-la sur GHCR ou Docker Hub, et ne garde sur la machine que ta configuration (compose,
Makefile, env, conf nginx) ». Or `infra/docker-compose.yml` portait `build: ../backend` et
`build: ../frontend` : la stack ne démarrait que depuis un checkout complet, et `install.sh`
construisait deux images sur chaque machine neuve — 1 min 19 s des 2 min 11 s mesurées.

## Décisions

### GHCR plutôt que Docker Hub

| | GHCR | Docker Hub |
|---|---|---|
| Authentification en CI | `GITHUB_TOKEN` fabriqué pour le run, portée limitée au dépôt | compte + access token en secret de dépôt, à faire tourner |
| Permissions | celles du dépôt (`permissions: packages: write`) | organisations Docker, système parallèle |
| Pulls anonymes | sans limite sur un paquet public | **100 / 6 h par IPv4 ou /64** |
| Rattachement au code | label `org.opencontainers.image.source` | lien manuel |

Le troisième point tranche : la machine de staging est partagée avec d'autres candidats, donc son
adresse IP l'est aussi, et le quota Docker Hub se consommerait à plusieurs sans qu'on sache par qui.
Inconvénient accepté de GHCR : un paquet naît privé, il faut le passer en public une fois.

Sources : [Docker Hub rate limits](https://www.osc.edu/resources/technical_support/known_issues/reached_your_pull_rate_limit_while_pull_from_docker_hub),
[GitLab, mars 2025](https://about.gitlab.com/blog/prepare-now-docker-hub-rate-limits-will-impact-gitlab-ci-cd/),
[Working with the Container registry](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry).

### Paquets publics plutôt que privés + PAT

Un paquet privé imposerait un `docker login ghcr.io` sur la machine de staging, donc **un credential
de registre déposé sur une machine partagée avec d'autres candidats**. Le dépôt
`sephorah/technical-interview` étant déjà public (`gh repo view` → `"visibility":"PUBLIC"`), une
image publique n'expose rien que les sources n'exposent déjà — elle en révèle même moins.

### Tag semver posé par un tag git, et non tag mouvant

`exo2-vX.Y.Z` → images `X.Y.Z` et `X.Y` ; chaque push sur `main` → `edge` et `sha-<court>`. Le
préfixe `exo2-` existe parce que le dépôt héberge plusieurs exercices. Le `sha-` n'est pas
décoratif : c'est lui qui permet de faire tourner **l'artefact réel** avant de poser une version.

### Le défaut de `IMAGE_TAG` est écrit dans le compose, pas dans `.env`

La version appartient au code, pas à la machine. Dans `.env`, `install.sh` ne la réécrirait jamais
(`set_env_default` ne remplit que le vide) : une machine resterait épinglée à une version périmée
sans que rien ne le signale, et la variable tomberait sous la règle des trois fichiers
(`.env.example`, `install.sh`, compose). La surcharger reste possible, et c'est le rollback.

### `install.sh` ne construit pas en repli

Une première version prévoyait de retomber sur un build local si le `pull` échouait. Écartée après
discussion : la machine cible n'a **pas** les sources, le repli ne s'y déclencherait jamais et
masquerait la vraie cause. Le script s'arrête donc en nommant les trois causes réelles (paquet resté
privé, tag inexistant, registre injoignable).

### Le calque s'appelle `docker-compose.build.yml`

Et surtout pas `docker-compose.override.yml`, que compose charge **automatiquement** dès qu'il est
présent dans le répertoire de projet : une stack qu'on croit tirer se mettrait à construire en
silence. Le calque ne réintroduit que les deux `build:`, garde les `image:` du fichier de base — ce
qui tague le build local sous le nom GHCR — et n'est ajouté qu'à la commande `build` : le démarrage
qui suit n'utilise que le compose de production. C'est ce qui rend celui-ci essayable avant toute
publication, sinon sa première exécution demanderait une image qui n'existe pas encore.

### `linux/amd64` seul

Émuler arm64 sous QEMU pour compiler `argon2` ferait passer le job de ~3 min à ~15 min, pour une
plateforme que personne ne déploie. Conséquence assumée : sur un Mac Apple Silicon, les images
tournent en émulation.

## Ce qui a été fait

| Fichier | Changement |
|---|---|
| `.github/workflows/exo2-publish-images.yml` | **nouveau**, à la racine du dépôt git : matrice backend/frontend, tags semver + `sha-`, labels OCI, cache GHA, provenance, actions épinglées au SHA |
| `infra/docker-compose.yml` | les deux `build:` → `image: ghcr.io/…:${IMAGE_TAG:-0.1.0}` |
| `infra/docker-compose.build.yml` | **nouveau**, le calque de construction locale |
| `install.sh` | `pull` puis `up -d` ; `--from-source` remplace `--build` ; arrêt explicite si le pull échoue |
| `package.json` | `stack:up` perd `--build`, `stack:pull` ajouté |
| `backend/.dockerignore` | `**/*.spec.ts` — deux tests colocalisés partaient dans l'image (voir revue) |
| `infra/README.md` | § Les images, § Essayer ce compose avant de publier, § Déploiement (sparse-checkout) |
| `README.md`, `CLAUDE.md`, `issue_backlog.md` | documentation et critères cochés |

## Sécurité

- **Aucun secret dans une couche.** Une couche est immuable et reste tirable après suppression du
  tag. Vérifié image par image : ni `.env` ni source TypeScript dans les deux images finales.
- **`packages: write` sur le seul job**, `contents: read` au niveau du workflow, **aucun déclencheur
  `pull_request`** — un PR de fork ne doit jamais atteindre le registre.
- **Actions épinglées au SHA de commit**, version en commentaire : un tag `@v7` est mutable, et ce
  job dispose d'un droit d'écriture sur le registre.
- **Aucun credential de registre sur la machine partagée** : c'est ce qu'achète la visibilité
  publique, et c'était la raison principale de la choisir.
- **Le défaut de visibilité du compte n'est pas touché** : il aurait rendu publics *tous* les futurs
  paquets du compte, dépôts privés compris. Deux clics ciblés valent mieux qu'un réglage permanent.

### Risques résiduels

- **La production épingle un tag, qui est mutable.** Rien n'empêche de repousser `0.1.0` avec une
  image différente ; seul un digest (`@sha256:…`) désigne un contenu. Écarté parce qu'il imposerait
  de réécrire le compose à chaque release. La signature (`cosign`) est dans la même catégorie.
- **L'image publique expose l'arbre des dépendances**, donc les CVE applicables. Le dépôt public
  l'exposait déjà par les lockfiles.
- **Fenêtre de bascule** : entre la fusion sur `main` et le passage des paquets en public,
  `./install.sh` échoue au `pull` sur un clone neuf. Quelques minutes, et le message d'erreur nomme
  exactement cette cause en premier.

## Vérification

Faite avant publication :

1. `docker compose … config` sur le compose de production : **aucune section `build`**, `IMAGE_TAG`
   résolu à `0.1.0`, montages `nginx.conf` et `minio/` résolus dans `infra/`.
2. Idem avec le calque : les deux `context:` réapparaissent sur `backend/` et `frontend/`, nom de
   projet inchangé (`exo2-portail-depot`).
3. `./install.sh --from-source` — **14,6 s**, couches chaudes. Le `up` qui suit n'utilise que le
   compose de production et retrouve les images en local : c'est la preuve que ce fichier est
   complet. Container inspecté : il tourne bien sur `ghcr.io/sephorah/exo2-portail-depot-backend:0.1.0`.
4. `curl /` → **200**, `curl /api/v1/health` → **403** (le second est le seul test qui prend en
   défaut un `nginx.conf` mal monté).
5. Images inspectées : `USER node` dans les deux, aucun `.env`, aucun `.ts` hors `node_modules` après
   correction du `.dockerignore`.
6. Chemin d'échec : `IMAGE_TAG=n-existe-pas ./install.sh` s'arrête au `pull`, exit 1, message nommant
   le tag demandé — sans construire ni attendre un timeout de healthcheck.
7. `pnpm lint` (backend + frontend, tous deux bloquants), `pnpm test` **113 tests**, `pnpm test:e2e`
   **7 tests** — tous verts. Aucun code applicatif n'a changé, mais le contrat reste vrai.

Faite après publication :

8. **Visibilité** : les deux paquets étaient tirables **anonymement dès le premier push**, sans la
   manipulation d'interface que la documentation GitHub laissait attendre. Constaté sans aucune
   credential docker — jeton anonyme du registre, `HTTP 200` sur les deux manifestes, et
   `tags: ["edge","sha-fc6102c"]`. Documentation corrigée en conséquence : vérifier, ne pas
   supposer.
9. **Artefact réel** : images locales supprimées, `IMAGE_TAG=sha-fc6102c` tiré et démarré.
   Portail 200, sonde 403, conteneurs tournant bien sur `…:sha-fc6102c`, images `USER node`,
   `amd64`, labels OCI portant `source` et `revision=fc6102c…`, ni `.env` ni `.spec.ts` dedans.
   **Puis seulement** `exo2-v0.1.0` a été posé — run vert, tags `0.1.0`, `0.1`, `latest`.
10. **Parcours évaluateur** : **2 min 02 s** sur machine vierge (conteneur privilégié, `git archive
    HEAD`, installation de Docker comprise) contre 4 min 14 s avant A6 ; **35,3 s** avec Docker
    présent et seules les images du portail à tirer ; **14,8 s** tout en cache. La publication en
    CI prend 1 min 56 s, hors du chemin critique de l'évaluateur.
11. **Parcours production** : `git clone --filter=blob:none --sparse` puis
    `git sparse-checkout set --no-cone`, dans un dossier vierge. Contenu reçu : les quatre fichiers
    compose/nginx/minio, `.env.example`, `install.sh` — **zéro fichier `.ts`, `.tsx` ou `.js`**.
    `./install.sh` y démarre le portail en 14,8 s (200 / 403, migrations « No pending migrations »),
    et `./install.sh --from-source` y refuse de tourner en renvoyant vers la forme sans argument.

**Séquencement.** `workflow_dispatch` exige que le fichier de workflow existe sur la branche par
défaut : la première publication ne pouvait donc avoir lieu qu'**après** la fusion sur `main`, qui
l'a déclenchée. Un obstacle imprévu : le jeton `gh` de la machine n'avait pas le scope `workflow`,
et GitHub refuse à une OAuth App de créer un fichier sous `.github/workflows/` sans lui — réglé par
`gh auth refresh -h github.com -s workflow`.

**Deux corrections issues de la vérification post-publication** :

- `git sparse-checkout set` est en mode *cone* par défaut et ne sélectionne que des **répertoires** :
  la commande documentée échouait sur `'…/.env.example' is not a directory`. `--skip-checks`, que
  git suggère, ne corrige rien (il traite le fichier comme un dossier, qui n'extrait rien). La forme
  juste est `--no-cone` avec des motifs façon `.gitignore`.
- La visibilité des paquets ne s'est pas comportée comme documenté (point 8) : la documentation du
  dépôt dit désormais de la vérifier plutôt que de la supposer.

## Revue de code

Voir la section dédiée dans le fil de la session. Un défaut trouvé et corrigé pendant
l'implémentation : la première version repliait `COMPOSE` sur le calque pour *toutes* les commandes,
si bien que la bannière finale imprimait un `docker compose down` mentionnant
`docker-compose.build.yml` — un fichier qui n'existe pas sur la machine de staging, sur un écran
dont c'est justement le public. Corrigé en n'ajoutant le calque qu'à la commande `build` ; effet de
bord heureux, le `up` de `--from-source` exerce désormais le compose de production tout seul.
