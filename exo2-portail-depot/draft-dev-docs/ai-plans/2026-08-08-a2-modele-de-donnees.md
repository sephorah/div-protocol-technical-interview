# A2 — Modèle de données

**Date** : 2026-08-08 · **Branche** : `feat/a2-modele-de-donnees` · **Issue** : A2 (P0)

## Point de départ

A1 avait posé la plomberie — PostgreSQL 17, Prisma 7, `/health` — mais `schema.prisma` ne
contenait aucune entité et `prisma/migrations/` n'avait qu'un `.gitkeep`. A2 débloque B1, B2, B3,
C1 et C2, c'est-à-dire tout le parcours.

L'énoncé officiel a été relu avant de planifier, et il a apporté trois éléments que le backlog
n'avait pas : **PIN à 4 chiffres**, **20 Mo maximum par fichier**, **statut d'upload
pending/complete/failed**. Il classe aussi le **journal d'audit en bonus**, ce qui a directement
changé le périmètre livré.

## Modèle proposé, et ce qui en a été retenu

Le modèle initial était : `Lawyer(nom, email, mot de passe, date)`, `DepositRequest(nom, statut,
token, PIN, date)`, `RequestedItem(nom, demande, date)`, `UploadedFile(type)`, plus une question
ouverte sur `AccessLog`.

| Entité | Verdict |
|---|---|
| `Lawyer` | Retenu tel quel. `passwordHash` explicite, email normalisé en minuscules avant l'index unique |
| `DepositRequest` | `nom` → `title`. **`statut` retiré de la base.** `expiresAt` manquait. Token et PIN déplacés sur `PublicLink` |
| `PublicLink` | **Ajouté** |
| `RequestedItem` | Retenu tel quel |
| `UploadedFile` | Largement complété : `type` seul ne permet pas de retrouver l'objet |
| `AccessLog` | **Écarté** |

### Le statut n'est pas stocké

« Expirée » dépend de l'horloge murale. Une colonne resterait à `pending` après l'expiration tant
qu'aucun travail de fond ne la retournerait, et le tableau de bord mentirait. Dérivé à la lecture :
`now > expiresAt` → expirée, sinon toutes les pièces reçues → complète, sinon en attente. Zéro
colonne, zéro tâche planifiée, une fonction pure que D1 testera en gelant le temps. C'est aussi ce
qu'exige B4 (« statut dérivé, pas saisi »). Même raisonnement pour « nombre de pièces attendues »,
qui est un `count`.

### `PublicLink` : revirement assumé

La première version du plan gardait token, PIN et expiration sur la demande, au motif que le
journal des liens est un bonus. La question posée — « si on l'ajoute maintenant, ce sera plus
simple pour plus tard ? » — a inversé la décision, et c'était la bonne lecture :

- extraire ces trois colonnes après coup aurait demandé une migration de **données** peuplées plus
  la réécriture de toute requête les touchant : B3, C1, C2, B4, le seed H2 ;
- le faire maintenant coûte une table et une jointure sur le seul chemin `token → lien → demande`.

Bénéfice non anticipé : l'invariant « un nouveau lien implique un nouveau PIN » cesse d'être une
règle applicative pour devenir une propriété du schéma. Un index unique **partiel** garantit un
seul lien actif par demande tout en laissant l'historique s'accumuler :

```sql
CREATE UNIQUE INDEX "PublicLink_requestId_active_key"
  ON "PublicLink" ("requestId") WHERE "revokedAt" IS NULL;
```

Prisma ne sait pas exprimer un index conditionnel : il est ajouté à la main dans la migration, et
c'est le point le plus facile à perdre lors d'une régénération.

### `AccessLog` écarté

L'énoncé le classe en bonus (backlog G2/P2). La table serait écrite par personne et lue par
personne tant que G2 n'existe pas, et **son coût d'ajout sera identique plus tard** — c'est cette
asymétrie avec `PublicLink` qui décide, pas le temps disponible.

