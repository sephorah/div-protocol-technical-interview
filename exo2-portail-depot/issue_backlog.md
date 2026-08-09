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

Le script pilote désormais la pile docker de bout en bout : installation de Docker si absent,
génération du `.env`, `pull` des images publiées, attente de chaque healthcheck, affichage des URLs.
Le bootstrap Node/nvm/corepack a été **retiré** — la compilation se fait dans les images, donc
installer Node ferait attendre l'évaluateur pour rien.

- [ ] Un seul appel monte API + front + DB + MinIO + monitoring — les quatre premiers sont montés et
      attendus (`SERVICES="db minio backend frontend proxy"`, plus `certbot` quand `DOMAIN` est
      rempli) ; **le monitoring reste à ajouter à cette liste et à la boucle d'attente quand F1/F2
      livreront Prometheus et Grafana**
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
- [ ] ~~Téléchargement des pièces déposées~~ → **déplacé en B4b**

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

### B4b. Téléchargement des pièces déposées — P0

- [ ] L'avocat récupère un fichier déposé — URL présignée MinIO ou flux à travers l'API, à trancher
- [ ] Le lien de téléchargement est borné dans le temps et ne fuit pas hors de la session avocat
- [ ] Nom de fichier restitué proprement (`Content-Disposition`), sans faire du nom fourni par le
      client un chemin

Sorti de B4 plutôt que livré avec : **C2 n'existe pas**, donc aucune ligne `UploadedFile` ne peut
naître autrement qu'insérée à la main, et la route serait livrée sans qu'aucun chemin réel ne
l'ait exercée. Les décisions qu'elle demande appartiennent d'ailleurs à C2 — présigné ou proxifié,
durée de validité, en-têtes de restitution.

Ce n'est pas dans la liste de routes de l'énoncé, qui s'arrête à `POST /public/:token/files`. Ce qui
la justifie est le but même du produit : l'avocat « doit **récupérer** des pièces chez son client ».
Un portail qui collecte sans jamais rendre fait moins bien que le courriel qu'il remplace.

Dépendances : C2.

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
- [ ] **La session client porte le `linkId`, pas seulement le `requestId`.** Contrainte posée par B3
      et à honorer ici : sans elle, un client déjà déverrouillé garde son accès après une révocation
      ou une régénération, et les deux actions que B3 vient de livrer ne coupent alors plus rien

B3 fournit `PublicLinksService.resolve(token, now)`, qui applique déjà révocation et expiration et
distingue `unknown` / `revoked` / `expired`. **Cette distinction ne doit pas ressortir** : elle
existe pour les tests et pour G2, et la route publique doit écraser les trois en une réponse unique,
sans quoi elle devient l'oracle que la deuxième case interdit.

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

### D2. Choix d'un runner de tests frontend — P1

Aucun runner n'est installé côté frontend (point ouvert dans `CLAUDE.md`). À noter : l'énoncé ne
demande du Jest que sur la logique métier, donc ce P1 est le nôtre, pas le sien.

- [ ] Runner choisi et justifié, un test qui prouve la chaîne
- [ ] Branché sur `pnpm test` à la racine

### D3. CI sur chaque push — P2

- [ ] Workflow GitHub Actions : install, lint (les deux lints sont bloquants), build, tests
- [ ] Build et push de l'image sur tag / merge sur `main`

Dépendances : D1, A6.

À savoir avant d'écrire le workflow : `pnpm test:e2e` **exige désormais un démon Docker**, comme
`pnpm test:integration`. Ce n'est pas un obstacle — les exécuteurs GitHub hébergés en embarquent un
par défaut — mais un exécuteur auto-hébergé sans Docker ne pourrait lancer que `pnpm test`.

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
