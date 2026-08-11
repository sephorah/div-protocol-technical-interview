# B4 — Dashboard des demandes

Date : 2026-08-09. Branche : `b4-dashboard`. Issue : B4 du `issue_backlog.md`.

## Pourquoi

L'avocat pouvait créer une demande (B2) et gérer son lien (B3), mais **il ne pouvait rien relire**.
`POST /requests` répond une fois, et ensuite la demande sortait de sa vue : aucune route ne disait
quelles demandes existaient, laquelle avait reçu ses pièces, laquelle avait expiré. L'énoncé fige
pourtant `GET /requests` — « Affiche le tableau de bord avec listes et statuts » — et décrit le
produit par ce tableau de bord : « Un dashboard lui montre le statut de chaque demande : en attente,
complète, expirée. »

## Ce que dit la consigne, et ce qu'elle ne dit pas

La liste de routes de l'énoncé est donnée « à titre indicatif » et s'arrête à
`POST /public/:token/files`. Elle nomme `GET /requests` et **rien d'autre** côté avocat : ni détail
d'une demande, ni téléchargement.

`GET /requests/:id` est donc un ajout, et il se justifie tout seul : le critère « pièces attendues,
pièces reçues, horodatages » ne tient pas dans une ligne de liste. La liste porte des compteurs
(« 1 sur 3 »), le détail porte les libellés et les fichiers.

## Le périmètre a été réduit, et c'est la décision principale

Le backlog portait un quatrième critère : « téléchargement des pièces déposées ». Il est **sorti de
B4** et devient l'issue **B4b**, dépendante de C2.

La raison n'est pas le temps. C'est que **C2 n'existe pas** : aucune ligne `UploadedFile` ne peut
naître autrement qu'insérée à la main, donc la route serait livrée sans qu'aucun parcours réel ne
l'ait exercée — le genre de code qui a l'air fini et ne l'est pas. Les décisions qu'elle demande
appartiennent d'ailleurs à C2 : URL présignée MinIO ou flux à travers l'API, `Content-Disposition`,
durée de validité du lien de téléchargement.

Le téléchargement reste **nécessaire au produit** — « l'avocat doit récupérer des pièces chez son
client », et un portail qui collecte sans jamais rendre fait moins bien que le courriel qu'il
remplace. Il est nécessaire au produit, pas à cette issue.

## Décisions

**1. Le statut garde les trois valeurs de l'énoncé ; l'état du lien est un champ voisin.**
B3 permet de révoquer. La révocation date `revokedAt` et ne supprime rien, donc l'échéance survit.
Le statut se calcule sur le **dernier lien émis, actif ou non**, et `link.state` dit `active` ou
`revoked` à côté. Les deux faits sont indépendants : une demande peut être **complète et coupée**.

Un quatrième statut `revoked` a été écarté : il écrase « toutes les pièces sont là » sur une demande
dont le lien a été coupé après coup, et il s'éloigne des trois valeurs que l'énoncé nomme. Traiter
la révocation comme une expiration a été écarté aussi : l'avocat ne distingue plus une échéance
atteinte d'une coupure qu'il a lui-même décidée, donc il ne sait pas s'il doit régénérer.

**2. Le statut reste dérivé, jamais stocké.** Une colonne ne serait pas seulement pénible à tenir à
jour, elle serait **fausse** : entre l'instant d'expiration et le passage d'un job, elle affirmerait
« en attente » sur une demande que plus personne ne peut ouvrir — et sans job, pour toujours.
`deriveStatus` de B2 a été réutilisée **sans une ligne de modification**.

**3. `link` n'est pas nullable ; une liste de liens vide lève une erreur.** Première version du plan :
`LinkView | null`. Revu après relecture — le cas est impossible par construction (création,
révocation et régénération laissent toujours une ligne), et le rendre nullable faisait payer une
corruption de la base à tout appelant **tout en la masquant** derrière un 200 d'apparence normale.
Conséquence : la tâche qui modifiait `request-status.ts` a disparu du plan.