### Le token est stocké haché

Question soulevée en cours de plan : « est-ce une bonne pratique de stocker le token ? » Non. Le
token est une credential au porteur, exactement comme un mot de passe : en clair, une fuite de la
base livre tous les liens actifs. Il est donc stocké en **SHA-256**.

SHA-256 et non argon2id : argon2 sert à ralentir le bruteforce d'un secret à faible entropie, or
un token de 256 bits ne se devine pas. Un hachage rapide suffit et garde la recherche indexée en
une seule lecture.

Conséquence assumée : le lien n'est affiché **qu'une fois**, à sa création. L'avocat n'a pas besoin
de l'ouvrir — il a son tableau de bord — mais il doit pouvoir le copier pour l'envoyer. S'il le
perd, il régénère, ce qui révoque l'ancien.

## Choix de bibliothèque : argon2id

| Candidat | Avantages | Inconvénients |
|---|---|---|
| **`argon2` (node-argon2) 0.45.1** | Liaison vers **`phc-winner-argon2`**, l'implémentation C de référence (lauréate de la Password Hashing Competition), la plus auditée et la plus déployée ; embarque le prebuild `linux-x64/argon2.musl.node` | Script `install` → une entrée `allowBuilds` ; embarque tous les prebuilds (~960 Ko) |
| `@node-rs/argon2` 2.0.2 | Aucun script d'installation ; binaire par plateforme via `optionalDependencies` | Réimplémentation Rust, projet plus jeune, surface d'audit plus étroite |
| `hash-wasm` | WASM pur, identique partout | Nettement plus lent à paramètres égaux → on finirait par baisser les paramètres, donc la sécurité |

**Retenu : `argon2`.** Le plan recommandait d'abord `@node-rs/argon2`, au motif que node-argon2
compilerait sur Alpine faute de prebuild musl. **Vérification faite, c'est faux** : le tarball
0.45.1 contient bien `prebuilds/linux-x64/argon2.musl.node`. L'objection tombée, on prend
l'implémentation de référence. Contrôlé après installation : aucun répertoire `build/` dans
`node_modules/argon2`, donc aucune compilation.

**Paramètres** : configuration OWASP `m=19456, t=2, p=1`, mesurée à **67 ms** par hachage sur cette
machine. Le défaut de la bibliothèque (64 Mio, 3 itérations) a été mesuré à **312 ms** et écarté :
l'écart n'achète qu'une résistance accrue à une attaque *hors ligne* — les hachages sont salés —
et se paie sur `/public/:token/unlock`, la route ouverte à un client anonyme. Tant que G1
(limitation de débit) n'existe pas, 312 ms et 64 Mio par requête forment un facteur d'amplification
confortable pour saturer l'API.

## Découverte en cours de route : l'API écoutait sur `0.0.0.0`

En vérifiant que rien n'était publié hors de `21600`, `ss -ltn` a montré `*:21610` — **toutes les
interfaces**. Le processus était un `nest start --watch` résiduel, mais la cause est dans le code :
`app.listen(port)` sans adresse écoute sur `0.0.0.0`.

Tant que le port valait 3000 le problème passait inaperçu. Avec le port dans la plage attribuée,
sur une machine **partagée avec d'autres candidats**, l'API devenait joignable directement,
court-circuitant le proxy — donc la seule chose qui protège `/health` et borne la taille des
requêtes.

Corrigé par une variable `BIND_ADDRESS` obligatoire : `127.0.0.1` sur la machine, `0.0.0.0` dans le
conteneur (réseau isolé, aucun port publié, et nginx doit joindre le service en interne).

## Ce qui a été fait

- `schema.prisma` : cinq modèles + `enum UploadStatus`, commentaires sur les trois choix non
  évidents.
- Migration `20260808014756_initial_model`, index partiel ajouté à la main.
- `src/crypto/secrets.ts` : `generatePublicToken` (32 octets `randomBytes` en base64url, 256 bits),
  `hashPublicToken` (SHA-256), `generatePin` (`randomInt`, non biaisé), `hashSecret`/`verifySecret`
  (argon2id), `buildStorageKey` (clé MinIO préfixée par demande, nom assaini).
