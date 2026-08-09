# Portail dépôt

Sous-domaine : https://sephorah-aniambossou.stage2-div.rayan-drissi.com

## Démarrage

```bash
./install.sh
```

C'est tout. Le script installe ce qui manque — jusqu'à `curl` et Docker eux-mêmes — génère la
configuration et ses secrets, **tire les images publiées**, monte la stack, applique les migrations,
et n'affiche les URLs qu'une fois que le portail répond. Il n'y a rien à faire ensuite, et rien à
lire ici pour y arriver.

Le portail est alors sur **http://127.0.0.1:21600**.

Comptez **~2 min sur une machine vierge** (1 min 52 s et 2 min 28 s mesurées sur deux passages),
installation de Docker comprise, **~35 s** si Docker est déjà là, et une quinzaine de secondes
ensuite. Ce parcours est rejouable en une commande :
`pnpm test:bare-machine` le refait dans un conteneur `ubuntu:24.04` où rien n'est préinstallé, et
vérifie que le portail répond vraiment à la fin.

Les secrets sont générés **une seule fois**, au premier lancement : relancer `./install.sh` ne les
régénère pas, sans quoi le script casserait sa propre base de données au second passage.

**Systèmes couverts : Linux avec bash** — Debian/Ubuntu, Fedora/RHEL et les autres ; les paquets
manquants sont installés via `apt-get`, `dnf`, `yum`, `apk`, `zypper` ou `pacman` selon la machine.
C'est le seul système sur lequel le parcours est testé de bout en bout.

**macOS et les machines sans bash ne sont pas couverts**, et le script ne prétend pas le contraire —
voir les limitations.

Rien n'est compilé sur place : les images sont construites par le CI et publiées sur
[GHCR](https://github.com/sephorah?tab=packages). `./install.sh --from-source` construit en local à
la place — utile pour essayer le compose de production avant de publier, et impossible sur la
machine de staging, qui n'a pas le code source.

L'infrastructure vit dans `infra/` (compose, reverse proxy, provisionnement du stockage). Les
fichiers compose n'étant pas à la racine, la commande porte deux drapeaux — `infra/README.md`
explique pourquoi aucun des deux n'est facultatif :

```bash
docker compose -f infra/docker-compose.yml --env-file .env down     # ou pnpm stack:down
docker compose -f infra/docker-compose.yml --env-file .env logs -f  # ou pnpm stack:logs
```

## HTTPS

Le portail est en **HTTPS avec un certificat Let's Encrypt renouvelé automatiquement** sur son
sous-domaine. Le proxy de la machine relaie le `:443` en **passthrough TLS** : il lit le SNI et
recopie les octets sans rien déchiffrer, donc c'est notre nginx qui termine TLS.

**C'est `DOMAIN` dans `.env` qui l'active, pas un drapeau.** Vide — poste de développement, machine
de l'évaluateur — le portail reste en clair sur `127.0.0.1:21600`, ce qui est le seul comportement
possible : sans nom de domaine public, Let's Encrypt n'a rien à valider. Renseigné, `./install.sh`
ajoute le calque `infra/docker-compose.tls.yml`, obtient le certificat et publie le 21601. Un
drapeau aurait dû être retapé à chaque redéploiement, et un oubli aurait fait retomber le portail
en clair en silence.

Trois variables, et elles ne servent qu'à la machine de déploiement : `DOMAIN` (l'interrupteur),
`ACME_EMAIL` (les avis d'expiration) et `ACME_STAGING` (`1` pour l'endpoint de test — obligatoire au
premier essai, la production plafonnant à 5 certificats identiques par semaine). Le détail du
mécanisme — amorçage, `--webroot`, renouvellement — est dans `infra/README.md` § HTTPS.

Trois limites, dont une lourde de conséquences :

- **`$remote_addr` n'est pas l'adresse du client.** En passthrough SNI, la connexion TCP vient du
  proxy de la machine ; sans PROXY protocol, nginx ne voit que lui. Le `X-Forwarded-For` que nous
  produisons est donc faux, et **une limitation de débit par IP ne peut pas s'y fier** — ce qui
  touche directement la protection du PIN contre le bruteforce (voir les limites du modèle de
  données). Il faudra limiter par jeton de lien, pas par adresse.
