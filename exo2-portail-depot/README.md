# Portail dépôt

Sous-domaine : https://sephorah-aniambossou.stage2-div.rayan-drissi.com

## Démarrage

```bash
./install.sh
```

C'est tout. Le script installe Docker s'il manque, génère la configuration et ses secrets,
construit les images, monte la stack, applique les migrations, et n'affiche les URLs qu'une fois
que le portail répond. Il n'y a rien à faire ensuite, et rien à lire ici pour y arriver.

Le portail est alors sur **http://127.0.0.1:21600**.

Comptez ~2 min si Docker est déjà présent, ~4 min sinon. Les appels suivants prennent quelques
secondes. `docker compose down` arrête tout.

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

---

_À documenter d'ici la fin : architecture et choix justifiés, stratégie de tests, périmètre
d'observabilité et pourquoi ces métriques, identifiants de démo._
