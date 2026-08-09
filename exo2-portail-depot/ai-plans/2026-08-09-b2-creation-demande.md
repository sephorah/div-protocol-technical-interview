# B2 — Création d'une demande de dépôt (`POST /requests`)

Date : 2026-08-09 · Branche : `feat/b2-creation-demande`

## Le besoin

Depuis B1, l'avocat peut se connecter — et rien d'autre. La seule demande de dépôt existante était
celle que `src/seed.ts` écrit pour la démonstration. B2 ouvre la première route métier : celle qui
produit un dossier, sa liste de pièces attendues, son lien public et son PIN.

L'énoncé, relu avant de planifier : demande créée par l'avocat authentifié, titre descriptif, lien
public expirable, PIN à 4 chiffres, durée de validité, et un dashboard qui affiche
`en attente` / `complète` / `expirée`.

Le PIN étant haché (A2), il n'existe en clair **qu'une fois**, dans la réponse de création. C'est la
conséquence à assumer, et elle est maintenant écrite partout : **un PIN perdu ne se réaffiche pas,
il se remplace** en régénérant le lien (B3).

## Décisions, et ce qu'elles écartent

| Sujet | Choix | Alternative écartée, et pourquoi |
|---|---|---|
| Durée de validité | `expiresInDays`, entier borné 1–90 | `expiresAt` en ISO : l'horloge du navigateur peut différer de celle du serveur, et il faudrait refuser le passé *et* borner le futur pour exprimer la même valeur métier. Le plafond de 90 jours borne la durée pendant laquelle un lien oublié reste vivant. |
| Ce que rend la création | `token` brut + `pin`, pas d'URL | Renvoyer `https://…/depot/<token>` suppose une origine configurée (`PUBLIC_BASE_URL`) : une variable d'environnement de plus, trois fichiers à toucher, pour ce que B3 traite de toute façon. **Jamais** l'en-tête `Host` : il est fourni par le client, et le lien part par courriel. |
| Pièces attendues | au moins une, sans doublon (casse et espaces ignorés), 20 au plus | Zéro pièce rendrait la demande « complète » dès sa création. Deux libellés identiques sont indiscernables pour le client, alors que C2 rattachera un fichier à **une** pièce précise. |
| Contrôle des doublons | `@ArrayUnique(foldCase)` | Un `if` dans le service : l'erreur sortirait d'ailleurs que le `ValidationPipe`, avec une autre forme de corps. Un validateur maison : inutile, `class-validator` 0.15 accepte une fonction d'identité — vérifié dans ses types installés, pas de mémoire. |
| Ordre des pièces | colonne `position`, migration | `orderBy: createdAt` : les lignes sont insérées dans la même écriture imbriquée, donc partagent leur horodatage à la milliseconde. Voir ci-dessous. |
| Écriture | un seul `create` avec relations imbriquées | `$transaction` interactif : Prisma exécute déjà une écriture imbriquée en une transaction implicite. Ni demande sans lien, ni lien orphelin. |
| Statut | fonction pure `deriveStatus(input, now)` | Une méthode lisant l'horloge elle-même : les tests d'expiration devraient geler le temps, et B4 classerait vingt demandes contre vingt instants légèrement différents. |

### L'écart au plan : une migration que le plan disait inutile

Le plan annonçait « rien à migrer ». C'était faux en pratique. Sans colonne d'ordre, Postgres rend
les pièces attendues dans un ordre non garanti — elles sont créées dans la même transaction, donc
`createdAt` ne les départage pas. La liste du client pourrait se réordonner d'un affichage à
l'autre, et le test e2e qui vérifie l'ordre serait instable. Ajoutée plus tard, la colonne aurait
demandé une migration de données.

D'où `RequestedItem.position Int @default(0)`, migration
`20260809081200_requested_item_position`. Deux conséquences non évidentes :

- **Le `@default(0)` n'existe que pour migrer les lignes antérieures.** Tout site d'écriture pose la
  position explicitement, toute lecture trie dessus.
- **Le seed réaligne les pièces existantes.** Celles écrites avant la colonne portent toutes 0 : la
  migration ne peut pas deviner un ordre que le schéma n'a jamais enregistré, alors que le seed,
  lui, sait quel est l'ordre de démonstration. Sans ce réalignement, la demande de démonstration
  serait la seule à s'afficher dans le désordre — précisément celle que l'évaluateur ouvre.

L'index unique partiel d'A2 (`PublicLink_requestId_active_key`), que `CLAUDE.md` signale comme
disparaissant en silence à la **régénération** d'une migration, a été vérifié intact : on en a
**ajouté** une, pas régénéré l'ancienne.