- **HSTS est un engagement de 180 jours** : repasser le portail en HTTP laisserait les navigateurs
  déjà venus incapables de l'atteindre jusqu'à l'expiration de l'en-tête.
- **Le certificat expire en 90 jours.** Le renouvellement est automatique et vérifié en `--dry-run`,
  mais si la machine reste éteinte plus longtemps, rien ne le rattrape avant son réveil.

**La machine de production ne contient aucun code source** : seuls `infra/`, `.env` et
`install.sh` y vivent, et le compose de production ne sait que *tirer* les images
(`ghcr.io/sephorah/exo2-portail-depot-{backend,frontend}`). Le déploiement se fait par
`git sparse-checkout` — voir `infra/README.md` §&nbsp;Déploiement. Déployer une version précise, ou
revenir en arrière, tient dans une variable : `IMAGE_TAG=0.1.0`.

## Développement

`install.sh` ne sert pas au développement quotidien : il monte la stack de production. Pour
travailler avec le rechargement à chaud (Node 22 et pnpm 11 requis sur la machine) :

```bash
pnpm install:all
pnpm db:up      # Postgres seul, sur 127.0.0.1:21632
pnpm dev        # API :21610, frontend :5173
```

L'API lit sa configuration dans `.env` à la racine et **refuse de démarrer si une variable
manque** — sans valeur de repli, délibérément : la machine de staging est partagée et seule la
plage 21600–21699 nous est attribuée. Un repli en dur ferait écouter le service au mauvais
endroit sans que rien ne le signale. `BIND_ADDRESS` vaut `127.0.0.1` sur la machine, et le
compose le surcharge à `0.0.0.0` dans le conteneur, dont le réseau est isolé et sans port publié.

## Configuration

Un seul fichier, `.env` à la racine — et à la racine même si le compose est dans `infra/`, parce que
l'API le lit aussi quand elle tourne sur la machine (`pnpm dev`) : d'où le `--env-file .env` des
commandes ci-dessus. Il est lu à la fois par `docker compose` et par l'API. `.env.example`
en est la documentation ; `./install.sh` le génère et tire au sort les secrets. **Rien n'a de valeur
de repli dans le code** : une variable manquante fait échouer le démarrage en la nommant, plutôt que
de faire écouter le service au mauvais endroit ou de démarrer Postgres sans mot de passe.

| Variable | Secret | Défaut | Rôle |
|---|---|---|---|
| `PORT`, `API_PREFIX` | non | `21610`, `/api/v1` | écrites **aussi en dur** dans `infra/nginx/nginx.conf` et le healthcheck du compose : les changer suppose de changer les trois ensemble |
| `BIND_ADDRESS` | non | `127.0.0.1` | interface d'écoute. Le compose la surcharge à `0.0.0.0` dans le conteneur, dont le réseau est isolé |
| `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` | mot de passe | — | l'URL de connexion est **assemblée** à partir d'elles, avec `encodeURIComponent` : n'importe quel mot de passe fonctionne |
| `DATABASE_URL` | oui | *(vide)* | facultative, l'emporte sur les cinq précédentes — l'échappatoire pour une base managée ou de CI |
| `STORAGE_ENDPOINT`, `STORAGE_REGION`, `STORAGE_BUCKET` | non | MinIO local, `us-east-1`, `portail-depot` | endpoint S3. Le compose le surcharge en `http://minio:9000` |
| `STORAGE_ACCESS_KEY`, `STORAGE_SECRET_KEY` | oui | — | utilisateur applicatif, restreint au seul bucket |
| `MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD` | oui | — | administration du serveur de stockage |
| `JWT_SECRET`, `JWT_EXPIRES` | secret | —, `2h` | authentification avocat. 32 caractères minimum, unité de durée obligatoire (et non nulle) |
| `SEED_LAWYER_EMAIL`, `SEED_LAWYER_NAME` | non | `avocat@exemple.fr`, `Maitre Dupont` | compte de démonstration. Lues **par le seed seul**, jamais par l'API |
| `SEED_LAWYER_PASSWORD` | oui | — | mot de passe du compte de démonstration, tiré au sort une fois par `install.sh`. Stocké en clair dans `.env` **parce qu'il doit rester relisible** : c'est ce que le seed réaffiche à chaque exécution, et un hachage ne se relit pas |
| `DOMAIN`, `ACME_EMAIL`, `ACME_STAGING` | non | *(vides)* | HTTPS. Lues **ni** par compose **ni** par l'application : seul `install.sh` les lit, pour les passer à certbot |