- `PORT`, `API_PREFIX`, `BIND_ADDRESS` obligatoires, **sans valeur de repli**, lus par
  `ConfigService` et non `process.env`.
- Port `21610` et préfixe `/api/v1` répercutés sur `.env.example`, `docker-compose.yml`,
  `nginx.conf`, `backend/Dockerfile` et les tests.
- README : section « Modèle de données » et limites connues.

## Vérification

| Vérification | Résultat |
|---|---|
| `pnpm build` (backend) | OK — a révélé une erreur de typage qu'aucun test n'avait vue |
| `pnpm lint` | OK (`--max-warnings 0`) |
| `pnpm test` | **65 tests**, 4 suites |
| `pnpm test:e2e` | **5 tests**, dont « `/health` répond 404 hors préfixe » |
| `docker compose down -v && up --build` | 2 min 08 s, **4 services `healthy`** |
| Migration au démarrage | `Applying migration 20260808014756_initial_model` dans les logs |
| Tables sur base vierge | 5 tables + `_prisma_migrations` |
| Index partiel | `CREATE UNIQUE INDEX ... WHERE ("revokedAt" IS NULL)` présent |
| `curl :21600/api/v1/health` | **403** (deny volontaire) |
| `curl :21600/` et `/depot/xyz` | **200** (fallback SPA intact) |
| Sonde interne | `{"status":"ok","db":"up"}` |
| `ss -ltn` | **seul `127.0.0.1:21600`** écoute |
| Prebuild argon2 | aucun `build/`, `$argon2id$v=19$m=19456,...` produit |

### Tests ajoutés : ce qu'ils protègent

**`src/crypto/secrets.spec.ts` — 21 tests, cinq groupes.**

| Groupe | Vérifie | Invariant protégé |
|---|---|---|
| `generatePublicToken` | 43 caractères, alphabet URL-safe uniquement, 1000 tirages sans répétition | Les 256 bits d'entropie, et un lien collable dans un courriel sans échappement |
| `hashPublicToken` | Déterminisme, longueur fixe, ne contient pas le token, distingue deux entrées voisines | Qu'un retour au stockage en clair ne passe pas inaperçu — le déterminisme est ce qui rend la recherche par token possible |
| `generatePin` | 4 chiffres sur 1000 tirages, zéros de tête, > 450 valeurs distinctes sur 500 tirages | Un tirage non biaisé : un générateur dégénéré tomberait très en dessous du seuil |
| `hashSecret` / `verifySecret` | Paramètres OWASP assertés **un par un**, sel aléatoire prouvé par deux hachages différents de la même valeur, `« 0042 » ≠ « 42 »`, et **hachage corrompu → `false` sans lever** | Le dernier point est le plus important : une exception remonterait en 500 là où un PIN faux renvoie une erreur d'authentification, offrant un moyen de distinguer les deux cas |
| `buildStorageKey` | `../../../etc/passwd` ne produit ni `..` ni séparateur supplémentaire ; deux appels sur le même nom ne collisionnent pas | La traversée de chemin. **Ce test a échoué au premier passage** et révélé que l'assainissement laissait passer les points consécutifs |

Les paramètres argon2 sont assertés séparément (`m=19456`, `t=2`, `p=1`) plutôt que par une
expression régulière sur la chaîne entière : la bibliothèque les écrit dans l'ordre `m,p,t`, qui
n'a aucune raison d'être stable d'une version à l'autre. Ce qui doit l'être, ce sont les valeurs.

**`src/config/env.validation.spec.ts` — 8 tests ajoutés.** Chaque variable manquante est refusée en
étant nommée, un `PORT` invalide est rejeté, un `API_PREFIX` mal formé aussi (`api/v1`, `/api/v1/`,
une URL absolue), et `/` est accepté comme « pas de préfixe ». Le cas le plus utile : **une
`DATABASE_URL` explicite ne dispense pas** de `PORT`/`API_PREFIX`/`BIND_ADDRESS` — sans quoi le
chemin « base managée » contournerait toute la validation applicative.

