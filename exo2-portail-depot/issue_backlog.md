# Issue backlog — Exercice 2, Portail de dépôt

Backlog dérivé de l'énoncé (`https://exercice-stagiaire-div.vercel.app/exo/portail-depot`).
Chaque entrée est une issue candidate : périmètre, critères d'acceptation, dépendances.

Légende priorité :

- **P0 — éliminatoire** : son absence invalide le rendu.
- **P1 — attendu** : critère de différenciation explicite de l'énoncé.
- **P2 — bonus** : listé comme bonus.

État : `todo` sauf mention contraire.

---

## Où en est le rendu — 10 août 2026

**Tout le P0 et tout le P1 sont livrés, sauf le README (H1) et l'export des sessions (H3).**

Le sprint du 10/08 a fermé dix issues en trois pistes parallèles isolées par `git worktree` :
**D6, C1, C2, B4b, B5, C3, G4, F1, F2** et le dernier critère d'**A8**. Plan et déroulé dans
`ai-plans/2026-08-10-sprint-final-parallele.md` et `ai-plans/2026-08-10-b5-ecrans-avocat.md`.

Vérification : **512 tests** — 341 backend (26 suites) et 171 frontend (25 suites) — dont 114 e2e
contre un vrai Postgres et 10 contre un vrai MinIO. Les deux lints bloquants sont propres. Et le
**parcours complet joué à la main à travers nginx**, qu'aucune suite ne couvre : login → création →
déverrouillage → dépôt d'un vrai PDF → refus 415 d'un exécutable déguisé → tableau de bord →
téléchargement **octet pour octet identique** → 401 en anonyme, jeton absent des journaux.

### Ce qui reste

| Reste | Nature |
|---|---|
| **H1** | README à compléter — observabilité, justification des métriques, limites |
| **H3** | Export des sessions IA et **caviardage**, à faire ligne à ligne |
| **B4b**, écran | **Nouveau, 10/08.** L'API de téléchargement répond, **aucun écran n'y mène** : l'avocat ne peut pas récupérer les pièces déposées. Le plus grave de ce qu'a trouvé la passe navigateur |
| ~~**E2** + passe navigateur~~ | **Passe faite le 10/08** — survol mesuré, CSP à zéro violation, aucun débordement à 375 ni 1440, parcours client rejoué sur mobile. Reste la densité du bouton de dépôt (190×40 contre 156×36) et les cibles tactiles à 18–21 px. Voir `ai-plans/2026-08-10-passe-navigateur-playwright.md` |
| **D1** | La suite d'intégration du seed, seule case encore ouverte |

### Ce qui a été coupé, et pourquoi

Le budget était de 7 h ; les 22 issues ouvertes en représentaient environ 22. Le périmètre a donc été
arrêté au **P0 + P1**, et les huit issues P2 restantes sont écartées.

**Une exception, et elle corrige une erreur de classement.** L'énoncé a **cinq** bonus — antivirus ou
vérification de type, URLs pré-signées S3, journal d'audit, CI automatisé, limitation de débit sur le
PIN.

- **E2** (densité mobile) : « respect de la charte graphique DIV » est **attendu**, au même rang que
  les tests Jest et la pile Prometheus + Grafana. Coupée sur un P2 écrit à tort → repasse en **P1**.

Les sept autres coupées sont bien des bonus (ou de l'outillage hors énoncé), donc leur absence ne
retire aucun point éliminatoire.

- **G1** (limite de débit sur le PIN) — le seul regret. Compensé par la métrique
  `portal_unlock_attempts_total` et son alerte, qui **détectent** un brute force sans l'**empêcher**.
  À nommer explicitement dans les limites du README.
- **C4** (antivirus), **G2** (audit), **G3** (URLs pré-signées), **B1b** (sessions avocat) — bonus.
- **D3** (CI), **D4** (messages homogènes), **D5** (tests de rendu) — qualité et outillage.
  **D4 est devenue plus visible** : le client API cite désormais le corps d'un 400, donc les
  messages anglais du `ValidationPipe` peuvent atteindre l'écran.
- **E2** (densité mobile) — **remise au périmètre**, voir ci-dessus. Elle se fait pendant la passe
  navigateur, qui ouvre déjà chaque écran.

Le socle (scaffold NestJS + Vite/Chakra, `install.sh`, docker compose + proxy nginx, lint bloquant
des deux côtés) était déjà en place avant tout ça et sert de base.

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
`docs/exploitation.md` :

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

Le script pilote désormais la pile docker de bout en bout : installation de Docker si absent,
génération du `.env`, `pull` des images publiées, attente de chaque healthcheck, affichage des URLs.
Le bootstrap Node/nvm/corepack a été **retiré** — la compilation se fait dans les images, donc
installer Node ferait attendre l'évaluateur pour rien.

- [x] Un seul appel monte API + front + DB + MinIO + monitoring — **fermé le 10/08**.
      `SERVICES="db minio backend frontend proxy prometheus grafana"`, plus `certbot` quand `DOMAIN`
      est rempli. `minio-init` en reste délibérément absent : il provisionne puis sort en 0, et la
      boucle n'accepte que `healthy|running` — l'y mettre bloquerait le script les 300 s du
      `HEALTH_TIMEOUT` sur un conteneur qui a parfaitement fait son travail. Mesuré après F2 :
      `./install.sh --from-source` rend la main en **40,8 s**, les sept services attendus
- [x] Seed exécuté (compte avocat démo + une demande) — **fait en B1**. Le branchement n'a pas bougé :
      le script teste `dist/seed.js` dans le conteneur `backend` et l'exécute après les healthchecks,
      en affichant sa sortie telle quelle. Le seed imprime l'adresse, le mot de passe, le lien de
      dépôt et le PIN
- [x] Affiche les URLs fonctionnelles en fin d'exécution — portail et API, en clair
      (`http://127.0.0.1:21600`) ou en HTTPS sur le domaine public selon que `DOMAIN` est rempli,
      avec les commandes d'arrêt et de journaux en docker brut
- [x] Aucune intervention manuelle requise sur machine vierge — **le critère était faux jusqu'ici**.
      `ubuntu:24.04` n'a ni `curl` ni `wget`, et le script mourait en réclamant `apt install curl` ;
      les trois campagnes de mesures (A8, A5, A6) ne l'avaient pas vu parce que le harnais installait
      curl **avant** de lancer le script. `ensure_fetcher` obtient désormais curl au lieu de l'exiger.
      Mesuré **1 min 52 s et 2 min 28 s** sur deux passages, dans un `ubuntu:24.04` où rien n'est
      préinstallé, installation de Docker comprise, à partir de `git archive HEAD` ; **15 s** avec
      les images en cache. Rejouable par `pnpm test:bare-machine`

Dépendances : A1, A3, D1, F2.

Un seul critère reste ouvert, et il demandera un vrai changement ici : les services de F1/F2 devront
entrer dans `SERVICES`, sans quoi le script rendrait la main avant que Grafana réponde, ce qui
briserait son contrat (« sortie 0 veut dire que le portail répond »). Le seed, lui, s'est activé tout
seul quand `dist/seed.js` est apparu dans l'image, sans une ligne de `install.sh` à retoucher —
c'était l'objet du branchement.

Le contrat justement : le script ne mentionne **rien** qu'il ne sache livrer. Pas de ligne « seed à
venir », pas de TODO, pas d'instruction — d'où le test silencieux sur `dist/seed.js` plutôt qu'un
message expliquant qu'il n'y a pas encore de compte de démonstration.

---

## Épique B — Côté avocat (authentifié)

### B1. Authentification avocat — P0 — **fait**

JWT en **cookie httpOnly `SameSite=Strict`**, `@nestjs/jwt` sans Passport. Le client, lui, reste
strictement anonyme.

- [x] `POST /auth/login`, mots de passe hachés — argon2id via `src/crypto/secrets.ts`, le même
      primitif que le PIN. Plus `POST /auth/logout` et `GET /auth/me`, dont le SPA a besoin pour
      rétablir sa session au rechargement
- [x] Garde d'authentification sur toutes les routes `/requests*` — **le garde est global**
      (`APP_GUARD`), donc `/requests*` naîtra protégé sans qu'on ait à y penser
- [x] Les routes `/public/*` restent accessibles sans jeton — par le décorateur `@Public()`, qui
      porte aujourd'hui sur le login, le logout et la sonde de santé
- [x] Expiration du jeton et comportement de refresh documentés — **accès 15 min + jeton de
      rafraîchissement révocable** (voir B1c), les deux cookies portant un `Max-Age` calculé par le
      même analyseur que le jeton qu'ils transportent
- [x] **Reporté de A8** : `dist/seed.js` crée le compte avocat de démonstration et une demande, de
      façon idempotente. Mesuré sur deux `./install.sh` consécutifs : 1 avocat, 1 demande, 3 pièces
      attendues, 2 liens dont **1 seul actif** — la régénération révoque le précédent, comme
      l'impose l'index unique partiel

Trois points ne sont pas devinables. **`Secure` est décidé requête par requête**, d'après
`X-Forwarded-Proto` : figé à vrai, il casserait la connexion sur le `http://127.0.0.1:21600` de
l'évaluateur, dont les images portent pourtant `NODE_ENV=production`. **Le jeton ne transporte que
`sub`** et le garde relit le compte à chaque requête : c'est la seule révocation du dispositif, un
compte supprimé cessant aussitôt d'être utilisable. Et **un e-mail inconnu coûte le même temps qu'un
mot de passe faux**, la vérification tournant contre un hachage factice — sans quoi l'écart (1 ms
contre 67) ferait du login un annuaire des comptes.