**Le préfixe dit qui lit la variable.** Tout ce qui commence par `STORAGE_` est lu par
l'application ; `MINIO_ROOT_*` ne l'est **jamais** — le compose ne le passe qu'aux conteneurs
`minio` et `minio-init`, qui provisionnent le bucket, la politique d'accès et l'utilisateur
applicatif. L'API n'a donc pas le droit de créer un bucket, ni de voir les autres. C'est aussi ce
qui rend le stockage remplaçable : rien dans le code ne nomme MinIO, seul l'endpoint le sait.

**Aucune variable côté frontend**, délibérément : le SPA appelle l'API en relatif sur `/api/...`
derrière le même proxy, donc aucune origine à configurer et aucun CORS à ouvrir. Un `VITE_API_URL`
figerait de toute façon sa valeur au *build* de l'image, pas au déploiement.

Les secrets ne sortent jamais du fichier : `.env` est gitignoré, en `chmod 600`, absent de
l'historique git, et aucun message d'erreur de validation ne recopie une valeur — ils finiraient
dans les journaux agrégés.

## Authentification de l'avocat

L'avocat est le seul acteur qui se connecte ; le client reste anonyme de bout en bout, avec un lien
et un PIN pour seuls justificatifs.

| Route | Accès | Effet |
|---|---|---|
| `POST /api/v1/auth/login` | ouverte | vérifie e-mail + mot de passe, pose le cookie de session, renvoie `{ id, name, email }` |
| `POST /api/v1/auth/logout` | ouverte | efface le cookie |
| `GET /api/v1/auth/me` | authentifiée | le profil de la session en cours |