**`test/health.e2e-spec.ts` — 1 test ajouté, et un couplage rendu réel.** La suite applique
désormais `setGlobalPrefix` comme `main.ts` : sans cela elle interrogeait `/health` et serait
restée verte pendant que la sonde réelle vivait ailleurs. Le nouveau test vérifie que **`/health`
répond 404 hors préfixe**, ce qui est le garde-fou du `deny all` nginx et du healthcheck docker,
tous deux visant `/api/v1/health`.

### Ce que ces tests ne prouvent pas

**Rien du schéma.** Les suites remplacent `PrismaService` par un double, donc aucune n'atteint
Postgres : cascades, index partiel et contraintes d'unicité ne sont couverts par aucun test
automatisé. D'où l'**aller-retour Prisma réel** contre la base de développement, neuf assertions
toutes passées : création en cascade, recherche par hachage de token, PIN bon et PIN faux,
**second lien actif refusé par l'index partiel**, régénération (2 liens en historique, 1 actif),
second fichier sur la même pièce refusé, statut dérivé 1/2, cascade complète à la suppression de
l'avocat.

C'est un script jeté, pas une suite — voir le constat n° 4 de la revue ci-dessous. **D1 doit le
reprendre** contre une base de test dédiée.

## Revue de code

| # | Gravité | Constat | Suite donnée |
|---|---|---|---|
| 1 | **haute** | `app.listen(port)` écoutait sur `0.0.0.0` — API joignable hors du proxy sur une machine partagée | Corrigé : `BIND_ADDRESS` obligatoire |
| 2 | moyenne | `buildStorageKey` laissait passer `..` : `../../../etc/passwd` produisait `--..-..-etc-passwd` | Corrigé : les points consécutifs sont réduits, un test le couvre |
| 3 | moyenne | `pnpm test` ne détecte pas les erreurs de typage — ts-jest ne compile pas avec `tsconfig.build.json` | Non corrigé. `pnpm build` et `pnpm lint` restent le filet ; à garder en tête en CI (D3) |
| 4 | moyenne | La vérification de bout en bout du schéma est un script jeté, pas une suite | Assumé pour A2 ; **D1 doit la reprendre** contre une base de test |
| 5 | faible | `nginx.conf` fige `/api/v1` et `21610` alors que `.env` en est la source | Assumé : nginx ne lit pas l'environnement. Commentaires croisés dans les trois fichiers, et un test e2e échoue si le préfixe cesse de s'appliquer |
| 6 | faible | `verifySecret` avale toute exception et renvoie `false` | Voulu : une exception remonterait en 500 là où un PIN faux renvoie une erreur d'authentification, donnant un moyen de distinguer les deux cas |
| 7 | faible | `BIND_ADDRESS` n'est pas validé | Assumé : une valeur erronée échoue au `listen` avec `EADDRNOTAVAIL`, message suffisamment clair |
| 8 | information | Un `.env` antérieur à A2 fait échouer le démarrage (`PORT`, `API_PREFIX`, `BIND_ADDRESS` absents) | Comportement voulu, l'erreur nomme les variables. Sans effet sur le parcours du correcteur : sur une machine vierge, `install.sh` génère le `.env` depuis `.env.example` |

## Limites livrées avec A2

Reprises dans le README : pas de journal d'audit, **PIN à 4 chiffres sans verrouillage** (limite la
plus sérieuse — G1 mériterait d'être remontée malgré son étiquette « bonus »), pas de versionnage
des fichiers, pas de balayage des objets MinIO orphelins, pas de chiffrement au repos, pas de
politique de rétention des liens expirés.

## Suite

A2 débloque **B1** (authentification avocat) puis **B2**, le chemin critique du parcours.