**Aucune limitation de débit**, délibérément : derrière le passthrough TLS toutes les requêtes
portent la même adresse, donc une limite par IP verrouillerait l'avocat au lieu de gêner
l'attaquant. Reportée en G1, par jeton de lien.

Dépendances : A1, A2.

### B1c. Jeton de rafraîchissement révocable — P0 — **fait**

B1 laissait un défaut central : **on ne pouvait pas couper un accès**. `POST /auth/logout` effaçait un
cookie sans rien invalider, et le seul levier restant était la suppression du compte. Sur un portail
qui donne accès aux pièces des clients d'un avocat, c'était le vrai problème — pas la durée du jeton.

- [x] Jeton d'accès ramené à **15 min**, jeton de rafraîchissement opaque de 256 bits stocké
      **haché** (SHA-256), donc révocable par construction
- [x] **Rotation à chaque usage** et **détection de réutilisation** : présenter un jeton déjà consommé
      signifie qu'une copie circule, et coupe toute la chaîne issue de cette connexion
- [x] **Deux échéances** : plafond de 7 jours figé à la connexion (recopié à la rotation) et
      inactivité de 3 jours (recalculée). La première atteinte gagne
- [x] La **déconnexion révoque côté serveur** : un cookie copié auparavant cesse de fonctionner
- [x] Vérifié contre les conteneurs : rejeu d'un cookie volé → 401, **et la session légitime aussi**
      (0 jeton actif sur 2 dans la famille) ; déconnexion → le cookie copié répond 401

Deux points ne sont pas devinables. Les lignes tournées sont **conservées** : leur présence est ce qui
rend une réutilisation reconnaissable, les supprimer ferait ressembler un jeton volé à un jeton
inconnu. Et une **tolérance de 30 secondes** évite que deux onglets se rafraîchissant en même temps ne
déclenchent une fausse détection — sans elle, l'usage normal de l'application déconnecterait l'avocat.

Référence : RFC 9700 (BCP 240) § 4.14.2. Elle impose la rotation ou la liaison cryptographique au
client ; couper toute la famille plutôt que le seul jeton actif est notre décision, et elle ne fixe
aucune durée.

Dépendances : B1.

### B1b. Gestion des sessions par l'avocat — P2

Le modèle de B1c le permet déjà — une famille de jetons par connexion — donc c'est une lecture et une
écriture, sans migration de données. Différé parce que c'est du confort : le mécanisme de sécurité,
lui, est livré.

- [ ] `GET /auth/sessions` : une entrée par session ouverte, celle en cours marquée
- [ ] `POST /auth/sessions/revoke-others` : ferme toutes les autres, renvoie combien. La session qui
      appelle survit, sinon l'avocat se verrouille dehors en essayant de se protéger
- [ ] Deux colonnes descriptives sur `RefreshToken` (`userAgent`, `ipAddress`) : sans elles, la liste
      n'affiche que des identifiants et l'avocat ne reconnaît pas ses appareils. Ce sont des **données
      personnelles** — rétention à documenter (elles disparaissent avec la session, donc 7 jours au
      plus), et l'adresse IP est peu fiable derrière le passthrough TLS, comme en G1
- [ ] Le jeton présenté doit appartenir à l'avocat qui appelle : sans ce contrôle, n'importe quelle
      session valide pourrait fermer celles d'un autre
- [ ] Écran correspondant côté avocat (dépend de B5)

Dépendances : B1c.

### B2. Création d'une demande de dépôt — P0 — **fait**

- [x] `POST /requests` : intitulé, liste des pièces attendues, durée de validité — **`expiresInDays`,
      entier borné 1 à 90**, plutôt qu'une date ISO : l'horloge du navigateur peut différer de celle
      du serveur, et il faudrait refuser le passé *et* borner le futur pour la même valeur métier
- [x] Génère un token public unique + un PIN (affiché **une seule fois** en clair à la création) —
      256 bits en base64url et 4 chiffres, stockés en SHA-256 et argon2id. La réponse est le seul
      endroit où ils existent en clair : **un PIN perdu ne se réaffiche pas, il se remplace** en
      régénérant le lien (B3)
- [x] Validation des entrées (DTO + `class-validator`) — au moins une pièce, 20 au plus, pas deux
      libellés identiques à la casse et aux espaces près, tout borné en longueur. Les messages sont
      en français, et un test interdit le repli sur les messages anglais de la bibliothèque

Trois choix ne sont pas dans l'énoncé. Le **plafond de 90 jours**, qui borne la durée pendant
laquelle un lien oublié reste vivant. La **règle des doublons**, parce que le client ne peut pas
distinguer deux pièces au même libellé alors que C2 rattachera un fichier à une pièce précise. Et
une **colonne `position` sur `RequestedItem`**, avec sa migration : les pièces d'une demande sont
insérées dans la même écriture, donc partagent leur `createdAt` à la milliseconde et Postgres est
libre de les rendre dans n'importe quel ordre — la liste du client se réordonnerait d'un affichage à
l'autre. Le seed réaligne les pièces antérieures, que la migration ne peut pas ordonner.

Le statut est dérivé par une **fonction pure** prenant `now` en argument (`request-status.ts`), donc
réutilisable telle quelle par B4 et testable sans geler l'horloge. `expired` l'emporte sur
`complete`, comme A2 l'a consigné.