## Ce qui a été construit

Nouveau : `backend/src/requests/` — `request-status.ts` (l'énumération et `deriveStatus`),
`request.types.ts` (les formes de réponse et leurs mappeurs), `requests.service.ts`,
`requests.controller.ts`, `requests.module.ts`, `dto/create-request.dto.ts`, plus trois suites de
tests (`request-status.spec.ts`, `dto/create-request.dto.spec.ts`, `requests.service.spec.ts`) et
`backend/test/requests.e2e-spec.ts`.

Modifié : `backend/prisma/schema.prisma` et une migration, `backend/src/seed.ts`,
`backend/src/app.module.ts`.

Rien dans `infra/`, `install.sh` ni `.env.example` : aucune variable d'environnement nouvelle, donc
la règle des trois fichiers ne s'est pas déclenchée.

Le contrat :

```
POST /api/v1/requests            (cookie de session requis)
{ "title": "…", "items": ["…", "…"], "expiresInDays": 14 }

201
{ "id", "title", "createdAt", "status": "pending",
  "items": [{ "id", "label", "received": false }],
  "link": { "token", "pin", "expiresAt" } }
```

## Sécurité

- **Le propriétaire ne vient jamais du client** : `lawyerId` est lu sur `request.lawyer`, posé par le
  garde global. Un corps qui nomme un `lawyerId` répond **400** — vérifié — grâce à
  `forbidNonWhitelisted`, et non un champ silencieusement ignoré.
- **Aucun secret dans les journaux** : `grep` sur `src/requests/` ne trouve ni `console.log` ni
  `Logger`.
- **Les mappeurs recopient champ par champ**, jamais par *spread* : une colonne ajoutée plus tard ne
  peut pas partir dans une réponse par inadvertance. Un test liste exhaustivement les clés écrites
  dans `PublicLink`.
- **Risque résiduel** : un PIN à 4 chiffres, ce sont 10 000 combinaisons. Ce n'est pas B2 qui le
  protège mais C1 (réponses indistinguables) et **G1** (limitation par jeton de lien, qui n'existe
  pas encore). Ce qui borne aujourd'hui le débit d'un attaquant, c'est l'argon2id sur le PIN.
- **Point ouvert assumé** : `expired` l'emporte sur `complete`, donc un dossier terminé bascule en
  « expirée » une fois la date passée. C'est la règle consignée en A2, figée par un test. Si B4
  montre que l'affichage gêne l'avocat, c'est là qu'on l'inversera.
- **Décalage horaire** : une durée est comptée en 24 h × n, donc en instants, pas en jours civils.
  Un passage à l'heure d'été décale l'échéance d'une heure sur l'horloge murale. Sans conséquence
  ici, mais c'est une décision et non un oubli.

## Vérifications, et leurs résultats

**Tests automatiques** — `pnpm -C backend lint` sans avertissement, `pnpm test` **206 tests / 13
suites**, `pnpm test:e2e` **50 tests / 4 suites**. Aucune n'exige Docker.

Ce que chaque suite nouvelle protège :

- `request-status.spec.ts` (7 tests) — la règle d'expiration et de complétude. Une milliseconde
  avant l'échéance, **à** l'échéance exacte (le lien vaut encore, la comparaison étant stricte), une
  milliseconde après ; 0, 2 et 3 pièces reçues sur 3 ; une demande complète **et** expirée, qui doit
  répondre `expired` — ce test tombe le jour où quelqu'un inverse les deux branches ; une demande
  qui n'attend rien, qui ne doit pas se lire « complète ».
- `dto/create-request.dto.spec.ts` (15 tests) — les règles d'entrée, éprouvées contre le
  transformateur et le validateur directement : la coupe des espaces a lieu **avant** la validation,
  un test vérifié séparément le prouve. Liste vide, 21 pièces, deux libellés identiques à la casse
  et aux espaces près, libellé vide, 0 / -1 / 91 / 1,5 / `"14"` jours, les bornes 1 et 90, un champ
  inconnu. Plus le garde-fou de langue décrit ci-dessous.
- `requests.service.spec.ts` (7 tests) — qu'aucun secret n'atteigne la base en clair. Les assertions
  lisent **la charge remise à Prisma**, pas la réponse : un service qui renvoie la bonne chose en
  écrivant le PIN en clair passerait n'importe quel test qui ne regarde que la réponse. Le `pinHash`
  est un argon2id **du PIN renvoyé** (`verifySecret` le confirme), le `tokenHash` est le SHA-256 du
  jeton renvoyé, la liste des clés écrites est exhaustive, l'échéance vaut n × 24 h et l'instant
  stocké est **le même** que l'instant annoncé, les positions suivent l'ordre saisi, et deux
  créations consécutives ne partagent ni jeton ni PIN.
- `test/requests.e2e-spec.ts` (11 tests) — le contrat HTTP à travers l'application réellement
  configurée. 401 sans cookie (c'est ce qui prouve que le **garde global** couvre le contrôleur,
  lequel ne porte aucun `@UseGuards`), 201 avec, aucun `Hash` ni `$argon2` dans la réponse, le
  propriétaire pris sur la session, et sept corps invalides en 400.

**Chaîne réelle** — API sur l'hôte contre le Postgres conteneurisé, avec le compte du seed :

- création en **HTTP 201 en 162 ms** ;
- en base : `pinHash` en `$argon2id$v=19$m=19456,p=1,t=2`, `tokenHash` de **64** hexadécimaux, et
  `SELECT count(*) … WHERE "pinHash" LIKE '%<pin>%' OR "tokenHash" LIKE '%<jeton>%'` renvoie **0** ;
- le `tokenHash` stocké est exactement le SHA-256 du jeton renvoyé, recalculé à part :
  `01e1cff3d8d7…9cc5` ;
- pièces en positions **0, 1, 2** dans l'ordre saisi, `lawyerId` égal à l'identifiant du compte
  connecté ;
- deux demandes, **un seul lien actif chacune**.

**Chemin de l'évaluateur** — images reconstruites depuis les sources (les images publiées 0.2.0
sont antérieures à B2), pile de production démarrée, tout à travers nginx sur `127.0.0.1:21600` :
connexion **200**, création **201 en 157 ms**, création anonyme **401**, doublon **400** avec
« Deux pièces attendues portent le même libellé. », 91 jours **400** avec « La durée de validité ne
peut pas dépasser 90 jours. », et la sonde de santé toujours **403** — ce qui prouve au passage que
c'est bien notre `nginx.conf` qui est monté.

