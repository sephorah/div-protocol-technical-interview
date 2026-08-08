# A3 — Stockage objet MinIO conteneurisé

**Date** : 2026-08-08 · **Branche** : `feat/a3-stockage-objet-minio` · **Issue** : A3 (P0)

## Point de départ

A2 avait posé le modèle et les primitives cryptographiques, dont `buildStorageKey()` qui fabrique
des clés préfixées `requests/<requestId>/items/<itemId>/`. Mais aucun code de stockage n'existait :
`grep -riE 'minio|s3'` ne remontait que des commentaires, et aucune dépendance S3 dans
`backend/package.json`.

A3 est la dernière brique d'infrastructure qui bloque **C2** (dépôt de pièces). Elle ne livre
délibérément aucune route HTTP : elle livre un MinIO conteneurisé, un bucket garanti présent au
démarrage, et un service injectable qui écrit, lit et supprime sans jamais toucher au disque local.
À la fin d'A3, C2 n'a plus qu'à brancher un flux sur `StorageService.putObject()`.

L'énoncé a été relu avant de planifier. Il impose « zéro fichier écrit sur le disque de l'API » et
un plafond de 20 Mo par fichier. Le plafond relève de C2 (« taille max et types autorisés
configurables ») ; A3 ne livre que la voie d'écriture.

## Décisions, et pourquoi

### `@aws-sdk/client-s3` plutôt que le client `minio`

| | `@aws-sdk/client-s3` + `lib-storage` | client `minio` |
|---|---|---|
| Contrat | API S3, l'endpoint est une variable | API propriétaire |
| Migration vers S3/Scaleway | changement d'endpoint | réécriture du module |
| Poids | ~15 Mo de `node_modules` | ~2 Mo |
| Pré-signature (G3) | `@aws-sdk/s3-request-presigner`, même famille | `presignedPutObject` |

Retenu : le SDK S3. Le backlog dit littéralement « SDK S3 », et le gain est que **rien dans le code
ne nomme MinIO** — seul l'endpoint le sait. Le surcoût de taille est payé une fois dans une image
déjà bâtie sur `node:22-alpine`.

`forcePathStyle: true` est codé en dur : MinIO n'a pas de DNS virtual-hosted (`bucket.host` ne
résout pas), et en faire une variable serait un réglage que personne ne changera jamais.

### Bucket créé au démarrage, pas par un conteneur `mc`

MinIO a son propre conteneur dans les deux cas. La question portait sur un **second** conteneur,
jetable : une image `minio/mc` qui démarre, fait `mc mb`, sort, et que le backend attendrait en
`service_completed_successfully`.

Retenu : `ensureBucket()` dans `onModuleInit`. Idempotent, aucun conteneur en plus, aucun
ordonnancement à arranger, et **testable** — un sidecar aurait mis le cycle de vie du bucket hors de
portée de Jest. Contrepartie assumée : le backend détient les identifiants root de MinIO.

### `Upload` de `lib-storage` plutôt que `PutObjectCommand`

`PutObjectCommand` exige `ContentLength`. En C2, la taille viendrait de l'en-tête `Content-Length`
du client — une valeur **déclarative, donc précisément celle qu'il ne faut pas croire**. S'y fier,
c'est soit tronquer, soit échouer au premier octet en trop. `Upload` n'a jamais besoin de la taille
à l'avance : au-delà d'un seuil elle bascule seule en *multipart* (S3 découpe l'objet en parties de
5 Mo minimum, envoyées séparément puis réassemblées côté serveur).

### Suppression par préfixe, pas par liste de clés

`UploadedFile` est en `onDelete: Cascade` : supprimer une `DepositRequest` efface items et fichiers
dans la même instruction SQL. Or `storageKey` n'existe **que** dans ces lignes — après la cascade,
aucun `SELECT` ne peut plus dire quels objets MinIO leur correspondaient, et ils resteraient
orphelins indéfiniment. Le préfixe `requests/<requestId>/` se déduit du seul identifiant de la
demande : la suppression des objets ne dépend d'aucune lecture en base. C'est la raison d'être de la
forme des clés produites en A2.

### `STORAGE_*` et non `MINIO_*`

MinIO est une implémentation de S3, pas le contrat. Le nommage neutre évite un renommage le jour où
l'endpoint change.

### La sonde `/health` vérifie aussi le stockage

`{ status, db, storage }`, 503 si **l'une** des deux est basse, les deux vérifications en
`Promise.all` — une panne de base ne doit pas masquer une panne de stockage dans le rapport. C'est
le signal dont F2 a besoin pour l'alerte « MinIO injoignable », et la condition pour qu'« API
prête » veuille dire « un dépôt passerait ». Les littéraux `'up'`/`'down'` sont devenus des enums
(`HealthState`, `HealthStatus`) ; les valeurs sérialisées sont inchangées, donc le healthcheck
docker et `install.sh` n'ont pas bougé.