**4. Pagination par décalage (`page` / `pageSize`), plafonnée à 100.** Un curseur serait stable si
une demande était créée pendant qu'on feuillette, mais il supprime le numéro de page et le total,
donc le « 3 sur 47 » de l'interface. À la volumétrie d'un cabinet, le compromis penche de ce côté ;
le défaut est consigné dans les limites du README. Le plafond est une constante du code
(`MAX_PAGE_SIZE`), pas une variable d'environnement : il protège l'API, il ne dépend pas du
déploiement.

**5. Pas de filtre par statut.** Le statut étant dérivé, le filtrer correctement veut dire le
recalculer en SQL, donc en avoir deux définitions qui peuvent diverger sans qu'aucun test ne le
voie. `forbidNonWhitelisted` s'appliquant à la chaîne de requête, `?status=expired` répond 400
plutôt que d'ignorer silencieusement un filtre que personne n'a écrit.

## Sécurité

- **404 et jamais 403** sur la demande d'un autre avocat — un 403 confirme qu'un identifiant existe
  chez un confrère, ce qui suffit à énumérer sa clientèle. Le message a été extrait dans
  `request-ownership.ts` : écrit deux fois, les deux formulations dérivent, et deux phrases pour un
  seul refus sont exactement l'indice qu'on cherchait à supprimer en évitant le 403.
- **L'appartenance est un critère de la clause `where`**, jamais une comparaison après lecture : il
  n'existe aucune branche où le contrôle puisse être oublié.
- **`pageSize` borné** — sans plafond, un seul appel authentifié tire la table entière et ses pièces.
- **Aucun secret dans une réponse.** Les vues se construisent champ par champ, jamais par spread ;
  un test unitaire fige la liste exacte des champs, et un test e2e balaie le corps entier des deux
  routes en cherchant `hash`, `token` ou `pin`.

Risques résiduels, consignés au README : la pagination par décalage peut montrer deux fois ou sauter
une demande si une création survient pendant qu'on feuillette ; et `originalName` est restitué tel
que le client l'a envoyé — jamais utilisé comme chemin, mais B5 devra l'échapper à l'affichage.

## Ce qui a été construit

Six commits, chacun avec son cycle de test.

- `request.types.ts` — `LinkView`, `RequestSummaryView`, `RequestDetailView`, `RequestPageView` et
  leurs constructeurs `toRequestSummary` / `toRequestDetail`.
- `dto/list-requests.dto.ts` — `page`, `pageSize`, `DEFAULT_PAGE_SIZE` (20), `MAX_PAGE_SIZE` (100),
  messages en français.
- `request-ownership.ts` — `requestNotFound()`, consommé par `PublicLinksService` et par
  `RequestsService`.
- `requests.service.ts` — `list()` et `findOne()`, plus la constante `LAST_LINK`.
- `requests.controller.ts` — les deux routes `@Get`.
- `test/dashboard.e2e-spec.ts` — 18 cas contre un vrai Postgres.

## Les pièges rencontrés

**`@Transform` ne s'exécute pas sur une clé absente.** Le plan prévoyait de porter les valeurs par
défaut dans la fonction de transformation, précisément pour éviter que `@Type(() => Number)` écrase
l'initialiseur. C'était faux dans l'autre sens : class-transformer saute entièrement le
`@Transform` d'une clé que l'objet ne porte pas, donc `page` restait `undefined` et échouait à
`@IsInt`. Le test « defaults to the first page » l'a attrapé au premier lancement. Les défauts sont
revenus sur les initialiseurs de propriété ; la transformation ne couvre plus que `?page=` — chaîne
vide, que `Number()` lit comme 0 et que `@Min(1)` refuserait.

**`as const` est incompatible avec les paramètres de Prisma.** Il fait de `orderBy` un tuple en
lecture seule, que le type mutable attendu refuse ; l'enlever élargit `'desc'` en `string`, que
Prisma refuse aussi. `satisfies Prisma.DepositRequest$linksArgs` donne les deux : types littéraux et
objet mutable.