Vérifié : 206 tests unitaires, 50 e2e, lint sans avertissement ; création en 201 à travers nginx en
157 ms, `pinHash` en argon2id et `tokenHash` en 64 hexadécimaux en base, aucune trace du PIN ni du
jeton en clair. Détail dans `ai-plans/2026-08-09-b2-creation-demande.md`.

Dépendances : A2, B1.

### B3. Lien public expirable protégé par PIN — P0 — **fait**

- [x] URL publique `/depot/:token` construite à partir de l'origine configurée —
      `PUBLIC_BASE_URL`, requise et validée au démarrage (origine nue, ni chemin ni paramètres),
      jamais l'en-tête `Host` : celui-ci est fourni par l'appelant, donc un appel forgé ferait
      renvoyer un lien vers le domaine d'un attaquant, que l'avocat collerait dans un courriel
- [x] Expiration effective : au-delà de `expiresAt`, l'accès est refusé — `PublicLinksService.resolve`
      applique révocation **puis** expiration. Avant B3, `expiresAt` était écrit à la création et lu
      par personne : un lien restait utilisable indéfiniment et aucun test n'échouait
- [x] Le PIN est vérifiable mais jamais relisible côté avocat — vrai par construction depuis B2, et
      désormais prouvé : la réponse de création ne porte plus le jeton nu, seulement l'URL, et un
      test échoue si un hachage apparaît dans une réponse
- [x] Action « régénérer le lien » — **régénérer, pas prolonger**. `POST /requests/:id/link` révoque
      l'actif et émet jeton, PIN et échéance neufs ; `DELETE /requests/:id/link` coupe sans réémettre

Trois choix ne sont pas dans l'énoncé, qui encadre sa liste de routes par « à titre indicatif […] le
découpage exact est ton choix, on regardera comment tu le justifies ».

**`POST /requests/:id/link` est un ajout.** L'énoncé ne parle nulle part de régénérer ; côté tableau
de bord il ne mentionne que « Copier le lien ». Ce qui la justifie n'est pas le client qui égare son
PIN, c'est **l'avocat qui ne l'a jamais vu** : le PIN n'apparaît qu'une fois, dans la réponse à la
création, et il est stocké en argon2id. Un onglet fermé, un rafraîchissement, une réponse perdue
après l'écriture en base — et la demande existe, valide, sans que quiconque en connaisse le code.
Sans cette route, elle meurt à la seconde où elle naît et l'avocat doit tout retaper.

**Prolonger est écarté** : ça rallonge la vie d'un jeton déjà parti par courriel, hors de tout
contrôle. **Une demande qui n'appartient pas à l'appelant répond 404, pas 403** — un 403 confirmerait
qu'un identifiant existe chez un autre avocat, ce qui suffit à énumérer ses dossiers.

Côté nginx, deux protections que le jeton-dans-le-chemin rend nécessaires. `Referrer-Policy:
no-referrer` et `X-Robots-Tag: noindex` au niveau `server`. Et un **masquage du jeton dans le format
de journal** : le chemin s'écrit dans `access.log`, en clair, sur une machine partagée avec d'autres
candidats. La parade radicale — jeton après un `#`, jamais envoyé au serveur — a été écartée parce
qu'elle imposerait `POST /public/unlock` avec le jeton dans le corps, donc une surface d'API qui
s'écarte de la consigne.

Vérifié : 246 tests unitaires, 61 e2e, lint sans avertissement ; régénération en 201 à travers nginx
en **97 ms**, deux lignes `PublicLink` dont une seule active, `[redacted]` dans le journal du proxy,
aucune demande de la base avec deux liens actifs. Campagne machine vierge en 2 min 23 s, assertion
`Referrer-Policy` comprise — mais elle tire les images publiées, donc elle valide nginx et
`install.sh`, pas le backend de B3, exercé lui par `./install.sh --from-source`. Détail dans
`ai-plans/2026-08-09-b3-lien-public.md`.

Dépendances : B2.

### B4. Dashboard des demandes — P0 — **fait**

- [x] `GET /requests` : liste paginée avec statut `en attente` / `complète` / `expirée`, la plus
      récente d'abord. `page` et `pageSize` sont bornés (100 au plus) : sans plafond, un seul appel
      authentifié tire la table entière et toutes ses pièces
- [x] Détail d'une demande : pièces attendues, pièces reçues, horodatages — `GET /requests/:id`,
      les pièces rendues dans l'ordre `position` que B2 a introduit, chaque pièce reçue portant nom
      d'origine, type, taille et date de réception
- [x] Statut dérivé, pas saisi — `deriveStatus` de B2 est réutilisée **sans une ligne de
      modification**. Une colonne ne serait pas seulement pénible à tenir à jour, elle serait
      fausse : entre l'instant d'expiration et le passage d'un job, elle affirmerait « en attente »
      sur une demande que plus personne ne peut ouvrir
- [x] ~~Téléchargement des pièces déposées~~ → **déplacé en B4b, et livré là** le 10/08

**Le statut garde les trois valeurs de l'énoncé, et l'état du lien est un champ à part.** B3 permet
de révoquer un lien ; la ligne `PublicLink` survit à sa révocation, `revokedAt` étant daté et rien
supprimé. Le statut se calcule donc sur le dernier lien émis, actif ou non, et `link.state` dit
`active` ou `revoked` à côté. Les deux faits sont indépendants — une demande peut être **complète et
coupée** — et un statut unique en écraserait un.

**Pas de filtre par statut**, et c'est délibéré : le statut étant dérivé, le filtrer en SQL en ferait
une seconde définition, qui peut diverger de la première sans qu'aucun test ne le voie.

**Une demande sans aucun lien lève une erreur au lieu d'être servie.** Le cas est impossible par
construction (création, révocation et régénération laissent toujours une ligne) ; le rendre nullable
aurait fait traiter à tout appelant une corruption de la base — et l'aurait masquée derrière un 200.

Vérifié : 257 tests unitaires, 83 e2e, lint sans avertissement des deux côtés ; à travers nginx,
liste en **28 ms** et détail en **13 ms**, 404 sur un identifiant inconnu, 401 anonyme, 400 sur un
paramètre de requête inconnu. Détail dans `ai-plans/2026-08-09-b4-dashboard.md`.

Dépendances : B2.

### B4b. Téléchargement des pièces déposées — P0 — **API faite, écran manquant**

> **Rouvert le 10/08 par la passe navigateur.** Les trois critères ci-dessous portent tous sur
> l'API, et ils tiennent : la route répond 200 et rend le fichier **octet pour octet identique**
> (SHA-256 concordant, vérifié à travers nginx). Mais **aucun écran n'y mène** — le détail d'une
> demande n'a ni bouton, ni lien, ni le mot « télécharger » ; ses seuls boutons sont « Se
> déconnecter », « Régénérer le lien », « Révoquer l'accès ». Un avocat ne peut donc pas récupérer
> les pièces de son client, ce qui est la finalité du produit. Cocher l'issue « faite » sur ses
> critères d'API était exact au niveau technique et faux au niveau du produit — c'est précisément
> le genre d'écart qu'aucune suite ne voit, les tests e2e appelant la route directement.
>
> - [ ] **Une action de téléchargement sur chaque pièce reçue de l'écran de détail**

- [x] L'avocat récupère un fichier déposé — **flux à travers l'API**, `GET
      /requests/:id/items/:itemId/file`, servi en `StreamableFile` sur `getObjectStream`