## Sécurité

- **Aucun port MinIO publié en production.** Seul `docker-compose.dev.yml` publie, sur `127.0.0.1`
  et dans la plage attribuée (21690 API, 21691 console). La machine est partagée : une console
  MinIO ouverte, ce sont toutes les pièces des clients de l'avocat. Vérifié : `ss -ltn` ne montre
  rien sur 9000/9001/21690/21691 après `./install.sh`.
- **Identifiants générés aléatoirement** par `install.sh`, jamais en dur, jamais commités.
- **Bucket privé**, aucune policy publique posée.
- **Aucune valeur de variable dans un message d'erreur** — règle posée en A1, étendue à
  `STORAGE_SECRET_KEY` et couverte par un test.
- **Nom de bucket validé au démarrage** (règles S3), pour que le message porte sur la variable
  plutôt que sur un `CreateBucket` refusé.

**Risques résiduels assumés :**

1. Le backend détient les identifiants **root** de MinIO, puisqu'il crée le bucket. Une
   compromission de l'API donne accès à tout le stockage. L'alternative — un utilisateur applicatif
   restreint créé par `mc admin user add` — a été écartée avec le choix « bucket au boot ». À
   rouvrir avec G3.
2. **Aucune limite de taille applicative.** Le seul plafond est `client_max_body_size 25m` dans
   `nginx.conf`, qui ne protège pas `pnpm dev` (hors proxy). C'est le périmètre de **C2**, et les
   20 Mo de l'énoncé y seront appliqués.
3. **Aucun antivirus** : c'est C4. Un objet écrit par A3 est l'octet-pour-octet de ce qu'on lui a
   donné.
4. **Aucun chiffrement au repos** : relève de l'infrastructure hôte.

## Ce qui a été fait

- `backend/src/storage/` : `StorageModule` (`@Global`, comme `PrismaModule`) et `StorageService` —
  `ensureBucket`, `putObject`, `getObjectStream`, `deleteByPrefix`, `ping`, `onModuleDestroy`.
- `env.validation.ts` : `inspectStorage`, appelé **avant** le court-circuit `DATABASE_URL` et fusionné
  dans les deux `return` — l'oublier aurait fait disparaître la configuration de stockage dès qu'un
  `DATABASE_URL` explicite est fourni ; un test le couvre.
- `health.controller.ts` : enums + vérification du stockage.
- `docker-compose.yml` / `.dev.yml` : service `minio`, volumes `minio_data` / `minio_data_dev`
  distincts, `depends_on: service_healthy`.
- `.env.example` : bloc « Stockage objet ». `install.sh` : `minio` dans `SERVICES`, génération des
  deux secrets.

### Écarts par rapport au plan

- Le plan prévoyait un `testPathIgnorePatterns` sur `jest-e2e.json` pour que `test:e2e` ne ramasse
  pas la suite d'intégration. **Inutile** : son `testRegex` est `.e2e-spec.ts$`, que `.int-spec.ts`
  ne peut pas satisfaire.
- Le plan prévoyait un provider `S3_CLIENT` injectable pour permettre le mock. **Supprimé** : un
  `jest.spyOn(S3Client.prototype, 'send')` suffit et couvre aussi `Upload`, qui passe par le même
  `send`. C'était de l'ingénierie spéculative.
- `testcontainers` a introduit trois scripts de build transitifs (`cpu-features`, `protobufjs`,
  `ssh2`), qui font sortir `pnpm install --frozen-lockfile` en 1. **Refusés explicitement** dans
  `pnpm-workspace.yaml` plutôt qu'autorisés : ils ne compilent que des accélérations natives du
  transport SSH de dockerode, que testcontainers n'utilise pas (socket unix locale).
- **`install.sh` a dû apprendre à compléter un `.env` périmé** — non prévu, voir la revue ci-dessous.

## Vérification

`docker compose down -v` puis `./install.sh` sur les volumes détruits : **exit 0 en 1 min 06**, les
cinq services healthy.

- Le backend crée bien le bucket lui-même : `[StorageService] Bucket "portail-depot" created` dans
  ses journaux, et `mc ls local/` depuis le conteneur MinIO montre `portail-depot/`.
- `/health` renvoie `{"status":"ok","db":"up","storage":"up"}`.
- `docker compose stop minio` → **503** `{"status":"error","db":"up","storage":"down"}` ;
  `docker compose start minio` → retour à **200**.
- `docker compose ps` : seul `proxy` publie (`127.0.0.1:21600->80`). `ss -ltn` : aucun port MinIO
  sur l'hôte.
- Portail HTTP 200 ; `/api/v1/health` depuis l'extérieur toujours **403** (règle `deny all` intacte).
- Second `./install.sh` : `.env` reconnu complet, secrets non régénérés.

