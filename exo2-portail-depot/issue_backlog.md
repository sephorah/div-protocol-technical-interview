# Issue backlog — Exercice 2, Portail de dépôt

Backlog dérivé de l'énoncé (`https://exercice-stagiaire-div.vercel.app/exo/portail-depot`).
Chaque entrée est une issue candidate : périmètre, critères d'acceptation, dépendances.

Légende priorité :

- **P0 — éliminatoire** : son absence invalide le rendu.
- **P1 — attendu** : critère de différenciation explicite de l'énoncé.
- **P2 — bonus** : listé comme bonus.

État : `todo` sauf mention contraire. Le socle actuel (scaffold NestJS + Vite/Chakra, `install.sh`,
docker compose + proxy nginx, lint bloquant des deux côtés) est déjà en place et sert de base.

---

## Épique A — Socle & infrastructure

### A1. Base de données et couche de persistance — P0 — **fait**

PostgreSQL 17 conteneurisé + Prisma 7 (`@prisma/adapter-pg`), migrations jouées par
`backend/docker-entrypoint.sh`, sonde `GET /health`.

- [x] Service `db` dans le compose, volume nommé, healthcheck
- [x] ORM configuré côté NestJS, connexion lue depuis l'env
- [x] Migrations versionnées, jouées au démarrage
- [x] Un `docker compose up` sur machine vierge donne un schéma prêt

Dépendances : aucune. **Bloque A2, B1, B2, C1, C2.**

### A2. Modèle de données — P0 — **fait**

Entités : `Lawyer`, `DepositRequest`, `PublicLink`, `RequestedItem`, `UploadedFile`. Statuts de
demande `pending` / `complete` / `expired` **dérivés à la lecture**, pas stockés — « expirée »
dépend de l'horloge, une colonne mentirait jusqu'au passage d'un job.

- [x] Entités + relations + index (`tokenHash` unique, index unique **partiel** garantissant un
      seul lien actif par demande)
- [x] Le PIN est stocké **haché** — argon2id, paramètres OWASP, jamais en clair
- [x] `expiresAt` sur le lien, token public non devinable (**256 bits**, `randomBytes` en
      base64url) — et lui-même stocké haché en SHA-256, jamais en clair
- [x] Modèle documenté dans le README (section « Modèle de données », avec les limites)

Écarté volontairement : **`AccessLog`**, l'énoncé classant le journal d'audit en bonus (voir G2).
Son coût d'ajout sera identique plus tard, contrairement à `PublicLink` dont l'extraction tardive
aurait demandé une migration de données.

Dépendances : A1.

### A3. Stockage objet MinIO conteneurisé — P0 — **fait**

Zéro fichier écrit sur le disque de l'API. `StorageService` (`src/storage/`) parle S3 via
`@aws-sdk/client-s3` : rien dans le code ne nomme MinIO, seul l'endpoint le sait.