- [x] Le lien ne fuit pas hors de la session avocat — il n'y a **pas de lien** : la route passe par
      le garde global, donc aucun porteur ne circule dans une URL. C'est ce qui a fait écarter l'URL
      pré-signée (voir ci-dessous)
- [x] Nom de fichier restitué proprement — `Content-Disposition: attachment;
      filename*=UTF-8''<encodeURIComponent(originalName)>`, forme RFC 5987. `originalName` vient du
      client, donc il peut contenir un guillemet ou un retour à la ligne, de quoi injecter un second
      en-tête ; `encodeURIComponent` ferme les deux, et un test e2e le vérifie

**L'URL pré-signée a été écartée sur arbitrage, pas sur impossibilité** — une version antérieure du
plan la disait « techniquement impossible » et c'était faux. Une `location` nginx vers `minio:9000`
marcherait ; sa contrainte est que **SigV4 signe le `Host` ET le chemin**, et que l'API S3 de MinIO
ne se monte pas sous un préfixe, donc il faudrait exposer le bucket à la racine de l'origine.
45 min contre 30. Ce qui tranche : elle remettrait un porteur dans une URL, donc une entrée de plus
dans `log-redact.conf` — la seule protection du projet dont l'échec est **muet** ; elle ajoute un
chemin de signature qu'aucune suite ne traverse, qui marche en développement et casse derrière
nginx ; son bénéfice est un débit dont personne n'a mesuré le coût ; et G3 est P2 et porte sur
l'upload. Le mécanisme est à documenter au README comme voie de montée en charge.

**Tranché ici comme prévu : un fichier `failed` n'est jamais servi** (404), sinon le portail livrerait
à l'avocat exactement le fichier qu'il venait de refuser.

Vérifié : 8 cas e2e, dont **une pièce appartenant à une autre demande du même avocat → 404** — cas
qu'un contrôle de propriété en deux temps aurait laissé passer. Chaque refus vérifie aussi que
`getObjectStream` n'a **pas** été appelé. Bout en bout à travers nginx : fichier déposé puis
retéléchargé **octet pour octet identique**.

Sorti de B4 plutôt que livré avec : **C2 n'existe pas**, donc aucune ligne `UploadedFile` ne peut
naître autrement qu'insérée à la main, et la route serait livrée sans qu'aucun chemin réel ne
l'ait exercée. Les décisions qu'elle demande appartiennent d'ailleurs à C2 — présigné ou proxifié,
durée de validité, en-têtes de restitution.

Ce n'est pas dans la liste de routes de l'énoncé, qui s'arrête à `POST /public/:token/files`. Ce qui
la justifie est le but même du produit : l'avocat « doit **récupérer** des pièces chez son client ».
Un portail qui collecte sans jamais rendre fait moins bien que le courriel qu'il remplace.

À trancher ici une fois C2 fait : **un fichier au statut `failed` ne doit pas être servi**, quelle
que soit la réponse donnée à la question ouverte de C2 sur le sens de « reçue ».

Dépendances : C2 — donc, l'ordre réel étant C1 → C2 → B4b, cette issue vient après le déverrouillage
et le dépôt. La dépendance est dure : sans C2 rien ne dépose, donc il n'y a aucun fichier à
télécharger, aucun type réel à servir, et la route ne pourrait être exercée que sur des lignes
insérées à la main.

### B5. Écrans avocat (Chakra UI v3, charte DIV) — P0 — **fait**

- [x] Liste des demandes, création de demande, détail — `/dashboard`, `/requests/new`,
      `/requests/:id`, sous `RequireSession`. Le login venait d'E1
- [x] **Reveal au scroll**, reporté depuis E1 — sur la liste seule, `delay={index * 60}`,
      `prefers-reduced-motion` respecté
- [x] Remise du lien + PIN à la création, avec copie en un clic — **deux boutons « Copier »
      séparés** et **aucun `mailto:` prérempli** : réunir les deux secrets d'un geste encouragerait
      exactement la fuite que le README décrit. Le formulaire est remplacé après envoi, et l'écran
      dit que le PIN ne s'affiche qu'une fois
- [x] **`originalName` échappé à l'affichage** — deux tests : un nom contenant `<img …>` ne produit
      aucun élément, et le retrait des caractères bidirectionnels U+202E, qui inversent l'affichage
      d'un nom de fichier dans l'éditeur comme dans la page
- [x] **`link.state` affiché à côté du statut** — `StatusBadge` + `LinkStateBadge` côte à côte sur la
      carte et sur l'en-tête du détail, testés sur le cas `complete` + `revoked`

Trois choses non prévues au plan. L'action de la carte s'appelle **« Gérer le lien »** et non
« Copier le lien » : le jeton n'existe en clair qu'à l'émission, et « Copier » conduirait l'avocat à
casser un lien en service. La **régénération demande confirmation en nommant la conséquence** —
l'ancien lien cesse de fonctionner. Et la variante de pastille `neutral`, livrée sans consommateur
par E1, en a enfin un : `[ 3 pieces ]` sur l'en-tête du détail.

**Un défaut de charte trouvé et corrigé en chemin** : le `paddingInline` de la pastille valait
**6 px au lieu des 12 px** de la charte, écrasé par une variante `size` de Chakra. C'est le piège que
`CLAUDE.md` § E1 documente, et il était invisible parce que les tests de recette lisaient la config
déclarée et non la valeur effective. Ils lisent désormais la sortie de `getRecipeFn`.

Dépendances : B1–B4, E1.

---

## Épique C — Côté client (anonyme)

### C1. Déverrouillage par PIN — P0 — **fait**

- [x] `POST /public/:token/unlock` : session de 30 min en cookie httpOnly, `SameSite=Strict`, scopée
      à `${API_PREFIX}/public`. Plus `GET /public/session`, dont le SPA a besoin au rechargement
- [x] Token inconnu, révoqué, expiré et PIN faux renvoient des réponses indistinguables — **une
      constante unique**, et l'e2e compare le **corps entier** (`message`, `error`, `statusCode`)
      plus l'absence de `Set-Cookie` : comparer le seul `message` serait passé alors que `error`
      différait. Vérifié à travers nginx, les corps sont identiques octet pour octet
- [x] Aucune donnée de la demande exposée avant déverrouillage
- [x] **La session porte le `linkId`** — `ClientSessionGuard` **relit le lien** à chaque requête et
      refuse sur `revokedAt` ou expiration, et le `requestId` est pris dans la **ligne**, pas dans la
      charge utile. e2e : déverrouiller → `DELETE /requests/:id/link` → `GET /public/session` → 401

**Le chronomètre est aussi un oracle**, et le plan ne l'avait pas dit : trois réponses identiques ne
suffisent pas si un jeton inconnu répond en 1 ms quand un PIN faux coûte 67 ms. Le PIN est donc
vérifié contre un **hachage factice** même quand `resolve` échoue — le dispositif que `AuthService`
utilise déjà pour un e-mail inconnu.

**La session client a son propre secret, `CLIENT_JWT_SECRET`.** Signée avec celui de l'avocat, un
jeton client présenté au garde avocat franchirait la vérification de signature et la frontière ne
tiendrait plus qu'à un contrôle applicatif. RFC 8725 (BCP 225) § 3.8. Un `JwtService` dédié dans
`PublicModule`, et `validateEnv` **refuse les deux secrets égaux** — sinon ils paraissent configurés
et ne séparent rien. Tests dans les deux sens, au niveau unitaire et par HTTP.

