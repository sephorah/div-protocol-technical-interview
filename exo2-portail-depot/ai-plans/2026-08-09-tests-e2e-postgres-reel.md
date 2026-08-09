# Tests e2e contre un vrai Postgres

*9 août 2026 — branche `test/e2e-testcontainers`*

## Pourquoi

Les trois suites de `test/` remplaçaient `PrismaService` par un objet écrit à la main. La question
qui a lancé le travail était directe : « c'est des tests e2e, il faut tester avec le vrai non ? »
Elle est juste, et trois coûts précis la justifient.

**Le double se maintient à la main.** Livrer B3 a obligé à lui apprendre `depositRequest.findFirst`,
`publicLink.updateMany` et `publicLink.create`. Chaque route nouvelle allongeait la doublure.

**Le double ment.** Son `$transaction` était `fn(prismaDouble)` : il n'annulait rien. Le test du
conflit 409 simulait un rejet `P2002`, donc il prouvait qu'on traduisait bien l'erreur — **pas que
la contrainte qui la produit existe**. Or cette contrainte est l'index unique **partiel**
« un seul lien actif par demande », écrit à la main dans
`prisma/migrations/20260808014756_initial_model/migration.sql` parce que Prisma ne sait pas exprimer
un index conditionnel. `CLAUDE.md` le signale déjà comme disparaissant en silence si la migration est
régénérée. Le jour où ça arrive : deux liens actifs possibles, un ancien PIN survivant à la
régénération censée le remplacer, et 304 tests au vert.

**Le nom mentait.** Ce n'étaient pas des tests de bout en bout.

## La règle renversée, et l'argument qui était faux

`CLAUDE.md` documentait l'inverse comme une décision : « `test` et `test:e2e` doivent rester
exécutables sur une machine nue — c'est ce que la CI lancera. » La raison invoquée était fausse : les
exécuteurs GitHub hébergés embarquent un démon Docker. Ce qu'on échange réellement, c'est la vitesse
et la boucle de développement locale, pas la faisabilité en CI.

## Le montage, et pourquoi pas le plus simple

Un autre dépôt (`VigilArt`) fait la même chose en un seul fichier : un `setupFilesAfterEnv` avec un
`beforeAll` qui démarre le conteneur et pose `process.env.DATABASE_URL`. C'est plus simple, et j'ai
d'abord cru pouvoir le reprendre. **Il ne marche pas ici**, et l'échec serait silencieux.

`ConfigService.get()` consulte l'environnement **validé** avant de regarder `process.env`
(`@nestjs/config/dist/config.service.js` : la lecture validée est testée quelques lignes avant le
repli sur `process.env`). Or notre `validate: validateEnv` *fabrique* `DATABASE_URL` à partir des cinq
`DB_*`, au moment où `app.module.ts` est importé. Un `beforeAll` qui écrirait `process.env.DATABASE_URL`
arriverait après, et serait ignoré : pas d'erreur, juste des suites qui parlent à `127.0.0.1:5432`.
VigilArt s'en sort parce que son `ConfigModule.forRoot()` n'a **pas** de `validate` — chez eux la
valeur descend jusqu'à `process.env`.

Second écart, mesuré : leur `setupFilesAfterEnv` s'exécute une fois **par fichier de test**, soit 4
Postgres et 4 Redis pour 4 fichiers. Le `globalSetup` n'en démarre qu'un pour toute la campagne.

Une variante rendrait le montage en `beforeAll` possible : publier le conteneur sur un **port hôte
fixe**, connu de `setup-env.ts` à l'avance. Écartée — la machine de recette est partagée avec
d'autres candidats, donc un port fixe entre en collision, et les exécutions parallèles aussi.

## Ce qui a été construit

| Fichier | Rôle |
|---|---|
| `test/global-setup.ts` | Démarre `postgres:17-alpine`, applique les vraies migrations, expose `DATABASE_URL` |
| `test/global-teardown.ts` | Arrête le conteneur |
| `test/database.ts` | `resetDatabase()` (TRUNCATE CASCADE) et `insertLawyer()` |
| `test/api-client.ts` | `API_PREFIX` par `ConfigService.getOrThrow`, `request.agent` pour les cookies |

Le conteneur passe par **`@testcontainers/postgresql`** plutôt que par le `GenericContainer`
générique. Le paquet dédié porte en amont un détail qu'on maintiendrait sinon soi-même : l'image
Postgres démarre la base pour ses scripts d'initialisation, l'éteint, puis la redémarre, donc se
connecter au premier message « prêt » tombe sur une base qui s'apprête à s'arrêter. Écrit à la main,
c'était `Wait.forLogMessage(/ready to accept connections/, 2)` — un « 2 » qu'il fallait expliquer.

