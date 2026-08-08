# A4 — Secrets externalisés et `.env.example` complet

**Date** : 2026-08-08 · **Branche** : `feat/a4-secrets-env` · **Issue** : A4 (P1)

## Point de départ

Cette issue est la première dont le constat de départ a été : *elle est déjà en grande partie
faite*. Ses trois critères — variables documentées, aucun secret commité, échec explicite au
démarrage — étaient tenus par A1 et A3 pour tout ce que le code lit. Vérifié avant de planifier :
`git log --all -- .env` est vide, `.env` est gitignoré et en `chmod 600`, `validateEnv` nomme les
variables manquantes sans jamais recopier une valeur.

Restait un trou réel, et il est instructif : **`JWT_SECRET` et `JWT_EXPIRES` étaient à moitié
câblées**. Documentées dans `.env.example`, générées par `install.sh`… et absentes du service
`backend` dans `docker-compose.yml`, sans aucune validation. En conteneur, elles n'existaient pas.
C'est le seul mode d'échec réellement *silencieux* du dispositif : une variable qu'on renseigne, qui
a l'air configurée, et qui ne produit rien. L'échéance de découverte aurait été B1, à la première
tentative de connexion.

Plus une documentation devenue fausse : `.env.example` affirmait encore « le bucket est créé au
démarrage par l'API », périmé depuis la révision d'A3.

## Décisions, et pourquoi

### Trois ajouts refusés — c'est le vrai contenu de l'issue

Le premier plan proposait six variables, en anticipant B1, B2/B3 et C2. La discussion l'a réduit à
deux. Les refus, et leur raison :

| Ajout envisagé | Refusé parce que |
|---|---|
| `UPLOAD_MAX_BYTES`, `UPLOAD_ALLOWED_MIME_TYPES` | l'énoncé **fige** 20 Mo et PDF/JPG/PNG. Règles produit, pas configuration de déploiement : en variables d'environnement elles gagnent un mode d'échec (valeur mal saisie, détectée au premier upload), doivent être ré-exposées au frontend par une route pour la validation côté client, et n'évitent pas de synchroniser `client_max_body_size` à la main — nginx ne lit pas l'environnement. Constantes typées en C2 |
| `LINK_DEFAULT_TTL_DAYS` | B2 fait de la durée de validité une **entrée du formulaire**. Un défaut n'est qu'une valeur pré-remplie d'UI |
| `PUBLIC_BASE_URL` | pas nécessaire tant que B3 ne construit pas d'URL publique ; l'ajouter maintenant aurait été de la configuration morte, exactement ce que cette issue corrige |
| Variables SMTP | l'énoncé ne mentionne aucun envoi de mail. Le « SMTP éventuel » venait de ma rédaction du backlog |

Le « configurables » de C2 et l'« expiration par défaut » d'A4 étaient des exigences que j'avais
écrites moi-même, pas des exigences de l'énoncé. **Relire la consigne a supprimé les deux tiers du
travail prévu.**

### Un test de cohérence entre fichiers de configuration, puis abandonné

Envisagé : une suite lisant `.env.example`, `docker-compose.yml` et `test/setup-env.ts`, échouant si
une clé requise manque à l'un d'eux. L'argument était l'incident post-A3, où un `.env` antérieur
faisait échouer `install.sh` sur `${STORAGE_ACCESS_KEY:?}`.

Abandonné après examen : cet incident venait d'un `.env` **utilisateur** périmé, pas d'un désaccord
entre fichiers versionnés — c'est `append_missing_keys` qui l'a réglé, le test ne l'aurait pas vu.
Et le mode d'échec qu'il aurait couvert est déjà **bruyant** : `validateEnv` lève, le backend
crash-loop, `install.sh` échoue en nommant la variable. En face : parser du YAML à la regex,
maintenir à la main la liste des surcharges délibérées (`BIND_ADDRESS`, `DB_HOST`, `DB_PORT`,
`STORAGE_ENDPOINT`), et casser en A5 au déplacement du compose sous `infra/`.

Une version réduite (vérifier seulement que chaque clé requise figure dans `.env.example`) a aussi
été écartée : elle n'aurait rien protégé que le premier `./install.sh` ne révèle déjà.

### `JWT_SECRET` : 32 caractères minimum

Seule variable de l'issue dont une valeur faible est directement exploitable — qui connaît le secret
forge un jeton pour n'importe quel avocat, donc lit les pièces de tous ses clients. Et l'attaque est
**hors ligne** : un seul jeton intercepté suffit à casser le secret sans jamais appeler l'API, donc
ni rate limiting ni lockout (G1) n'y changent quoi que ce soit. `install.sh` en génère 64
hexadécimaux ; le plancher protège contre un `.env` rempli à la main.

### `JWT_EXPIRES` : l'unité est obligatoire

`^\d+[smhd]$`. jsonwebtoken lit un **nombre nu** comme des secondes et une **chaîne numérique**
comme des millisecondes : `900` signifierait 15 minutes ou 0,9 seconde selon une paire de
guillemets. Une durée de session ne se joue pas là-dessus.

## Ce qui a été fait

| Fichier | Modification |
|---|---|
| `backend/src/config/env.validation.ts` | `inspectAuth`, appelé avant le court-circuit `DATABASE_URL` et fusionné dans **les deux** `return` |
| `backend/src/config/env.validation.spec.ts` | bloc « lawyer authentication » |
| `backend/test/setup-env.ts` | les deux valeurs, secret de 34 caractères |
| `docker-compose.yml` | les deux variables au service `backend`, en `${VAR:?}` |
| `.env.example` | bloc auth réécrit, commentaire périmé sur le bucket corrigé |
| `README.md` | section « Configuration » : tableau des variables, règle de préfixe, absence délibérée de variable frontend |
| `issue_backlog.md` | A4 cochée ; trois écarts avec l'énoncé corrigés (voir ci-dessous) |