B3 fournit `PublicLinksService.resolve(token, now)`, qui applique déjà révocation et expiration et
distingue `unknown` / `revoked` / `expired`. **Cette distinction ne doit pas ressortir** : elle
existe pour les tests et pour G2, et la route publique doit écraser les trois en une réponse unique,
sans quoi elle devient l'oracle que la deuxième case interdit.

Dépendances : A2, B3.

### C2. Dépôt de pièces — P0 — **fait**

- [x] `POST /public/files` : upload vers MinIO, métadonnées en base. Le jeton n'est plus dans le
      chemin — la session cliente de C1 le porte, donc un secret de moins dans une URL journalisée
- [x] Rattachement à une pièce attendue — l'`itemId` doit appartenir à la demande de la session
      (`findFirst` sur les **deux** critères), sinon **404** et jamais 403 : un 403 confirmerait que
      la pièce existe ailleurs
- [x] Taille max et types autorisés appliqués — constantes typées (`MAX_FILE_BYTES`,
      `ALLOWED_MIME_TYPES`), **413** et **415** avec messages français. Le 413 vient d'un filtre
      d'exception : multer avorte avant que le service soit atteint, et sans lui Nest répondait 500
      sur un cas parfaitement normal
- [x] Type réel vérifié par les *magic bytes* — signatures écrites à la main (PDF/JPEG/PNG), pas le
      paquet `file-type`, ESM pur qui imposerait une liste `transformIgnorePatterns` au Jest
      CommonJS du backend. **Vérifié en conditions réelles** : un exécutable renommé `.pdf` avec un
      `Content-Type: application/pdf` menteur est refusé en 415 à travers nginx
- [x] Re-dépôt d'une pièce déjà envoyée — **remplacement, pas versionnage**. C'était déjà tranché par
      le schéma (`requestedItemId @unique`). L'objet précédent est supprimé **après** l'écriture
      réussie : dans l'autre ordre, un `putObject` en échec laisserait la pièce sans aucun fichier
      alors qu'elle en avait un
- [x] **« Reçue » = fichier attaché ET `status === 'complete'`** — la question ouverte de B4 est
      tranchée. Un fichier refusé compté comme reçu afficherait **complète** une demande à laquelle
      il manque une pièce, au tableau de bord comme dans la progression du client. Un helper
      `isReceived()` unique sert les trois chemins de lecture, avec tests de non-régression aux deux
      niveaux. La bascule a immédiatement fait rougir trois tests de `dashboard.e2e-spec.ts` dont la
      fixture écrivait des `UploadedFile` sans `status` — exactement la régression visée

Deux chemins d'échec que le plan n'avait pas nommés : si l'écriture en base échoue après
`putObject`, l'objet tout juste écrit est effacé — c'est le dernier instant où sa clé est connue ; si
c'est la suppression de l'**ancien** objet qui échoue, le dépôt répond quand même 201 et journalise
l'orphelin, parce qu'un 500 ferait renvoyer au client un fichier que le portail détient déjà.

**Le dépôt concurrent d'une même pièce est traité** : deux envois simultanés entraient en collision
sur l'index unique, l'API répondait 500 et l'objet du perdant restait orphelin. Ce n'est pas
exotique — c'est un double-clic. Le `P2002` devient un **409**, et l'objet du perdant est supprimé
**avant** la branche, sinon la correction créerait l'orphelin qu'elle prétend éviter.
`isUniqueViolation` a été extrait en une définition unique plutôt que dupliqué.

Dépendances : A3, C1.

### C3. Suivi de progression client — P0 — **fait**

- [x] Vue « n/m pièces déposées » avec état par pièce — `ItemRow` porte quatre états. Le discriminant
      n'est **pas** un champ `status`, que l'API n'expose pas délibérément : `pas de fichier` →
      *pending*, `reçu` → *received*, `fichier décrit mais non compté` → *failed*, et *uploading* est
      un état **client**, pendant le POST
- [x] Écran dédié pour lien expiré / demande complète — **un seul écran d'impasse**, quelle que soit
      la cause. Le backend rend une réponse unique pour les quatre refus ; un message différent côté
      client réinstaurerait l'oracle que C1 ferme. Le corps d'un 401 n'est **jamais** cité
      (`QUOTED_STATUSES = [400, 409, 413, 415]`), et un test rend deux 401 de contenus différents en
      asseyant que les deux textes affichés sont identiques
- [x] Aucune information sur d'autres dossiers — en-tête propre, sans lien ni déconnexion ; un test
      assert l'absence de toute adresse e-mail et des identifiants techniques

**Le dépôt est indicatif jusqu'au 201**, parce que les magic bytes peuvent refuser le fichier après
que la barre a atteint 100 % : « envoi en cours », puis « vérification », jamais « terminé » avant la
réponse. L'upload passe par XHR et non `fetch`, qui ne rapporte aucune progression d'envoi.

Deux gardes non prévus au plan. **L'onglet mémorise quel jeton il a déverrouillé** (`sessionStorage`)
avant de restaurer la session : sans ça, le cookie du lien A montrerait le dossier de A à quelqu'un
qui ouvre le lien B. Et **`/deposit/:token` est sorti du `SessionProvider` de l'avocat**, sinon le
navigateur d'un visiteur anonyme déclenchait `/auth/me` puis `/auth/refresh` — deux appels
authentifiés sur un parcours qui doit rester strictement anonyme.

Reste ouvert : deux envois en vol sur la **même** pièce laisseraient le premier achèvement effacer la
ligne du second. Non atteignable par l'interface (le contrôle est masqué pendant l'envoi), donc laissé
plutôt que gardé par un identifiant que personne ne peut produire.

Dépendances : C1, C2, E1.

### C4. Antivirus sur les pièces déposées — P2 (bonus)

L'énoncé range « antivirus ou vérification de type sur les fichiers déposés » dans les **bonus** —
d'où P2 et non P1. La **vérification de type est livrée** par C2 (octets magiques, allowlist de trois
formats, plafond de 20 Mio, `Content-Disposition` en RFC 5987) : cette moitié du bonus est donc déjà
tenue, et c'est la validation qui rend l'allowlist effective, pas un supplément.

- [ ] Scan antivirus (ClamAV conteneurisé) avant mise à disposition de l'avocat
- [ ] Fichier rejeté : statut visible côté client et côté avocat

Dépendances : C2.

---

## Épique D — Qualité & tests

### D1. Tests Jest sur la logique métier — P1

Cible explicite de l'énoncé : expiration, PIN, transitions de statut.

- [x] Expiration : avant / à la limite / après — `request-status.spec.ts`, dont
      `is false at the exact expiry instant`. Pas de gel d'horloge : `deriveStatus` et `isExpired`
      prennent `now` en **argument**, ce qui rend la borne testable sans figer le temps
- [~] PIN : bon, mauvais, hachage — couverts par C1 (dont l'égalité des quatre refus et le hachage
      factice). **« Comportement après lockout » est sans objet** : il n'y a pas de lockout, G1 étant
      coupée du périmètre. Case laissée ouverte à dessein plutôt que cochée à tort