**L'`ApiClient` n'est pas utilisé par `auth.e2e-spec.ts`, et c'est délibéré.** Cette suite teste les
cookies eux-mêmes (`HttpOnly`, `Max-Age`, `Path`, `Secure`) et rejoue exprès un ancien jeton de
rafraîchissement pour déclencher la détection de réutilisation. Un pot de cookies automatique
écraserait le cookie sous les pieds du test, et la détection ne partirait jamais.

## Le piège qui a coûté le plus de temps

`PrismaService.onModuleInit` levait :

```
TypeError: A dynamic import callback was invoked without --experimental-vm-modules
```

Prisma 7 charge son compilateur de requêtes **WebAssembly** par un `import()` dynamique, que la
machine virtuelle CommonJS de Jest refuse. Aucune connexion ne s'ouvrait. Le drapeau est désormais
dans le script `test:e2e` lui-même, pas dans une consigne à retenir. Contrepartie acceptée : Node
imprime un `ExperimentalWarning` à chaque exécution.

`maxWorkers: 1` est l'autre réglage porteur : les trois suites partagent une base et la vident entre
chaque test. En parallèle elles se la videraient mutuellement, avec des échecs intermittents. Un
schéma par `JEST_WORKER_ID` est l'échappatoire si la durée devient gênante.

## Trois tests que seule une vraie base porte

- **L'index refuse un second lien actif.** Rien d'autre ne le couvrait : la route de régénération
  révoque avant d'insérer, donc elle n'entre jamais en collision.
- **Le même index accepte les liens révoqués à côté de l'actif.** L'autre moitié de la règle : s'il
  était total, régénérer une seconde fois échouerait et l'historique des révocations serait
  impossible — ce pour quoi `PublicLink` est une table.
- **`onDelete: Cascade` efface pièces et liens** avec la demande. Une pièce orpheline garderait un
  dossier supprimé vivant dans le tableau de bord.

## Vérification

| Quoi | Résultat |
|---|---|
| `pnpm lint` (backend + frontend, bloquants) | 0 |
| `pnpm test` | 244 tests, 15 suites — **3,7 s** |
| `pnpm test:e2e` | 65 tests, 3 suites — **20,3 s** (était 8,457 s pour 60 tests) |
| `pnpm test:integration` | 9 tests — **4,7 s** |
| `pnpm build` puis inspection de `dist/` | aucun fichier de `test/` compilé |

**La preuve que le nouveau test sert.** L'index a été supprimé à la main de la migration, la suite
relancée : **exactement un test échoue**, « forbids a second active link, by index », les 26 autres
passent. Le fichier a ensuite été restauré et `git diff` sur `prisma/` est vide. Sans cette
manipulation, rien ne dirait que le test attrape la régression qu'il prétend attraper.

`tsconfig.build.json` et `.dockerignore` excluent le répertoire `test` **entier**, pas seulement les
`*.spec.ts` — vérifié par un vrai build, donc `@testcontainers/postgresql`, qui est une dépendance de
développement, ne peut pas se retrouver dans l'image de production après `pnpm prune --prod`.

## L'erreur commise en route

`pnpm add -D @testcontainers/postgresql` a été lancé depuis le mauvais répertoire — le shell
réinitialise son répertoire courant entre deux commandes. Il a modifié le `package.json`
d'orchestration à la racine, son lockfile, et **créé un `pnpm-workspace.yaml` racine**, ce qui
transformerait les deux applications en workspace pnpm — exactement ce que le projet évite. Les trois
ont été annulés. C'est ce qui a fait apparaître, au passage, que `pnpm install --frozen-lockfile`
sortait alors en 1 ; après correction il sort en 0.

## Ce qui n'est pas couvert

- **Aucun test ne traverse nginx ni le frontend.** Le parcours réel à travers la pile reste une
  vérification à la main, jusqu'à ce qu'un test piloté par navigateur existe.
- **La suite d'intégration du seed** (exécuté deux fois, comptages assertés) reste à écrire. Le
  harnais existe désormais ; il ne manque que la suite. Reporté dans D1.
- Les `*.spec.ts` à côté des sources gardent leurs doublures, à dessein : y injecter une base les
  rendrait lents et flous sur ce qu'ils prouvent.
- `storage.int-spec.ts` reste une suite séparée : autre dépendance, et elle ne passe pas par HTTP.
