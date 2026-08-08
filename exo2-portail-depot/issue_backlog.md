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

### A3. Stockage objet MinIO conteneurisé — P0

Zéro fichier écrit sur le disque de l'API.

- [ ] Service `minio` dans le compose (+ bucket créé à l'init)
- [ ] Module de stockage NestJS (SDK S3), clés via env
- [ ] Aucune écriture locale : upload en flux vers l'objet
- [ ] Credentials dans `.env.example`, jamais en dur

Dépendances : aucune. **Bloque C2.**

### A4. Secrets externalisés et `.env.example` complet — P1

`.env.example` existe déjà mais devra couvrir tout le nouveau périmètre.

- [ ] Toutes les variables (DB, MinIO, JWT, expiration par défaut, SMTP éventuel) documentées
- [ ] Aucun secret commité ; `.env` reste gitignoré
- [ ] Démarrage en échec explicite si une variable requise manque (validation de config)

### A5. Réorganisation `infra/` — P0

L'énoncé impose `infra/` (compose, Prometheus, Grafana, reverse proxy). Aujourd'hui
`docker-compose.yml` et `nginx.conf` sont à la racine.

- [ ] Déplacer compose + `nginx.conf` sous `infra/`, ajuster les chemins de build et `install.sh`
- [ ] Vérifier que `./install.sh` reste one-click après déplacement

### A6. Image Docker publiée sur registre et tirée en production — P0

- [ ] Build et push des images backend + frontend (GHCR ou Docker Hub), tag versionné
- [ ] Un compose de production qui **pull** les images (aucune section `build`)
- [ ] Zéro code source sur la machine de prod : seuls compose, nginx, `.env` y vivent

Dépendances : A5.

### A7. HTTPS Let's Encrypt avec renouvellement automatique — P0

Serveur partagé : proxy frontal par `Host` header en HTTP et SNI passthrough en HTTPS, services sur
`127.0.0.1` dans la plage de ports attribuée.

- [ ] Écoute sur `127.0.0.1:<port attribué>` uniquement
- [ ] Challenge HTTP-01 relayé par le proxy sur :80
- [ ] Essais avec l'endpoint **staging** de Let's Encrypt avant le certificat réel
- [ ] Renouvellement automatique vérifié (dry-run)
- [ ] `https://sephorah-aniambossou.stage2-div.rayan-drissi.com` répond

Dépendances : A6.

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
- [ ] Taille max et types autorisés configurables, erreurs lisibles
- [ ] Re-dépôt d'une pièce déjà envoyée (remplacement ou versionnage — à trancher)

Dépendances : A3, C1.

### C3. Suivi de progression client — P0

- [ ] Vue « n/m pièces déposées » avec état par pièce
- [ ] Écran dédié pour lien expiré / demande complète
- [ ] Aucune information sur d'autres dossiers de l'avocat

Dépendances : C1, C2, E1.

### C4. Vérification de type de fichier et antivirus — P1

- [ ] Contrôle du type réel (magic bytes), pas seulement l'extension ni le `Content-Type` déclaré
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

Aucun runner n'est installé côté frontend (point ouvert dans `CLAUDE.md`).

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

### E2. Densité UI constante mobile / desktop — P2

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