- [x] Service `minio` dans le compose (+ bucket créé à l'init) — par un conteneur `minio-init`
      (image `minio/mc`) qui provisionne bucket, policy et **utilisateur applicatif restreint**, puis
      sort. L'API ne fait que constater que son bucket existe, et échoue sinon
- [x] Module de stockage NestJS (SDK S3), clés via env — `@Global`, cinq variables `STORAGE_*`
      validées au démarrage (endpoint parsé, nom de bucket aux règles S3)
- [x] Aucune écriture locale : upload en flux vers l'objet — `Upload` de `@aws-sdk/lib-storage`, qui
      n'exige pas de connaître la taille à l'avance et bascule seul en multipart
- [x] Credentials dans `.env.example`, jamais en dur — générés aléatoirement par `install.sh`,
      aucun port MinIO publié en production. **Deux jeux distincts** : `MINIO_ROOT_*` administre le
      serveur et n'atteint jamais le backend, `STORAGE_*` est l'utilisateur restreint au seul bucket

Au passage : `/health` vérifie aussi le stockage (503 si MinIO est injoignable, ce qui est le signal
de l'alerte F2), et la suppression se fait **par préfixe** — la cascade SQL efface les `storageKey`
avant qu'on puisse les lire, alors que `requests/<requestId>/` se déduit du seul identifiant.

Trois niveaux de tests : unitaires mockés, e2e avec doubles, et une suite d'intégration
testcontainers contre un vrai MinIO (`pnpm test:integration`, la seule qui exige Docker).

Dépendances : aucune. **Débloque C2.**

### A4. Secrets externalisés et `.env.example` complet — P1 — **fait**

L'essentiel était déjà tenu par A1 et A3. Cette issue a fermé le seul trou réel : `JWT_SECRET` et
`JWT_EXPIRES` étaient documentées et générées par `install.sh`, mais ni passées au conteneur par le
compose ni validées — les renseigner ne produisait rien, et rien ne le disait.

- [x] Toutes les variables (API, DB, MinIO, JWT) documentées, avec le rôle de chacune et **qui la
      lit** : `STORAGE_*` est lu par l'application, `MINIO_ROOT_*` jamais. Tableau au README
- [x] Aucun secret commité ; `.env` gitignoré, en `chmod 600`, absent de tout l'historique
- [x] Démarrage en échec explicite si une variable requise manque, et **aucune valeur recopiée dans
      un message d'erreur** — les journaux sont agrégés ailleurs

Écarté : pas de variable pour la taille max ni les types autorisés — l'énoncé les **fige** (20 Mo,
PDF/JPG/PNG), ce sont des constantes de C2 et non de la configuration de déploiement. Pas de durée
de validité par défaut non plus : B2 en fait une entrée du formulaire. Aucun SMTP : l'énoncé ne
mentionne aucun envoi de mail.

### A5. Réorganisation `infra/` — P0 — **fait**

L'énoncé impose `infra/` (compose, Prometheus, Grafana, reverse proxy). Les deux fichiers compose et
`nginx.conf` y sont passés, `nginx.conf` sous `infra/nginx/` — comme `infra/minio/`, pour que A7
(TLS) et F1/F2 (`prometheus/`, `grafana/`) s'ajoutent sans un second déplacement.

- [x] Déplacer compose + `nginx.conf` sous `infra/`, ajuster les chemins de build et `install.sh`
- [x] Vérifier que `./install.sh` reste one-click après déplacement

Le déplacement n'est pas un `git mv` : compose déduit son **répertoire de projet** du dossier du
premier `-f`, donc son `.env` et son nom de projet. D'où deux ajouts, documentés dans
`infra/README.md` :

- `--env-file .env` sur chaque appel — le `.env` reste à la racine, où `pnpm dev` le lit aussi ;
- `name:` explicite dans chaque fichier, sans quoi le projet s'appellerait `infra` et tous les
  volumes existants deviendraient orphelins.

**Hors périmètre initial, réparé ici** : les deux fichiers compose étant à la racine, ils
partageaient le même nom de projet. Un `pnpm db:up` pendant que la production tournait recréait donc
`db` et `minio` de production avec la configuration de dev — volumes vides et ports 21632/21690/21691
publiés — sous un `backend` toujours en marche. Les noms sont désormais `exo2-portail-depot` et
`exo2-portail-depot-dev`.

### A6. Image Docker publiée sur registre et tirée en production — P0

- [x] Build et push des images backend + frontend (GHCR ou Docker Hub), tag versionné
- [x] Un compose de production qui **pull** les images (aucune section `build`)
- [x] Zéro code source sur la machine de prod : seuls compose, nginx, `.env` y vivent

Dépendances : A5.

### A7. HTTPS Let's Encrypt avec renouvellement automatique — P0

Serveur partagé : proxy frontal par `Host` header en HTTP et SNI passthrough en HTTPS, services sur
`127.0.0.1` dans la plage de ports attribuée.

- [x] Écoute sur `127.0.0.1:<port attribué>` uniquement — `127.0.0.1:21601:443`, bind explicite ;
      vérifié depuis internet, les six ports du projet (21600, 21601, 21610, 21632, 21690, 21691)
      refusent la connexion
- [x] Challenge HTTP-01 relayé par le proxy sur :80 — `location /.well-known/acme-challenge/`
- [x] Essais avec l'endpoint **staging** de Let's Encrypt avant le certificat réel
- [x] Renouvellement automatique vérifié (dry-run) — `certbot renew --dry-run` sur la machine :
      « Congratulations, all simulated renewals succeeded »
- [x] `https://sephorah-aniambossou.stage2-div.rayan-drissi.com` répond — 200 en HTTP/2, émetteur
      `O=Let's Encrypt, CN=YE2` (le vrai, pas le serveur de test), valide du 9 août au 7 novembre
      2026, accepté sans `-k` ; le HTTP répond 301 vers HTTPS et la sonde de santé reste en 403

Dépendances : A6.

L'activation passe par **`DOMAIN` dans `.env`**, jamais par un drapeau : la configuration d'une
machine appartient au fichier qui la décrit, et un drapeau oublié à un redéploiement ferait retomber
le portail en clair sans rien signaler. Vide chez l'évaluateur — sans domaine public, Let's Encrypt
n'a rien à valider — le comportement est identique à celui d'avant A7.

Le calque `infra/docker-compose.tls.yml` ajoute le port, la conf TLS et un `certbot` en boucle de
renouvellement. Trois points ne sont pas devinables : l'**amorçage** passe par la pile en clair
(nginx refuse de démarrer si le fichier de certificat manque, donc le premier certificat ne peut
s'obtenir qu'au travers d'elle) ; le certificat porte le nom de lignée fixe `portail` et non le
domaine, ce qui permet à la conf nginx de ne nommer le domaine nulle part ; et le rechargement est
**périodique** parce qu'un `--deploy-hook` ne peut pas signaler nginx depuis un autre conteneur sans
monter le socket docker, refusé sur une machine partagée.

**Découverte à porter en G1** : en passthrough SNI, `$remote_addr` est l'adresse du proxy de la
machine, pas celle du client. Une limitation de débit par IP est donc inopérante — il faudra limiter
par jeton de lien.

### A8. `install.sh` démarre la stack complète — P0

Le script existe (nvm + Node 22 + corepack + build + start) mais ne connaît ni docker ni la stack
complète.

- [ ] Un seul appel monte API + front + DB + MinIO + monitoring
- [ ] Seed exécuté (compte avocat démo + une demande)
- [ ] Affiche les URLs fonctionnelles en fin d'exécution
- [ ] Aucune intervention manuelle requise sur machine vierge

Dépendances : A1, A3, D1, F2.

---

## Épique B — Côté avocat (authentifié)

### B1. Authentification avocat — P0

JWT ou session. Le client, lui, reste strictement anonyme.

- [ ] `POST /auth/login`, mots de passe hachés
- [ ] Garde d'authentification sur toutes les routes `/requests*`
- [ ] Les routes `/public/*` restent accessibles sans jeton
- [ ] Expiration du jeton et comportement de refresh documentés

Dépendances : A1, A2.

### B2. Création d'une demande de dépôt — P0

- [ ] `POST /requests` : intitulé (ex. « Dossier Martin, pièces 2026 »), liste des pièces attendues,
      durée de validité
- [ ] Génère un token public unique + un PIN (affiché **une seule fois** en clair à la création)
- [ ] Validation des entrées (DTO + `class-validator`)

Dépendances : A2, B1.

### B3. Lien public expirable protégé par PIN — P0

- [ ] URL publique `/depot/:token` construite à partir de l'origine configurée
- [ ] Expiration effective : au-delà de `expiresAt`, l'accès est refusé
- [ ] Le PIN est vérifiable mais jamais relisible côté avocat
- [ ] Action « régénérer le lien » / « prolonger » (à trancher lors du design)

Dépendances : B2.

### B4. Dashboard des demandes — P0

- [ ] `GET /requests` : liste paginée avec statut `en attente` / `complète` / `expirée`
- [ ] Détail d'une demande : pièces attendues, pièces reçues, horodatages
- [ ] Statut dérivé, pas saisi : `expirée` si date dépassée, `complète` si toutes les pièces reçues
- [ ] Téléchargement des pièces déposées

Dépendances : B2, C2.

### B5. Écrans avocat (Chakra UI v3, charte DIV) — P0

- [ ] Login, liste des demandes, création de demande, détail
- [ ] Remise du lien + PIN à la création, avec copie en un clic

Dépendances : B1–B4, E1.

---

## Épique C — Côté client (anonyme)

### C1. Déverrouillage par PIN — P0

- [ ] `POST /public/:token/unlock` : renvoie une session courte scopée à la demande
- [ ] Token inconnu, expiré et PIN faux renvoient des réponses indistinguables (pas d'oracle)
- [ ] Aucune donnée de la demande exposée avant déverrouillage

Dépendances : A2, B3.

### C2. Dépôt de pièces — P0

- [ ] `POST /public/:token/files` : upload vers MinIO, métadonnées en base
- [ ] Rattachement à une pièce attendue
- [ ] Taille max et types autorisés **appliqués**, erreurs lisibles. L'énoncé les fige — 20 Mo par
      fichier, PDF/JPG/PNG — donc des constantes typées et testées, pas des variables d'environnement
- [ ] Type réel vérifié par les *magic bytes*, jamais sur le `Content-Type` déclaré ni l'extension :
      sans ça l'allowlist se contourne en mentant sur un en-tête (remonté de C4, qui est un bonus)
- [ ] Re-dépôt d'une pièce déjà envoyée (remplacement ou versionnage — à trancher)

Dépendances : A3, C1.

### C3. Suivi de progression client — P0

- [ ] Vue « n/m pièces déposées » avec état par pièce
- [ ] Écran dédié pour lien expiré / demande complète
- [ ] Aucune information sur d'autres dossiers de l'avocat

Dépendances : C1, C2, E1.

### C4. Antivirus sur les pièces déposées — P2

L'énoncé range l'antivirus dans les **bonus** — d'où P2 et non P1. Le contrôle du type réel, lui,
est remonté en C2 : c'est la validation qui rend l'allowlist effective, pas un supplément.

- [ ] Scan antivirus (ClamAV conteneurisé) avant mise à disposition de l'avocat
- [ ] Fichier rejeté : statut visible côté client et côté avocat

Dépendances : C2.

---

## Épique D — Qualité & tests

### D1. Tests Jest sur la logique métier — P1

Cible explicite de l'énoncé : expiration, PIN, transitions de statut.

- [ ] Expiration : avant / à la limite / après, gel du temps dans les tests
- [ ] PIN : bon, mauvais, hachage, comportement après lockout
- [ ] Transitions : `en attente` → `complète`, `en attente` → `expirée`, transitions interdites
- [ ] Tests e2e du parcours complet (création → unlock → dépôt → dashboard)

Dépendances : B1–B4, C1–C3.

### D2. Choix d'un runner de tests frontend — P1

Aucun runner n'est installé côté frontend (point ouvert dans `CLAUDE.md`). À noter : l'énoncé ne
demande du Jest que sur la logique métier, donc ce P1 est le nôtre, pas le sien.

- [ ] Runner choisi et justifié, un test qui prouve la chaîne
- [ ] Branché sur `pnpm test` à la racine

### D3. CI sur chaque push — P2

- [ ] Workflow GitHub Actions : install, lint (les deux lints sont bloquants), build, tests
- [ ] Build et push de l'image sur tag / merge sur `main`

Dépendances : D1, A6.

---

## Épique E — Design (charte DIV Protocol)

### E1. Thème Chakra UI v3 aux tokens DIV — P0/P1

Le rendu Chakra v3 est obligatoire (P0) ; le respect fin de la charte est en différenciation (P1).

- [ ] Couleurs : primary `#5100FF`, secondary `#916ED8`, fond accent `#F7F6FF`, accent doux
      `#DBCDFF`, success `#12AC64` sur `#D9FFED`, danger `#FF4C4C` sur `#FFD0D0`
- [ ] Inter 400 / 600 ; radius 4 / 8 / 12 / 999
- [ ] **Bouton primaire signature** : fond primary, texte blanc, 600, padding 24×14, radius full ;
      au hover, **inversion** — fond `#F7F6FF`, texte primary, contour inset 1px
- [ ] Cartes sans ombre, bordure 1px `#E9E9E9`
- [ ] Reveal au scroll (opacity + translation)
- [ ] **Light only** : pas de mode sombre (`color-mode.tsx` à neutraliser en conséquence)
- [ ] Ton formel, froid, technique ; phrases courtes ; aucune illustration émotionnelle

### E2. Densité UI constante mobile / desktop — P2 (l'énoncé la cite parmi les critères de design)

- [ ] Mêmes espacements et même densité d'information aux deux tailles
- [ ] Parcours client vérifié sur mobile (c'est le contexte d'usage réel)

Dépendances : E1.

---

## Épique F — Observabilité

### F1. Métriques Prometheus — P1

- [ ] Endpoint `/metrics` sur l'API
- [ ] Métriques métier, pas seulement techniques : dépôts réussis/échoués, tentatives de PIN,
      accès à des liens expirés, latence et volume d'upload
- [ ] Scrape configuré dans `infra/prometheus.yml`

### F2. Dashboards Grafana + alertes — P1

- [ ] Grafana conteneurisé, dashboard provisionné (pas cliqué à la main)
- [ ] Alertes : API down, taux d'échec d'upload, pic de PIN erronés (signal de brute force),
      MinIO injoignable
- [ ] README : périmètre d'observabilité et **justification de chaque métrique**

Dépendances : F1.

---

## Épique G — Sécurité

### G1. Rate limiting et lockout PIN — P2

- [ ] Limite sur `/public/:token/unlock` par token et par IP
- [ ] Lockout temporaire après N échecs, fenêtre configurable
- [ ] Testé (D1)

Dépendances : C1.

### G2. Audit des accès au lien public — P2

- [ ] Journal : consultation, tentative de PIN (succès/échec), dépôt, avec horodatage et IP
- [ ] Consultable par l'avocat sur le détail de la demande
- [ ] Rétention et portée documentées (données personnelles)

Dépendances : A2, C1.

### G3. URLs pré-signées pour l'upload — P2

- [ ] L'API délivre une URL pré-signée ; le fichier ne transite plus par NestJS
- [ ] Durée de validité courte, contraintes de taille/type conservées
- [ ] Articulation avec C4 (scan antivirus) à trancher : le scan devient post-upload

Dépendances : A3, C2.

---

## Épique H — Livrables

### H1. README complet — P0

- [ ] URL HTTPS du sous-domaine
- [ ] Setup, architecture, choix justifiés (dont le « pas de Next.js »)
- [ ] Modèle de données, stratégie de tests
- [ ] Périmètre d'observabilité et justification des métriques
- [ ] **Identifiants de démo avocat + demande seedée**
- [ ] Limites connues

### H2. Seed de démonstration — P0

- [ ] Compte avocat démo + une demande de dépôt avec son lien et son PIN
- [ ] Rejouable et idempotent, exécuté par `install.sh`

Dépendances : A1, A2, B2.

### H3. Export des sessions IA — P0

`ai-logs/` existe déjà, alimenté manuellement via `/export`.

- [ ] Export de toutes les sessions jusqu'à la livraison
- [ ] **Relecture de caviardage** : clés d'API, mots de passe, données personnelles

### H4. Plans et revues de code par feature — interne

- [ ] Un markdown daté par feature dans `ai-plans/` : plan suivi, décisions, vérification, revue