- [x] Transitions : `en attente` → `complète`, `en attente` → `expirée`, et l'ordre entre les deux
      (`expired` l'emporte sur `complete`)
- [x] Tests e2e du parcours complet — `deposit.e2e-spec.ts` enchaîne création → déverrouillage →
      dépôt → coche côté client **et** côté avocat → demande `complete`. Rejoué à la main à travers
      nginx après le sprint, téléchargement compris
- [x] **Harnais Postgres réel pour les suites e2e** : `test/global-setup.ts` monte un
      `postgres:17-alpine` par testcontainers et applique les vraies migrations ; les trois suites de
      `test/` ont perdu leur doublure de Prisma. C'est ce qui rend testables les contraintes, les
      cascades et l'ordre des pièces
- [x] L'**index unique partiel** « un seul lien actif par demande » est désormais couvert, dans les
      deux sens : un second lien actif est refusé, plusieurs liens révoqués sont acceptés à côté de
      l'actif. Vérifié en supprimant l'index de la migration et en constatant l'échec du bon test —
      c'était le point que `CLAUDE.md` signale comme disparaissant en silence à la régénération
- [ ] **Reporté de B1** : suite d'intégration du *seed* lui-même (exécuté deux fois, comptages
      assertés). Le harnais existe maintenant, il ne reste qu'à écrire la suite. Son idempotence
      reste **mesurée** à la main (1 avocat, 1 demande, 3 pièces, 2 liens dont 1 actif — voir
      `ai-plans/2026-08-09-b1-auth-jwt.md`) et non rejouée à chaque commit

Dépendances : B1–B4, C1–C3.

### D2. Choix d'un runner de tests frontend — P1 — **fait (par E1)**

L'énoncé ne demande du Jest que sur la logique métier : ce P1 était le nôtre, pas le sien.

- [x] Runner choisi et justifié — **Vitest 4 + Testing Library + jsdom**. Vitest relit
      `vite.config.ts`, donc greffons, alias et TypeScript sont déjà réglés ; Jest ne le lit pas, et
      Chakra v3 comme Ark UI ne sont livrés qu'en modules ES, ce qui imposerait une liste
      d'exceptions de transformation à maintenir. La cohérence avec le Jest du backend est une
      préférence, la compatibilité ES est une contrainte : c'est elle qui tranche
- [x] Un test qui prouve la chaîne — `src/test/setup.test.tsx`, qui échoue si `setupFiles` n'est pas
      pris en compte
- [x] Branché sur `pnpm test` à la racine, qui lance les deux suites

**Ce que ce runner ne peut pas prouver, et qu'il faut savoir avant de s'y fier :** jsdom ne calcule
aucun style. Trois dérives de la charte sont passées sous 55 tests verts en E1. Voir **D5**.

### D3. CI sur chaque push — P2

- [ ] Workflow GitHub Actions : install, lint (les deux lints sont bloquants), build, tests
- [ ] Build et push de l'image sur tag / merge sur `main`

Dépendances : D1, A6.

À savoir avant d'écrire le workflow : `pnpm test:e2e` **exige désormais un démon Docker**, comme
`pnpm test:integration`. Ce n'est pas un obstacle — les exécuteurs GitHub hébergés en embarquent un
par défaut — mais un exécuteur auto-hébergé sans Docker ne pourrait lancer que `pnpm test`.

### D4. Messages de validation homogènes — P2

Point ouvert laissé par B4. Chaque décorateur `class-validator` porte son message en français, et un
test l'impose. Mais deux refus échappent à cette règle parce qu'ils ne viennent d'aucun décorateur :
ils sont produits par le `ValidationPipe` lui-même.

- [ ] `forbidNonWhitelisted` répond `property status should not exist`, en anglais, au milieu de
      messages français. C'est le cas depuis B2 sur les corps de requête ; B4 l'étend à la chaîne de
      requête, où il est plus visible — un avocat qui bricole une URL le voit
- [ ] Même question pour le refus d'un corps qui n'est pas du JSON valide, produit en amont par
      Express

Ce qui bloque : le franciser demande une `exceptionFactory` sur le pipe global
(`src/app.setup.ts`), donc de reformuler des erreurs dont le texte n'est pas conçu pour être lu par
un utilisateur final. La décision — traduire, ou remplacer par un message générique unique —
dépasse le périmètre d'une issue métier, d'où le P2.

Dépendances : aucune.

---

### D5. Vérifier le rendu, pas seulement le DOM — P2

Point ouvert laissé par E1. jsdom dit qu'un bouton existe, jamais qu'il est violet. Trois défauts de
charte sont passés sous une suite verte et n'ont été vus qu'au navigateur : titre de carte rendu à
18 px contre 11 px écrits dans la recette, fond de carte et fond de champ pris à Chakra plutôt qu'à
la charte. Cause commune : **les variantes livrées avec Chakra l'emportent sur le `base` d'une
recette**.

Ce qui est déjà fait : les tests de recette lisent la valeur **effective** — `base` plus les
variantes par défaut — et non `base` seul. Cela aurait attrapé les trois.

Ce qui reste hors de portée :

- [x] **L'inversion au survol du bouton primaire** — la signature d'interaction de la charte.
      **Mesurée dans un vrai Chromium** le 10/08, plus seulement constatée à l'œil : fond
      `#5100FF` → `#F7F6FF`, texte `#FFFFFF` → `#5100FF`, contour
      `#5100FF 0 0 0 1px **inset**` (aucune bordure), boîte du bouton **643.69, 565.14 — 152.63 × 40
      avant comme pendant**, et surtout **rectangle du libellé identique au centième de pixel**
      (668.69, 575.14 — 102.63 × 20). C'est cette dernière valeur qui prouve le critère : une
      bordure au survol l'aurait décalé
- [ ] Décider du moyen : **Vitest en mode navigateur** (donc un Chromium téléchargé en CI, ce qui
      alourdit D3) ou un test de bout en bout piloté par navigateur, qui couvrirait aussi le
      parcours à travers nginx — aujourd'hui la seule chose qu'aucun étage de tests ne traverse.
      **Toujours ouvert** : la passe du 10/08 a démontré que le bout-en-bout navigateur fonctionne
      contre la pile réelle (parcours complet joué à travers nginx, styles calculés relevés, CSP
      contrôlée), mais elle a été **jouée, pas versionnée** — donc rien n'est rejouable et la
      prochaine régression de charte repassera sous une suite verte
- [~] Trancher **avant** B5 et C3 : plus il y a d'écrans, plus la vérification à la main coûte.
      **Raté** : les deux issues sont livrées et le moyen n'est toujours pas tranché. Le coût annoncé
      s'est matérialisé — la passe du 10/08 a dû couvrir six écrans au lieu de deux

Dépendances : D2. Articulation avec D3 : le choix décide du temps de CI.

---

### D6. Chemin du lien client en anglais (`/depot` → `/deposit`) — P2 — **fait**

Les routes de l'espace avocat sont passées en anglais avec E1 (`/login`, `/dashboard`). Le chemin
client est resté `/depot`, et **ce n'est pas une omission** : il n'appartient pas au frontend.

- [x] `DEPOSIT_PATH` dans `backend/src/requests/public-url.ts`, et les specs qui reconstruisent
      l'URL à partir de ce préfixe
- [x] La carte de masquage `infra/nginx/log-redact.conf` — **dans le même commit**, ce qui était tout
      l'enjeu
- [x] La route du SPA, ajoutée par C3

Fait **avant C1**, comme prévu : après, la route client existe et le coût monte.

