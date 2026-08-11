# Architecture

Les choix de conception du portail, et ce qu'on a écarté. Le code n'en garde qu'un renvoi.

Les trois autres documents : `docs/exploitation.md` (déploiement, proxy, TLS, registre),
`docs/observabilite.md` (métriques, alertes, runbook), `docs/tests-manuels.md` (la recette).

---

## Le tour d'horizon

```
navigateur ──▶ nginx (seul port publié) ──┬──▶ frontend  (SPA statique, serve -s)
                                          └──▶ backend   (NestJS)
                                                  ├──▶ PostgreSQL 17 (Prisma 7)
                                                  └──▶ MinIO (S3)
```

Une seule origine, donc **aucun CORS à configurer**. Garder cette propriété en appelant l'API en
chemin relatif (`/api/...`), jamais par une URL absolue.

### Pourquoi pas Next.js

NestJS fournit déjà l'étage serveur. Next ajouterait un **second runtime Node** dont le seul vrai
travail serait de relayer les appels à Nest — un processus de plus à déployer, à surveiller et à
mettre à jour, pour un gain nul ici. Le rendu côté serveur et le référencement sont d'ailleurs
**indésirables** : c'est un portail privé qui ne doit pas être indexé (`X-Robots-Tag: noindex`), et
dont chaque écran est derrière une authentification ou un PIN. Le SPA se compile en fichiers
statiques ; il reste **un seul processus applicatif** à exploiter.

Ce que ce choix coûte, honnêtement : pas de rendu initial côté serveur, donc un premier affichage
qui attend le JavaScript. Sur un portail à quelques visites par dossier, c'est sans conséquence.

### Le découpage frontend / backend

Le frontend est un **Vite + React 19**, thème Chakra v3 conforme à la charte DIV. Deux populations
d'écrans, et la frontière est nette : côté avocat les routes sont en anglais (`/login`,
`/dashboard`), côté client la route est `/deposit/<jeton>` — **et celle-là n'est pas la nôtre à
renommer** : le backend la compose (`DEPOSIT_PATH`) et nginx masque exactement ce préfixe dans ses
journaux, donc les trois bougent ensemble ou pas du tout.

---

## Le modèle de données

Cinq entités : `Lawyer` → `DepositRequest` → (`RequestedItem` → `UploadedFile`, `PublicLink`).

### Le statut n'est pas une colonne

`expired` dépend de l'horloge : une colonne stockée serait fausse entre l'instant d'expiration et le
passage d'un travail de fond qui la retournerait, et le tableau de bord mentirait pendant ce temps.
Le statut est donc **dérivé** — de même que « combien de pièces sont attendues », qui est un
`count(RequestedItem)`. Ne pas « optimiser » l'un ou l'autre en colonne.

L'ordre des deux règles a changé, et c'est un correctif : **une demande complète le reste après la
date limite.** Un client dépose ses trois pièces, l'échéance passe, et le tableau de bord basculait
de *complète* à *expirée* — un dossier abouti ressemblait à un dossier abandonné. La règle est
maintenant : tout reçu → *complète* ; sinon échéance dépassée → *expirée* ; sinon *en attente*.

**Le statut décrit le dossier, le lien décrit l'accès**, et les deux sont indépendants :
`PublicLinksService.resolve` ferme toujours un lien expiré, même sur une demande complète. Une
demande peut donc être **complète ET coupée** — c'est pourquoi `link.state` (`active` / `revoked`)
est un champ à part et non une quatrième valeur de statut, qui perdrait celui des deux faits qu'elle
ne porterait pas.

La comparaison d'expiration est **stricte** : à l'instant exact de l'échéance, le lien fonctionne
encore. Elle n'a qu'une définition (`isExpired`), partagée par le tableau de bord et par la
résolution d'un lien — écrites deux fois, elles pourraient diverger d'une milliseconde, un lien
refusé pendant que la demande s'affiche encore « en attente », et chaque côté aurait raison
séparément, donc aucun test ne tomberait.

### `PublicLink` est une table, pas trois colonnes

Régénérer, c'est **révoquer puis insérer** : un ancien PIN ne peut donc pas survivre à une
régénération. Cet invariant repose sur un **index unique partiel écrit à la main dans la migration**
(`WHERE "revokedAt" IS NULL`) — Prisma ne sait pas exprimer un index conditionnel, et régénérer la
migration le supprimerait en silence. Il a été vérifié de la seule façon qui vaille : en effaçant
l'index de la migration, en regardant le test tomber, et en restaurant.