### Tests ajoutés : ce qu'ils protègent

Trois niveaux, délibérément séparés. `pnpm test` et `pnpm test:e2e` doivent rester exécutables sans
Docker — ce sont eux qui tourneront en CI (D3) ; seul `pnpm test:integration` exige un démon.

- **`src/storage/storage.service.spec.ts`** (mocké sur `S3Client.prototype.send`) — `ensureBucket`
  crée sur `NotFound`, ne recrée pas, et **relance un 403** au lieu de le confondre avec une absence
  (sinon une erreur de credentials se déguiserait en bucket vide) ; `putObject` vise le bon bucket
  avec le bon `ContentType` en consommant un `Readable` ; `deleteByPrefix` pagine, **refuse un
  préfixe vide** (qui viderait tout le bucket), échoue si le serveur signale un échec par clé, et
  compte ce que le serveur confirme ; `ping` renvoie `false` au lieu de jeter.
- **`src/config/env.validation.spec.ts`** (étendu) — les cinq variables manquantes nommées d'un
  coup, endpoint injustifiable rejeté, nom de bucket invalide rejeté, configuration de stockage
  **survivant à un `DATABASE_URL` explicite**, et le secret jamais recopié dans le message.
- **`test/health.e2e-spec.ts`** (étendu) — 200 quand les deux répondent, 503 nommant celui qui est
  tombé, et **les deux pannes rapportées ensemble**.
- **`test/storage.int-spec.ts`** (testcontainers, vrai MinIO) — la seule suite qui prouve le réseau :
  `ensureBucket` sur un serveur vierge puis rejoué ; aller-retour rendant **les mêmes octets** ; un
  objet de 12 Mo qui emprunte réellement le chemin multipart, que les mocks n'atteignent jamais ; et
  `deleteByPrefix` qui efface une demande **en laissant intacte celle d'à côté** — la régression qui
  viderait le bucket est silencieuse autrement.

Total : 97 unitaires, 7 e2e, 6 d'intégration (5,7 s), lint et build verts.

### Ce que ces tests ne prouvent pas

Que la stack complète fonctionne : c'est la vérification manuelle ci-dessus. Et le comportement sous
charge ou sur flux interrompu en cours d'upload — non couvert, à traiter avec C2.

## Revue de code

| # | Gravité | Constat | Suite donnée |
|---|---|---|---|
| 1 | **haute** | `deleteByPrefix` comptait les clés envoyées comme supprimées ; `DeleteObjects` répond 200 en plaçant les échecs par clé dans `Errors`, sans lever | **Corrigé** : les échecs lèvent, le compte vient de `Deleted`. Deux tests ajoutés. Sans cela, un objet protégé restait dans le bucket et la purge était déclarée faite |
| 2 | **haute** | `install.sh` conservait un `.env` existant tel quel, donc sans les `STORAGE_*` : `docker compose config` sortait en 15 | **Corrigé** : `append_missing_keys` reporte les clés de `.env.example` avec leurs commentaires, `set_env_default` ne remplit que le vide. Idempotent, vérifié sur copie. C'est le constat n° 8 d'A2, qu'A2 avait jugé sans effet — il en avait un |
| 3 | moyenne | Le message final d'`install.sh` listait les services en dur et omettait `minio`, alors que la boucle l'attendait bien | **Corrigé** : le message est dérivé de `$SERVICES` |
| 4 | moyenne | La branche « endpoint sans hôte » était du code mort : `http`/`https` sont des schémas « spéciaux » WHATWG, `new URL('http:///x')` promeut `x` en hôte et `new URL('http://')` lève | **Corrigée** (retirée), avec la raison en commentaire — le contrôle reste légitime pour `postgresql:`, schéma non spécial |
| 5 | faible | `BUCKET_PATTERN` accepte `a..b` et `1.2.3.4`, que S3 refuse | **Assumé** : `ensureBucket` tourne dans `onModuleInit`, donc l'échec reste au démarrage. La regex ne change que la qualité du message, pas le moment de la détection |
| 6 | faible | Le tag MinIO est figé dans trois fichiers sans lien entre eux | **Assumé** : la frontière shell/TypeScript rend le partage coûteux, et **A5** rouvrira ces fichiers |

Le tag est figé à `RELEASE.2025-04-22T22-12-26Z` et non à un `latest` : les images communautaires
postérieures à mai 2025 ont retiré la console web. Un `latest` ferait disparaître l'interface
d'administration sans qu'une ligne du dépôt ait changé.

## Limites livrées avec A3

Pas de limite de taille ni de contrôle de type (C2), pas d'antivirus (C4), pas d'URL pré-signée ni
d'utilisateur MinIO restreint (G3), pas de balayage des objets orphelins, pas de chiffrement au
repos, pas de politique de rétention.

## Suite

A3 débloque **C2**. Le chemin critique reste **B1 → B2**.