### Écarts backlog / énoncé corrigés au passage

Relecture de l'énoncé faite avant de planifier, comme pour chaque issue :

- **A4** annonçait « expiration par défaut, SMTP éventuel » — aucun des deux n'est dans l'énoncé.
- **C2** disait taille et types « configurables » — l'énoncé les fige. Reformulé en « appliqués », et
  le contrôle des *magic bytes* y est remonté depuis C4 : sans lui l'allowlist se contourne en
  mentant sur le `Content-Type`, ce n'est donc pas un supplément mais la validation elle-même.
- **C4** était en P1 alors que l'énoncé range l'antivirus dans les **bonus** → P2, et l'issue se
  réduit au scan.

Deux priorités discutables signalées sans être changées : **D2** (runner de tests frontend) n'a
aucune base dans l'énoncé, qui ne demande du Jest que sur la logique métier ; **E2** (densité UI
constante) est au contraire citée parmi les critères de design. Le reste concorde : huit
éliminatoires en P0, cinq attendus en P1, cinq bonus en P2.

## Tests ajoutés

Un bloc dans `env.validation.spec.ts`, qui protège quatre choses :

- **`JWT_SECRET` ou `JWT_EXPIRES` absente** → rejet nommant la variable. C'est ce qui empêche une
  variable de redevenir de la configuration morte.
- **Secret de 31 caractères rejeté, 32 accepté** — la borne exacte, sans quoi la constante peut
  dériver sans que rien ne le dise.
- **`900`, `15 m`, `15min`, `quinze minutes`, `m15` rejetés ; `60s`, `15m`, `2h`, `7d` acceptés.**
  `900` est le cas dangereux, pas le cas absurde.
- **Le chemin `DATABASE_URL` explicite renvoie bien le bloc auth** — le retour anticipé qui avait
  failli amputer le bloc stockage en A3. La même erreur, au même endroit, est désormais couverte
  deux fois.

Le test existant `never copies a secret into the error message` couvre déjà `JWT_SECRET` : la
nouvelle validation dit « JWT_SECRET is shorter than 32 characters », jamais la valeur.

`preserves the other variables` utilisait `JWT_SECRET: 'x'` comme exemple de variable inconnue
laissée intacte ; elle est désormais validée, le test utilise `NODE_ENV`.

## Vérification

Exécutée, pas seulement décrite :

1. `pnpm test` → **113 tests verts** ; `pnpm test:e2e` → 7 verts ; `pnpm lint` (les deux) vert.
2. `.env` amputé de `JWT_SECRET` → `docker compose config` échoue, exit 15 :
   `required variable JWT_SECRET is missing a value: definir JWT_SECRET dans .env`.
3. `./install.sh` sur le `.env` existant → exit 0, HTTP 200 depuis la machine (`JWT_EXPIRES` y était
   déjà, aucune clé à reporter).
4. `docker compose down -v`, `.env` retiré, `./install.sh` → chemin du `.env` neuf : exit 0,
   `JWT_SECRET` généré à **64 caractères**, `JWT_EXPIRES=15m` recopié depuis `.env.example` avec son
   bloc de commentaires. `install.sh` n'a effectivement demandé aucune modification.
5. Dans le conteneur : `printenv` montre `JWT_SECRET` et `JWT_EXPIRES` présentes, et
   **aucune `MINIO_ROOT_*`** — la frontière `STORAGE_*` / `MINIO_*` tient.
6. `/api/v1/health` interne → `{"status":"ok","db":"up","storage":"up"}`.

## Revue de code

Diff relu en entier. Aucun finding de correction ; deux constats consignés :

- **Moyen — la dérive `.env.example` / `docker-compose.yml` reste non couverte en CI.** Scénario :
  quelqu'un ajoute une variable requise à `validateEnv` et à `.env.example`, oublie le compose ; les
  tests passent, l'image se construit, et l'échec n'arrive qu'au `docker compose up` du correcteur.
  Assumé après analyse (§ Décisions) : l'échec nomme la variable et `install.sh` ne rend pas la main
  en 0, donc il ne peut pas passer inaperçu. À revoir si D3 finit par exécuter `./install.sh` en CI,
  ce qui couvrirait le cas sans écrire un seul test.
- **Faible — `JWT_SECRET_MIN_LENGTH` compte des *caractères*, pas des bits d'entropie.** Trente-deux
  caractères choisis par un humain valent bien moins que 32 hexadécimaux. La validation ne peut pas
  faire la différence ; c'est `install.sh` qui garantit la qualité réelle du secret en le tirant au
  sort. Le plancher protège du `.env` rempli à la main, pas d'un mot de passe choisi.

Un point d'hygiène relevé hors périmètre, à traiter à part : `/tmp/claude-1000/env.backup`, daté du
7 août, est une copie de `.env` en mode 644 sur une machine **partagée**. Elle contient un
`DB_PASSWORD` en clair. À détruire.

## Limites connues

- Aucun scanner de secrets dans le dépôt (`gitleaks` en pre-commit) : la protection repose sur
  `.gitignore` et sur la relecture. Complément naturel de D3.
- Aucune procédure de rotation documentée. Changer `JWT_SECRET` invalidera toutes les sessions dès
  que B1 existera ; changer `STORAGE_SECRET_KEY` exige de re-provisionner l'utilisateur MinIO.
- `JWT_EXPIRES` est validée mais pas encore lue : elle le sera par B1. C'est le prix assumé de la
  décision « valider avant de consommer », qui est précisément ce qui empêche la variable de rester
  morte.