**Deux liens peuvent partager leur horodatage à la milliseconde.** Postgres date `now()` de la
*transaction*, et la régénération révoque puis insère à l'intérieur d'une seule. Trier sur
`createdAt` seul ne départage donc pas les deux lignes. `LAST_LINK` trie d'abord sur `revokedAt`,
valeurs nulles en tête — le lien actif gagne quoi qu'il arrive. Un test e2e couvre exactement ce cas.

## Vérification

- **257 tests unitaires**, **83 e2e** (18 nouveaux), lint sans avertissement des deux côtés.
- **À travers nginx**, après `./install.sh --from-source` : liste en **28 ms**, détail en **13 ms**,
  404 sur un identifiant inconnu, 401 anonyme, 400 sur `?status=expired`. C'est le seul chemin qui
  traverse le proxy — aucune suite ne le fait.

Ce que protège la nouvelle suite e2e, cas par cas : les deux routes fermées à l'anonyme ; une page
vide plutôt qu'une erreur quand rien n'existe ; l'ordre du plus récent au plus ancien ; le filtre
d'appartenance, qui doit cacher les demandes d'un confrère **y compris dans le total** ; le découpage
en pages ; une page demandée au-delà de la dernière, qui répond vide et non en erreur ; le refus
d'une taille de page au-dessus du plafond et d'un paramètre inconnu ; les compteurs quand un fichier
est attaché ; le passage à `complete` quand toutes les pièces sont là ; le passage à `expired` quand
l'échéance est dépassée ; le statut qui reste à trois valeurs après une révocation ; le lien actif
qui gagne après une régénération ; l'ordre `position` des pièces et les métadonnées du fichier ; le
404 sur la demande d'un confrère et le **même** 404 sur un identifiant inexistant ; et l'absence de
tout hachage, jeton ou PIN dans les deux réponses.

Trois de ces cas n'ont de sens que contre une vraie base : le filtre d'appartenance, l'ordre des
pièces (que `createdAt` ne peut pas donner) et le départage des deux liens d'une régénération.

## Relecture de code

Relecture du diff complet, faite à la main plutôt que par sous-agents. Deux findings, tous deux
corrigés avant la fusion.

**Moyen — message d'erreur interne en français.** `toLinkView` levait « La demande X n'a aucun lien
public. » Nest ne renvoie jamais ce texte au client : un 500 sort en `Internal server error`. Le
seul lecteur de ce message est donc le journal, où la règle du projet veut de l'anglais. Passé en
`Request X has no public link.`, test ajusté.

**Faible — deux opérateurs pour un même test.** `countReceived` écrivait `item.file != null` et
`toRequestDetail` écrivait `item.file === null`. Le second ne couvre pas `undefined` : une ligne où
`file` serait absent plutôt que nul prendrait la branche « fichier présent » et lirait
`.originalName` sur `undefined`. Les types l'interdisent aujourd'hui ; aligné sur `!= null`, comme
`toItemView` depuis B2.

## Ce qui reste ouvert

- **`received` face à un `UploadStatus.failed`.** Aujourd'hui « reçu » veut dire « un fichier est
  attaché ». La colonne `status` prévoit `failed` pour C4 ; compter un fichier refusé comme reçu
  sera faux. Non tranché ici parce que rien ne peut encore écrire `failed`.
- **B4b**, le téléchargement, après C2.
- **L'échappement de `originalName`** à l'affichage, qui appartient à B5.
- **Le message de `forbidNonWhitelisted` est en anglais** (`property status should not exist`). Il
  vient du `ValidationPipe`, pas de nos décorateurs, et le comportement est le même depuis B2 sur
  les corps de requête. Le franciser demanderait une fabrique d'erreurs sur le pipe global — une
  décision qui dépasse cette issue.