**Vérifié en montant un nginx jetable et en lisant ses vrais journaux**, parce qu'aucune suite
automatisée ne traverse le proxy — `/deposit/[redacted]` masqué, `/api/v1/public/[redacted]` toujours
couvert. Reconfirmé sur la pile complète après le sprint : **0 occurrence** du jeton dans les
journaux du proxy et du frontend.

**Le second effet a été accepté** : les liens déjà émis cessent de fonctionner. Rien n'est en
production, aucun client réel n'en détient. Une redirection `/depot/` → `/deposit/` aurait obligé la
carte de masquage à couvrir les **deux** préfixes, donc à doubler la surface du seul mécanisme dont
l'échec est invisible.

**Un reliquat nommé plutôt que masqué** : nginx journalise l'URI avant tout routage, donc un lien
émis avant le renommage laisserait son jeton en clair. La fenêtre est vide en pratique — les URL ne
sont jamais stockées, elles sont composées à la lecture depuis `DEPOSIT_PATH`.

Les trois doivent bouger **ensemble**. Le piège est le journal : un préfixe désaligné ne casse rien
de visible, le portail répond normalement — mais le jeton de dépôt réapparaît **en clair** dans
`access.log`, sur une machine partagée avec d'autres candidats. L'assertion qui l'attrape est celle,
négative, de `scripts/test-bare-machine.sh`.

Second effet, à trancher dans l'issue : **les liens déjà envoyés à des clients cesseraient de
fonctionner**. Soit on accepte (rien n'est en production), soit nginx garde une redirection de
`/depot/` vers `/deposit/` — auquel cas la carte de masquage doit couvrir les deux.

Dépendances : aucune, mais à faire **avant C1** — après, la route client existe et le coût monte.

---

## Épique E — Design (charte DIV Protocol)

### E1. Thème Chakra UI v3 aux tokens DIV — P0/P1

Le rendu Chakra v3 est obligatoire (P0) ; le respect fin de la charte est en différenciation (P1).

- [x] Couleurs : primary `#5100FF`, secondary `#916ED8`, fond accent `#F7F6FF`, accent doux
      `#DBCDFF`, success `#12AC64` sur `#D9FFED`, danger `#FF4C4C` sur `#FFD0D0`
- [x] Inter 400 / 600 ; radius 4 / 8 / 12 / 999
- [x] **Bouton primaire signature** : fond primary, texte blanc, 600, padding 24×14, radius full ;
      au hover, **inversion** — fond `#F7F6FF`, texte primary, contour inset 1px
- [x] Cartes sans ombre, bordure 1px `#E9E9E9`
- [x] Reveal au scroll (opacity + translation) — **déplacé en B5, et livré là** (10/08), sur la
      liste des demandes, qui est la première page qui défile. `prefers-reduced-motion` respecté.
      Un défaut du plan a été corrigé au passage : le composant masquait dès l'`observe()`, donc un
      `IntersectionObserver` qui ne se déclenche jamais laissait le contenu invisible **pour
      toujours** ; il ne masque désormais qu'après que l'observateur a signalé l'élément hors écran
- [x] **Light only** : pas de mode sombre — `color-mode.tsx` et `next-themes` **supprimés**, pas
      neutralisés : garder le mécanisme pour n'en interdire que la moitié laissait un bouton
      lune/soleil que personne n'a le droit d'utiliser
- [x] Ton formel, froid, technique ; phrases courtes ; aucune illustration émotionnelle

Livré en plus, parce qu'un thème ne se valide pas sur des carrés de couleur : **l'écran de
connexion**, branché sur la vraie API (`/login`, redirection vers `/dashboard`, garde de route). Il
exerce primary, danger, l'arrondi et le survol inversé sur un parcours réel.

Trois pièges relevés au navigateur, qu'aucun test unitaire ne voyait — ils valent pour B5 et C3 :
les variantes livrées avec Chakra l'emportent sur le `base` d'une recette (titre de carte à 18 px
contre 11 px écrits) ; un `textStyle` l'emporte sur un `fontSize` voisin ; `Stack` étire ses
enfants, donc un bouton y perd son gabarit.

### E2. Densité UI constante mobile / desktop — **P1, critère ATTENDU**

**Pas un bonus.** L'énoncé range « respect de la charte graphique DIV » dans les critères *attendus*,
au même rang que les tests Jest et la pile Prometheus + Grafana. E1 a posé le thème ; E2 est ce qui
vérifie qu'il tient aux deux tailles. Classée P2 par erreur jusqu'ici, et coupée sur cette erreur.

- [~] Mêmes espacements et même densité d'information aux deux tailles — **mesuré à 375 et 1440 px**
      dans la passe navigateur du 10/08 : hauteurs de composants **identiques** sur les quatre écrans
      avocat, seul le retrait latéral passe de 24 px à 16 px, **aucun débordement horizontal** et
      aucun texte tronqué. Une exception, d'où le `~` : le bouton de dépôt du client fait
      **190 × 40 à 375 px contre 156 × 36 à 1440**. L'écart va dans le bon sens (cible plus grande au
      doigt) mais contredit littéralement le critère, donc il se tranche plutôt qu'il ne se coche
- [x] Parcours client vérifié sur mobile (c'est le contexte d'usage réel) — rejoué **entièrement à
      375 px** dans un contexte navigateur vierge, dépôt réel compris : écran PIN, déverrouillage,
      dépôt d'un PDF, passage de la pièce à *reçue*

Relevé par la même passe, hors critères ci-dessus : **cibles tactiles sous le minimum WCAG 2.2 AA
(24 × 24 px)** — « Gerer le lien → » à **21 px** de haut sur chaque carte du tableau de bord, et
« ← Retour au tableau de bord » à **18 px**. Les boutons (40 px) et les champs (42 px) passent l'AA,
sous les 44 px des guides mobiles.

Dépendances : E1. Compte rendu complet : `ai-plans/2026-08-10-passe-navigateur-playwright.md`.

---

## Épique F — Observabilité

### F1. Métriques Prometheus — P1 — **fait**

- [x] Endpoint `/metrics` sur l'API — et **fermé de l'extérieur** : `@Public()` sur la route (le
      garde global fermerait tout sinon) plus un `location = /api/v1/metrics { deny all; }`, même
      forme que la sonde de santé. Publié, il dirait à un scanner combien de demandes existent, quand
      les dépôts ont lieu et quelle dépendance est en panne. **Vérifié en conditions réelles : 403**
- [x] Métriques métier — `portal_deposits_total{outcome}`,
      `portal_unlock_attempts_total{outcome}`, `portal_expired_link_hits_total`,
      `portal_upload_bytes`, `portal_http_request_duration_seconds{method,route,status}`
- [x] Scrape configuré dans `infra/prometheus/prometheus.yml`, service sur le réseau interne,
      **aucun port publié**

`prom-client` directement plutôt qu'un enrobage NestJS tiers : la bibliothèque est déjà simple, et
c'est une version de moins à suivre. Trois points non devinables : un **`Registry` dédié** et non le
global, avec un test qui le prouve ; l'étiquetage par **motif de route** et non par chemin brut,
sans quoi un scanner parcourant `/aaa`, `/aab`… ferait exploser la cardinalité des séries ; et sur le
chemin d'erreur le statut vient de l'`HttpException`, pas de `response.statusCode` — le filtre n'a
pas encore tourné, la réponse porte encore 200, et tout refus serait compté comme un succès.

**Les compteurs de refus au déverrouillage comptent les quatre causes**, pas seulement le PIN faux :
sinon un attaquant balaierait les jetons sans jamais apparaître. C'est le seul endroit où la
distinction entre les quatre refus a le droit d'exister — elle sert la métrique et n'atteint jamais
la réponse HTTP, qui reste indistinguable.