**Idempotence du seed** — deux exécutions consécutives : 1 avocat, 1 demande, 3 pièces en positions
0/1/2, 2 liens dont **1 actif**.

## Ce que la relecture a corrigé

Trois findings, relus sur le diff complet.

1. **Important — messages de validation en anglais.** `@MaxLength` sur le titre et sur les libellés
   n'avait pas de message, donc `class-validator` servait le sien : un avocat saisissant un intitulé
   de 201 caractères lisait *« title must be shorter than or equal to 200 characters »* au milieu de
   messages français. Confirmé par mesure avant correction. Les quatre décorateurs concernés portent
   maintenant un message français, et **un test empêche la régression** : aucun message produit par
   ce DTO ne doit contenir « must be », la signature des messages par défaut.
2. **Moyen — commentaire faux.** `app.module.ts` affirmait que placer `RequestsModule` après
   `AuthModule` était ce qui fermait ses routes. Un `APP_GUARD` s'applique quel que soit l'ordre des
   imports : le commentaire inventait une causalité, ce qui est pire que pas de commentaire.
   Supprimé.
3. **Mineur — export spéculatif.** `RequestsModule` exportait `RequestsService` sans qu'aucun module
   ne l'importe. `LawyersModule` exporte parce qu'`AuthModule` le consomme réellement ; ici c'était
   une surface élargie pour un appelant inexistant. Retiré, avec la raison en commentaire.

## Ce qui reste ouvert

- **B3** : l'URL publique construite à partir d'une origine configurée, la régénération et la
  prolongation du lien. C'est là que se répare un PIN perdu.
- **B4** : `GET /requests`, le détail, le téléchargement. `deriveStatus` et `toItemView` sont déjà
  écrits pour être réutilisés tels quels — `RequestedItemView.received` lit un `file` optionnel,
  absent à la création, joint par B4.
- **G1** : la limitation de débit par jeton de lien, sans laquelle un PIN à 4 chiffres se force.
- **Non vérifié** : le comportement sous deux créations simultanées pour le même avocat. Rien ne
  laisse penser qu'il pose problème — l'index unique partiel est par demande, et chaque création
  crée sa propre demande — mais aucun test ne l'exerce.
- **Non vérifié** : la migration sur une base contenant beaucoup de lignes. `ADD COLUMN` avec valeur
  par défaut est instantané depuis PostgreSQL 11, mais cela n'a été observé que sur trois lignes.