**Le jeton voyage dans un cookie `httpOnly`**, jamais dans le corps de la réponse : le JavaScript du
navigateur ne peut donc pas le lire, et un script injecté dans la page ne peut pas l'emporter. Le
cookie est `SameSite=Strict` — le navigateur ne l'attache jamais à une requête venue d'un autre site,
ce qui écarte le CSRF sans jeton supplémentaire — et son `Secure` (« à n'envoyer que chiffré ») est
décidé **requête par requête** d'après `X-Forwarded-Proto` : posé systématiquement, il casserait la
connexion sur le `http://127.0.0.1:21600` de l'évaluateur ; jamais posé, il laisserait le cookie
capturable sur le domaine public.

**Toutes les routes sont fermées par défaut.** Le garde est global (`APP_GUARD`) et seul le
décorateur `@Public()` ouvre une route — le sens inverse, un garde à poser sur chaque route, publie
une route dès qu'on l'oublie, et sans rien signaler. Aujourd'hui `@Public()` porte sur le login, le
logout et la sonde de santé ; les futures routes `/public/*` du client (C1, C2) devront le porter
aussi.

**Expiration et « refresh ».** Le jeton vaut `JWT_EXPIRES`, soit **2 h**, et il n'y a **pas de jeton
de rafraîchissement** : passé ce délai, l'avocat se reconnecte. Le choix tient à l'usage — créer une
demande, regarder où en sont les dépôts — qui se fait en visites courtes. Un *refresh* révocable
supposerait une table, une rotation et sa suite de tests ; sans révocation, il ne ferait qu'allonger
la durée de vie d'un jeton volé.

**Le mot de passe n'existe nulle part en clair côté serveur** : argon2id, paramètres OWASP
(`src/crypto/secrets.ts`), le même primitif que le PIN des liens publics.

**Un e-mail inconnu et un mot de passe faux sont indiscernables** : même statut 401, même message, et
surtout **même durée** — quand le compte n'existe pas, la vérification tourne quand même contre un
hachage factice. Sans cela, l'écart de temps (une milliseconde contre ~67) transformerait le login en
annuaire des comptes existants.

### Compte de démonstration

`./install.sh` exécute le seed dans le conteneur `backend` et affiche ses identifiants : adresse, mot
de passe, plus le lien de dépôt et son PIN. Le mot de passe est tiré au sort à la première
installation (24 caractères hexadécimaux, ~96 bits) et conservé dans `.env` ; le rejouer ne duplique
rien.

## Modèle de données

Cinq entités. `Lawyer` est le seul acteur authentifié : le client n'a ni compte ni ligne en base,
seulement un lien et un PIN.

```
Lawyer ──< DepositRequest ──< RequestedItem ──0..1 UploadedFile
                    └──< PublicLink
```

| Entité | Rôle |
|---|---|
| `Lawyer` | `name`, `email` (unique, normalisé en minuscules), `passwordHash` |
| `DepositRequest` | « Dossier Martin, pièces 2026 ». Porte le titre et le propriétaire |
| `PublicLink` | `tokenHash`, `pinHash`, `expiresAt`, `revokedAt` — le lien envoyé au client |
| `RequestedItem` | Une pièce attendue (« Carte d'identité ») |
| `UploadedFile` | Le fichier déposé : `storageKey` MinIO, `mimeType`, `sizeBytes`, `status` |

Quatre décisions méritent d'être expliquées.

**Le statut n'est pas stocké.** « Expirée » dépend de l'horloge : une colonne resterait à « en
attente » après l'expiration tant qu'aucun travail de fond ne la retournerait, et le tableau de
bord mentirait. Il est dérivé à la lecture — `now > expiresAt` → expirée, sinon toutes les pièces
reçues → complète, sinon en attente. Zéro colonne, zéro tâche planifiée, une fonction pure
testable en gelant le temps. Même raison pour le « nombre de pièces attendues », qui est un
`count(RequestedItem)`.

**Le lien est une entité, pas trois colonnes.** Régénérer un lien révoque le précédent et en
insère un nouveau, PIN compris : il est donc *structurellement* impossible qu'un ancien PIN reste
valide sur un nouveau lien. Un index unique **partiel** — unique sur `requestId` uniquement là où
`revokedAt IS NULL` — garantit un seul lien actif à la fois tout en laissant l'historique
s'accumuler. Cet index est écrit à la main dans la migration : Prisma ne sait pas exprimer un
index conditionnel.

**Aucun secret n'est stocké en clair.** Le mot de passe et le PIN sont hachés en **argon2id**
(configuration de référence OWASP : 19 Mio, 2 itérations, 1 voie), via `argon2` — liaison vers
`phc-winner-argon2`, l'implémentation C de référence. Le **token du lien est haché en SHA-256** :
c'est une credential au porteur au même titre qu'un mot de passe, et en clair une fuite de la base
livrerait tous les liens actifs. SHA-256 et non argon2id parce que le token porte 256 bits
d'entropie et ne se devine pas — un hachage rapide suffit et garde la recherche indexée.
Conséquence assumée : le lien n'est affiché **qu'une fois**, à sa création ; le perdre oblige à le
régénérer.

**`mimeType` est une chaîne, pas un enum.** L'énoncé fige PDF/JPG/PNG, mais les types autorisés
doivent rester configurables : un enum PostgreSQL imposerait une migration pour modifier une liste
de validation. L'allowlist et la taille maximale (20 Mo) vivent dans la configuration.

### Limites connues

- **Pas de journal d'audit** (`AccessLog`) : classé en bonus dans l'énoncé. `PublicLink` en prépare
  le rattachement.
- **Aucune limitation de débit sur `/auth/login`**, et c'est un choix, pas un oubli. Sur le port 443
  la machine relaie le HTTPS en *passthrough* : elle recopie des octets chiffrés sans lire de requête
  HTTP, donc elle ne peut renseigner aucun en-tête d'adresse d'origine. Notre nginx voit la même
  adresse pour tous les clients, si bien qu'une limite « par IP » serait en réalité une limite
  globale : un attaquant consommerait le quota et **verrouillerait l'avocat légitime**. Ce qui protège
  le login à la place : un mot de passe tiré au sort (~96 bits, pas un mot de passe choisi), vérifié
  en argon2id (~67 ms), une taille de champ bornée pour que personne ne puisse faire hacher un
  mégaoctet, et des réponses indiscernables. La limitation revient en **G1**, par jeton de lien — la
  seule clé qui reste discriminante derrière ce relais.
- **La déconnexion est côté client seul.** Effacer le cookie n'invalide pas le jeton : une copie
  prise avant reste valable jusqu'à son expiration, donc au plus 2 h. Une révocation réelle demande
  une liste de jetons révoqués, donc une lecture de stockage à chaque requête. Ce qui existe
  aujourd'hui : un compte supprimé cesse immédiatement d'être utilisable, le garde relisant le compte
  à chaque requête.
- **Un seul compte avocat, celui du seed.** Pas d'inscription, pas de réinitialisation de mot de
  passe, pas de multi-cabinet. Changer le mot de passe, c'est changer `SEED_LAWYER_PASSWORD` et
  relancer `./install.sh`.
- **Le seed réécrit ce qu'il a créé.** Chaque exécution repose le hachage du mot de passe et
  **révoque le lien public en cours** pour en émettre un nouveau — sans quoi il ne pourrait pas
  réafficher un PIN utilisable, celui-ci étant haché. Conséquence à connaître : relancer
  `./install.sh` pendant qu'un client utilise le lien de démonstration le lui invalide.
- **Le compte de démonstration existe aussi sur le domaine public**, avec une adresse devinable et
  aucune limitation de débit devant lui. C'est son mot de passe tiré au sort qui le protège, seul.
  Un déploiement réel devrait le supprimer.
- **PIN à 4 chiffres = 10 000 combinaisons.** Le hachage protège la base en cas de fuite, mais
  seul un verrouillage après N échecs protège du bruteforce en ligne — il n'existe pas encore.
  C'est la limite la plus sérieuse du modèle actuel.
- **Pas de versionnage des fichiers** : un fichier par pièce attendue, un nouveau dépôt écrase le
  précédent, objet MinIO compris.
- **Pas d'historique conservé au-delà des liens** : supprimer une demande détruit en cascade ses
  liens, pièces et métadonnées. Les objets MinIO sont effacés par préfixe
  (`requests/<id>/`) — d'où cette convention de nommage — mais il n'y a pas de balayage
  périodique des orphelins en cas d'échec partiel.
- **Pas de chiffrement au repos**, ni de la base ni des objets.
- **Pas de politique de rétention** : les liens expirés restent en base indéfiniment.
- **`install.sh` ne démarre pas sur une machine sans bash** (Alpine nu, par exemple). Son shebang est
  `bash`, donc l'échec arrive avant sa première ligne, hors de portée de sa propre gestion d'erreur.
  Le correctif tient en une douzaine de lignes — shebang `#!/bin/sh`, préambule POSIX qui obtient
  bash puis `exec bash "$0" "$@"`, après quoi tout le reste est inchangé, `/dev/tcp` compris. Il
  n'est pas fait parce qu'aucune machine visée n'est concernée : Alpine est une image de base pour
  conteneurs, et Ubuntu/Debian, Fedora/RHEL et macOS livrent tous bash.
- **macOS n'est pas couvert, faute de pouvoir le tester.** Sur un Mac sans Docker, `install.sh`
  appelle `get.docker.com`, qui détecte lui-même le système et répond
  `ERROR: Unsupported operating system 'macOS'` en renvoyant vers Docker Desktop — un message juste,
  qu'il aurait été inutile de remplacer par le nôtre. Avec Docker Desktop déjà lancé, le reste du
  script a de bonnes chances de fonctionner (aucune option GNU-only sur le chemin nominal), mais
  **ce n'est pas vérifié** et rien dans le projet ne l'affirme.
- **Le palier root de la cascade Docker est le seul testé automatiquement**
  (`pnpm test:bare-machine`). Les paliers *sudo* et *rootless* sont vérifiés à la main.
- **Un `.env` et un volume Postgres peuvent diverger** sur une machine de développement dont le
  `.env` a été régénéré alors que les volumes survivaient : Postgres ne lit son mot de passe qu'à la
  création du volume. Le backend boucle alors sur `P1000` et le remède est `down -v`. Le cas ne peut
  pas se produire sur une machine neuve, où les deux naissent ensemble.

---

_À documenter d'ici la fin : architecture et choix justifiés, stratégie de tests, périmètre
d'observabilité et pourquoi ces métriques, identifiants de démo._