`rejected_size` est compté dans le **filtre d'exception**, pas dans le service : multer refuse avant
qu'on l'atteigne. Point fragile signalé en commentaire — `@UseFilters(UploadLimitFilter)` passe la
*classe*, ce qui laisse Nest l'injecter ; un `new UploadLimitFilter()` compilerait et laisserait le
compteur muet pour toujours. L'e2e du 413 traverse une vraie application Nest, donc l'injection est
prouvée.

### F2. Dashboards Grafana + alertes — P1 — **fait**

- [x] Grafana conteneurisé, **dashboard provisionné** — `infra/grafana/provisioning/`, neuf panneaux,
      `allowUiUpdates: false`. Un dashboard cliqué disparaît avec le volume et rien ne le dit
- [x] Quatre alertes : API injoignable ; taux d'échec de dépôt > 10 % sur 5 min, **avec un plancher
      de 5 dépôts** sans lequel un seul fichier refusé sur trois donnerait 33 % et alerterait pour
      rien ; plus de 20 PIN erronés sur 5 min ; dépendance injoignable, lue sur les 503 de la sonde
- [ ] README : périmètre d'observabilité et justification de chaque métrique — **reste à écrire, H1**

**L'alerte force brute est ce qui remplace G1**, coupée du périmètre : 20 échecs / 5 min est hors de
portée d'un client qui se trompe et très en dessous de ce qu'un attaquant doit tenir pour balayer les
10 000 combinaisons. Elle **détecte**, elle n'**empêche** pas — à dire dans les limites.

Accès : **aucun port publié**, `location /grafana/` derrière un mot de passe généré par `install.sh`.
Vérifié sur la pile : Grafana répond bien sous le sous-chemin.

**Deux défauts qu'aucune lecture n'aurait vus**, trouvés en démarrant un Grafana jetable : un
`interval: 15s` fait échouer **tout** le provisionnement (Grafana exige un multiple de 10 s) et le
conteneur sort en 1 ; et monter `/etc/grafana/provisioning` entier masque les répertoires de l'image.

**La CSP du portail aurait laissé Grafana en page blanche** — il amorce son interface par un script
inline. La `location /grafana/` porte donc sa propre politique, ce qui annule tous les `add_header`
hérités, d'où `Referrer-Policy` et `X-Robots-Tag` **répétés à l'identique** : c'est exactement le
piège que G4 documente, rencontré pour de vrai.

**Aucun point de contact n'est configuré** (pas de SMTP sur la machine) : les alertes sont
**visibles** dans Grafana, elles ne sont pas **poussées**. À porter dans les limites du README. De
même, l'alerte « dépendance injoignable » **ne distingue pas Postgres de MinIO**, puisqu'elle lit le
503 de la sonde.

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

### G4. En-tête `Content-Security-Policy` — P2

Point ouvert laissé par E1. Le portail sert des scripts et n'annonce aucune politique de contenu :
rien ne restreint ce que la page a le droit de charger ou d'exécuter.

L'application n'en a pas besoin pour fonctionner. Ce que l'en-tête achète, c'est de **borner les
dégâts d'une dépendance frontend compromise** — le SPA embarque React, Chakra et react-router, et un
paquet vérolé pourrait aujourd'hui exfiltrer ce que l'avocat a sous les yeux, jeton de dépôt
compris, vers n'importe quel domaine.

- [x] Politique posée dans `infra/nginx/server-hardening.conf`, appliquée aux **trois** blocs
      `server`. Vérifiée sur la pile : présente sur `/`, à côté de `Referrer-Policy` et
      `X-Robots-Tag`

```
default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:;
object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'
```

- [x] `default-src 'self'` passe — la police est auto-hébergée. Chaque écart porte sa raison :
      `img-src data:` parce que vite intègre en dur les assets de moins de 4 ko, sans quoi ajouter
      une icône casserait la page **après** le build ; `object-src 'none'` parce que les pièces sont
      servies sur la même origine et pourraient sinon être embarquées en document de greffon ;
      `base-uri` contre une balise `<base>` injectée, qui détournerait toutes les URL relatives sans
      jamais violer `script-src` ; `form-action` pour qu'un formulaire injecté ne poste pas le PIN
      ailleurs. Pas d'`upgrade-insecure-requests` : la pile de l'évaluateur répond en clair
- [x] **`style-src` garde `'unsafe-inline'`**, et c'est écrit dans le fichier : Chakra v3 injecte ses
      règles à l'exécution, un nonce supposerait une page rendue par un serveur. **La politique n'est
      donc PAS stricte côté styles** — elle borne l'exfiltration, pas la manipulation visuelle (une
      surcouche qui déguise un bouton, un faux formulaire de PIN). À reprendre dans les limites du
      README
- [x] **Piège nginx** : documenté dans le fichier, et **rencontré pour de vrai** par la
      `location /grafana/`, qui doit poser sa propre politique et donc répéter les deux autres
      en-têtes, sous peine de les voir disparaître sans erreur
- [ ] **Compter les violations dans une vraie console de navigateur** — la politique est servie et
      les écrans s'affichent, mais rien ne prouve qu'aucune ressource n'est silencieusement bloquée.
      Seule case restante, à faire à la main

Une assertion a été ajoutée à `scripts/test-bare-machine.sh` : `Content-Security-Policy` présente
sur `/`.

Dépendances : aucune. À faire avant H1, la politique retenue étant à documenter.

---

## Épique H — Livrables

### H1. README complet — P0

- [ ] URL HTTPS du sous-domaine
- [ ] Setup, architecture, choix justifiés (dont le « pas de Next.js »)
- [ ] Modèle de données, stratégie de tests
- [ ] Périmètre d'observabilité et justification des métriques
- [ ] **Identifiants de démo avocat + demande seedée**
- [ ] Limites connues

### H2. Seed de démonstration — P0 — **fait (par B1)**

- [x] Compte avocat démo + une demande de dépôt avec son lien et son PIN — `src/seed.ts`, compilé en
      `dist/seed.js` qu'`install.sh` détecte et exécute après les healthchecks
- [x] Rejouable et idempotent — mesuré sur deux exécutions consécutives : 1 avocat, 1 demande,
      3 pièces attendues, 2 liens dont **1 seul actif**. Le lien est **révoqué et recréé** à chaque
      passage, dans une transaction : le PIN étant haché, un lien préservé ne pourrait pas voir son
      code réaffiché, et un lien de démonstration dont personne ne connaît le PIN ne vaut rien
- [ ] **Reste** : la suite d'intégration qui rejouerait cette idempotence à chaque commit plutôt que
      de la mesurer à la main (voir D1)

Le compte de démonstration est identifié par **la demande qu'il possède**, jamais par son adresse :
changer `SEED_LAWYER_EMAIL` créerait un second compte en laissant le premier joignable avec son
ancien mot de passe.

Dépendances : A1, A2, B2.

### H3. Export des sessions IA — P0

`ai-logs/` existe déjà, alimenté manuellement via `/export`.

- [ ] Export de toutes les sessions jusqu'à la livraison
- [ ] **Relecture de caviardage** : clés d'API, mots de passe, données personnelles

### H4. Plans et revues de code par feature — interne

- [ ] Un markdown daté par feature dans `ai-plans/` : plan suivi, décisions, vérification, revue