Le classement du « dernier lien » se fait sur `revokedAt` (nuls d'abord), **pas sur `createdAt`** :
Postgres date `now()` de la *transaction*, et la régénération révoque et insère dans une seule
transaction, donc les deux lignes peuvent partager la même milliseconde.

### `RequestedItem.position` existe parce que `createdAt` ne peut pas ordonner

Les pièces d'une demande sont insérées dans la même écriture imbriquée : elles partagent leur
horodatage à la milliseconde, et Postgres est libre de les rendre dans n'importe quel ordre — la
liste du client se réordonnerait entre deux chargements de page. Chaque lecture porte donc un
`orderBy: { position: 'asc' }`.

### Aucun secret n'est stocké en clair, le jeton compris

| Valeur | Stockage | Pourquoi |
|---|---|---|
| jeton de lien public | SHA-256 | c'est un laissez-passer : en clair, une fuite de base livrerait tous les liens actifs. 256 bits ne se devinent pas, donc un hachage rapide suffit — et il reste indexable, donc la recherche par jeton est une seule lecture |
| PIN | argon2id | 4 chiffres, 10 000 combinaisons : il faut rendre chaque essai coûteux |
| mot de passe avocat | argon2id | idem |

**Conséquence à énoncer plutôt qu'à redécouvrir : le lien et le PIN n'existent en clair qu'une fois**,
dans la réponse de création (et de régénération). Un PIN perdu ne se réaffiche pas, **il se
remplace**.

Les paramètres argon2id sont ceux de l'OWASP (**m=19456, t=2, p=1**), mesurés à **67 ms** contre
**312 ms** pour les valeurs par défaut de la bibliothèque. L'écart n'achète presque rien — les
hachages sont salés, donc il ne joue que contre une attaque hors ligne après fuite — et il se paie
sur le chemin le plus exposé du portail, `/public/:token/unlock`, ouvert à un client anonyme. À
312 ms et 64 Mio par requête, et tant qu'il n'y a pas de limitation de débit, c'est un facteur
d'amplification confortable pour saturer l'API à bon compte. Ce sont des **constantes, pas des
variables d'environnement** : un paramètre de coût mal tapé dégraderait la sécurité en silence.

Tout tirage aléatoire passe par `node:crypto`, jamais par `Math.random`, dont la suite se reconstruit
à partir de quelques sorties observées. Le jeton est en **base64url** plutôt qu'en hexadécimal : 43
caractères au lieu de 64 pour la même entropie, et un alphabet sûr dans une URL comme dans un QR
code. `randomUUID()` est écarté — un UUIDv4 ne porte que 122 bits et sa structure se reconnaît d'un
coup d'œil.

### Ce qui n'existe pas, et pourquoi c'est acceptable

Il n'y a **pas de table d'audit**. L'énoncé la classe en bonus, et son coût d'ajout sera le même plus
tard — contrairement à `PublicLink`, dont l'extraction tardive aurait demandé une migration de
données **plus** une réécriture de chaque requête touchant au jeton, au PIN ou à l'expiration.

`mimeType` est une chaîne et non une énumération Postgres : la liste des types acceptés doit pouvoir
changer sans migration.

---

## L'authentification

**`@nestjs/jwt` seul, pas de Passport.** Les types de `PassportStrategy` sont assez faibles pour
déclencher `no-unsafe-call`, que le lint bloquant refuse, et sa raison d'être (Google, SAML, LDAP)
ne s'applique pas à un portail à un seul compte.

**Toute route est fermée par défaut.** `JwtAuthGuard` est enregistré en `APP_GUARD`, et `@Public()`
est la seule sortie : un nouveau contrôleur naît protégé. Enregistré depuis `AuthModule` et non
`AppModule`, parce qu'un provider résout ses dépendances dans le module qui le déclare et que
`JwtService` y vit. `app.useGlobalGuards()` n'est **pas** une alternative : il instancie le garde hors
du conteneur d'injection, donc sans `JwtService` ni `Reflector`.

**La sonde de santé doit porter `@Public()`.** Derrière le garde elle répond 401, docker déclare le
conteneur malade, et le backend redémarre en boucle sans une ligne de journal parlant
d'authentification. Ce qui la garde hors d'internet est un autre mécanisme : le `deny all` de nginx.

**Le drapeau `Secure` du cookie se décide par requête**, depuis `X-Forwarded-Proto` via `req.secure`,
jamais depuis `NODE_ENV`. Les images portent `NODE_ENV=production`, mais le portail de l'évaluateur
répond en clair sur `127.0.0.1:21600` : un cookie `Secure` y est posé et jamais renvoyé, donc la
connexion échoue en silence, en production, pour eux seuls. C'est à cela que sert
`app.set('trust proxy', 1)` — sans lui Express ignore l'en-tête et le cookie part sans `Secure`
**même en HTTPS**.

**Une adresse inconnue doit coûter le même temps qu'un mot de passe faux.** Le service vérifie contre
un hachage-leurre calculé une fois au démarrage. Un `if (lawyer === null) throw` précoce ressemble à
une simplification et réinstalle l'énumérateur de comptes.

**Il n'y a délibérément pas de limitation de débit sur `/auth/login`.** Derrière le passthrough SNI de
la machine, toutes les requêtes portent la même adresse : une limite par IP serait une limite
globale, et un attaquant consommerait le quota pour enfermer l'avocat dehors. Ce qui borne le coût à
la place est un `@MaxLength` sur le DTO — le coût d'argon2id croît avec son entrée, et la route est
anonyme.

**La charge utile ne porte que `sub`**, et le garde relit le compte à chaque requête. Cela coûte une
lecture indexée et achète la seule révocation de ce dessin : un compte supprimé cesse d'utiliser les
jetons émis avant sa suppression. `verifyAsync<JwtPayload>` est un *cast*, pas une validation, d'où le
contrôle explicite sur `sub` — sans lui, un jeton sans sujet atteint Prisma avec `id: undefined` et
répond 500 là où tout le reste répond 401.

### Les jetons de rafraîchissement

Le jeton d'accès est court et **irrévocable** ; le jeton de rafraîchissement est ce qui rend une
session fermable. C'est un secret opaque de 256 bits, stocké en SHA-256, **tourné à chaque usage**,
conformément à la **RFC 9700 § 4.14.2** — qui impose la rotation *ou* une liaison cryptographique au
client, et ne dit rien des durées.

- **Les lignes tournées sont CONSERVÉES, jamais supprimées.** Leur présence est la seule chose qui
  rende un rejeu reconnaissable : supprimées, un jeton volé ressemblerait à un jeton inconnu et
  aucune détection ne partirait jamais.
- **Une fenêtre de course de 30 secondes** empêche la fonctionnalité de se retourner contre son
  utilisateur. Deux onglets qui rafraîchissent en même temps présentent le même jeton ; le second
  arrive après la rotation du premier et ressemble à un vol. Dans la fenêtre, la requête est refusée
  **sans** révoquer la famille — le navigateur partage ses cookies entre onglets, donc le nouvel essai
  aboutit. Sans cela, un usage normal à deux onglets déconnecte l'avocat.
- **Révoquer toute la famille est NOTRE décision, pas celle de la RFC**, qui parle du « jeton de
  rafraîchissement actif ». On va plus loin parce que le serveur ne sait pas distinguer le voleur de
  la victime.
- **Deux échéances, et l'asymétrie est porteuse** : le plafond (7 j) est **recopié** à la rotation,
  l'inactivité (3 j) est **recalculée**. Recopier l'inactivité déconnecterait l'avocat en plein
  travail le troisième jour ; recalculer le plafond rendrait la session immortelle.
- **La prise du jeton est un compare-and-set atomique**, emballé avec l'insertion du successeur dans
  une seule transaction. Une lecture puis une écriture laisseraient deux requêtes concurrentes croire
  toutes deux qu'elles ont gagné ; séparer la paire laisserait un échec d'insertion révoquer le jeton
  présenté sans remplaçant, c'est-à-dire un hoquet de base de données mettant fin à une session de
  sept jours.
- **Un refus « course » ne doit PAS effacer les cookies** : c'est la moitié cliente de la fenêtre de
  30 s, et les effacer déconnecterait l'avocat pour avoir eu deux onglets ouverts. Tout autre refus
  est terminal et les efface.

Le cookie de rafraîchissement est **restreint à `${API_PREFIX}/auth`** : le navigateur n'attache
jamais le secret de longue durée à un appel d'API ordinaire. Déplacer les routes hors de ce préfixe
casserait le renouvellement en silence.

Deux clés distinctes, `JWT_SECRET` et `CLIENT_JWT_SECRET`, et l'API refuse de démarrer si elles sont
égales : partagée, une session de dépôt présentée au garde avocat passerait la vérification de
signature, et la frontière entre les deux populations ne tiendrait plus qu'à un test applicatif
(RFC 8725 § 3.8).

---

## Le stockage objet

MinIO derrière `@aws-sdk/client-s3`. **Rien dans le code ne nomme MinIO** — seul l'endpoint le sait,
et c'est tout l'objet du préfixe `STORAGE_` : MinIO est une implémentation de S3, pas le contrat.
Viser un S3 managé plus tard est un changement d'endpoint, pas une réécriture.

**Aucune pièce ne touche le disque de l'API** : `memoryStorage` est écrit explicitement, et
`putObject` utilise `Upload` (lib-storage) et non `PutObjectCommand`. Ce dernier exige un
`ContentLength`, qui ne pourrait venir que du `Content-Length` déclaré par le client — la seule valeur
qu'il ne faut pas croire. `Upload` n'a besoin d'aucune taille à l'avance et bascule seul en multipart.

`forcePathStyle: true` est codé en dur, sans variable : MinIO n'a pas de DNS virtual-hosted, donc
`bucket.host` ne résout pas. Le rendre configurable serait un bouton que personne ne tourne jamais.

Le détail du provisionnement, des ARN de la policy et de la suppression par préfixe est dans
`docs/exploitation.md § Le stockage objet` — c'est de l'exploitation autant que de la conception.

---

## Le dépôt d'une pièce

L'ordre des étapes est porteur, et les deux qui semblent interchangeables ne le sont pas :

1. **le contrôle d'appartenance d'abord**, pour qu'aucun octet ne soit écrit pour une pièce que
   l'appelant ne possède pas ;
2. **l'objet précédent n'est effacé qu'APRÈS l'écriture de la nouvelle ligne.** Inversé, un
   `putObject` qui échouerait laisserait la pièce sans aucun fichier alors qu'elle en avait un — un
   client qui corrige un document perdrait le premier.

**Le type est lu dans les octets**, jamais dans le nom ni dans le `Content-Type` déclaré : un
exécutable renommé `.pdf` est refusé en 415 avant toute écriture.

**Une pièce appartenant à une autre demande répond 404, jamais 403.** Un 403 confirmerait à un
appelant anonyme que la pièce existe ailleurs. La requête porte sur les deux critères à la fois
(`findFirst`), et non sur une lecture suivie d'une comparaison : il n'y a alors aucune branche où le
contrôle puisse être oublié. Même règle côté avocat pour une demande qui n'est pas la sienne.

`upsert` sur `requestedItemId`, unique au schéma : un second dépôt **remplace**, il ne versionne pas.
L'upsert est une lecture puis une écriture, donc **pas atomique** contre un concurrent : l'index
unique arrête le second avec un `P2002`, que le service traduit en **409** — un perdant de double
clic mérite une réponse réessayable. Seul `P2002` : avaler toutes les erreurs dans un 409 dirait à
l'appelant de réessayer un appel qui ne peut jamais aboutir.

---

## Validation et messages

Les messages de `class-validator` sont en **français**, et **chaque décorateur a besoin du sien
explicitement** — sans quoi la bibliothèque sert son défaut anglais au milieu des autres
(« title must be shorter than… »). Un test unitaire rejette tout message contenant « must ».

Les libellés en double sont refusés par `@ArrayUnique` **après** que `@Transform` a coupé les espaces,
class-transformer s'exécutant avant class-validator : c'est ce qui fait de `"Bail "` un doublon de
`"Bail"`. Le faire dans le service arriverait après la validation, avec un corps d'erreur de forme
différente.

`forbidNonWhitelisted` s'applique aussi à la chaîne de requête, donc `?status=expired` est un 400 —
délibérément : un filtre que personne n'a implémenté doit échouer bruyamment plutôt qu'être ignoré.
**Il n'y a pas de filtre par statut** : le statut est dérivé, donc le filtrer en SQL serait une
seconde définition de la règle, libre de diverger de la première sans qu'aucun test ne puisse le voir.

Les bornes sont des **constantes de code, pas des variables d'environnement** : 1 à 20 pièces, 200
caractères par libellé et par titre, 1 à 90 jours de validité, 100 par page. Elles protègent l'API,
elles ne dépendent pas du déploiement. Le plafond de 90 jours borne la durée de vie d'un lien oublié.

---

## Le frontend

`frontend/src/theme/` porte **un seul `createSystem`** : jetons bruts, jetons sémantiques, recettes,
styles de texte. Les écrans les consomment et **n'écrivent jamais une couleur, une police ou un
rayon** — un composant manquant se crée dans le thème, pas dans la page.

Cinq pièges de Chakra v3, tous trouvés au navigateur parce que **jsdom ne calcule aucun style** :

- **les variantes livrées avec Chakra battent le `base` d'une recette, en silence** — un titre écrit à
  11 px rendait 18 px. Ce que la charte fixe doit donc être répété dans les variantes susceptibles de
  l'emporter ;
- **un `textStyle` bat un `fontSize` déclaré à côté** : la réponse est de remplacer le `textStyle` sur
  la même clé, pas d'ajouter une taille ;
- **`height: 'auto'`** dans les recettes de bouton et de champ est porteur : Chakra fixe une hauteur
  par taille, qui l'emporterait sur les marges de la charte et écraserait le composant ;
- **le contour au survol est un `boxShadow: inset`, jamais une bordure** : une bordure qui apparaît
  décale le libellé d'un pixel, un anneau intérieur ne prend pas de place ;
- **`size` est déclaré après `variant` dans la recette de bouton, donc il l'emporte** : la taille et
  la marge d'une nouvelle variante doivent vivre dans un `size`, pas dans la variante. La variante
  `link` (l'action « Copier » posée dans la boîte du lien) a pour cette raison sa propre taille
  `inline`, à marge nulle — écrites dans la variante, ses 13 px auraient été écrasés par `md` à
  16 px, en silence.

**Le survol d'un bouton secondaire prend le violet sur les trois plans** — fond `#F7F6FF`, texte
`#5100FF`, anneau `#DBCDFF` — et pas seulement le fond. La variante porte aussi un bloc `_disabled`
qui **neutralise ce survol** : sans lui, « Précédent » désactivé dans la pagination du tableau de
bord virait au violet au passage de la souris et se lisait comme cliquable.

**Le bloc « lien généré » est une seule boîte**, comme le kit le dessine : le conteneur porte la
bordure, le fond, le rayon et l'anneau de focus (`_focusWithin`), et le champ à l'intérieur est
transparent (variante `bare`). Le champ **reste un `<input readOnly>` et non un texte** : quand le
presse-papier refuse, `CopyField` sélectionne son contenu, ce qui transforme « recopiez à la main »
en un seul Ctrl+C — sur une valeur qui n'est affichée qu'une fois.

**Le bouton de dépôt du client est primaire tant que la pièce manque**, secondaire une fois qu'elle
est reçue (« Remplacer le fichier »). Le kit dessine « Deposer » en primaire ; tout passer en violet
plein ferait d'une liste de vingt pièces un mur où plus rien ne ressort.

**Clair uniquement, et le mécanisme est l'absence** : aucune condition `_dark` n'est déclarée et rien
ne pose la classe `dark` sur le document. Ne pas réintroduire un bascule « pour rendre ça
configurable ».

**Inter est auto-hébergée.** Google Fonts ferait contacter un tiers par le navigateur de l'avocat à
chaque visite, sur un produit dont l'argument est la traçabilité d'un dossier. Vérifié : 40 requêtes
au chargement, aucune hors origine — et c'est aussi ce qui permet à la CSP de tenir en
`default-src 'self'`.

**Le préfixe d'API est écrit une quatrième fois côté navigateur**, qui ne peut pas lire `.env`. Une
`VITE_API_PREFIX` serait figée dans l'image au moment du build en CI : configurable en apparence
seulement. Ce que cette copie achète, c'est qu'une divergence se lise comme elle-même — le client
d'API signale un 404 comme sa propre catégorie d'erreur, et l'écran dit « API introuvable » et non
« serveur injoignable ».

**`/auth/login` ne déclenche jamais un renouvellement de session** : un 401 y signifie mot de passe
faux, pas jeton expiré. Sans cette exception, une connexion refusée appelait `/auth/login` puis
`/auth/refresh`.
