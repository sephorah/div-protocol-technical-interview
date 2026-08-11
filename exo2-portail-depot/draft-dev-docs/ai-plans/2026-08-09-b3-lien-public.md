# B3 — Lien public expirable protégé par PIN

*9 août 2026 — branche `feat/b3-lien-public-expirable`*

## Pourquoi

B2 livrait la création d'une demande avec son lien et son PIN. Trois trous restaient, et aucun ne se
voyait dans les tests :

1. **Le lien n'était qu'un jeton nu** dans la réponse. Rien ne savait devant quoi le coller.
2. **`expiresAt` était écrit et lu par personne.** Aucune ligne de code ne le consultait : un lien
   restait utilisable indéfiniment, et la suite passait au vert.
3. **Un PIN perdu condamnait la demande.** Il est haché en argon2id, donc irrécupérable, et rien ne
   permettait d'en émettre un autre.

## Ce que dit la consigne, et les deux options qu'elle a fermées

> « À titre indicatif, la surface d'API tourne autour de ça. Le découpage exact est ton choix, on
> regardera comment tu le justifies. »

**Option écartée n° 1 : le jeton après un `#`.** L'idée était de mettre le jeton dans le *fragment*
de l'URL — la partie que le navigateur n'envoie jamais au serveur. Elle ferme deux fuites d'un coup :
le jeton n'apparaît ni dans `access.log`, ni dans l'en-tête `Referer`. C'est le motif des liens de
partage chiffrés (Firefox Send, Privnote). Mais elle impose `POST /public/unlock` avec le jeton dans
le corps, alors que l'énoncé nomme `POST /public/:token/unlock`. **La consigne prime** : option
fermée, et le risque repris par le masquage des journaux.

Au passage, une piste voisine ne tient pas : *hacher* le jeton dans l'URL ne protège rien. Ce que
l'URL porte **est** le laissez-passer — mettre `H(jeton)` dedans et stocker `H(H(jeton))` renomme le
secret sans le retirer de l'adresse. Le hachage en base, lui, sert : il protège d'une fuite de la
base, pas d'une fuite de l'URL.

**Option retenue malgré son absence de l'énoncé : `POST /requests/:id/link`.** L'énoncé ne parle
nulle part de régénérer, et son tableau de bord ne mentionne que « Copier le lien ». Le découpage
étant explicitement libre et noté sur sa justification, la route est ajoutée — comme sous-ressource
de `/requests`, jamais comme seconde route de création.

Ce qui la justifie n'est pas le client qui égare son PIN. C'est **l'avocat qui ne l'a jamais vu** :
le PIN n'apparaît qu'une fois, dans la réponse à la création. Un onglet fermé, un rafraîchissement,
une réponse perdue après l'écriture en base — la demande existe, valide, et personne au monde n'en
connaît le code. Sans cette route elle meurt à sa naissance, et l'avocat retape tout dans une
nouvelle demande en laissant l'ancienne « en attente » pour toujours.

## Décisions

| Décision | Alternative écartée | Raison |
|---|---|---|
| `PUBLIC_BASE_URL` en configuration | Déduire l'origine de l'en-tête `Host` | L'en-tête vient de l'appelant : un appel forgé fait renvoyer un lien vers un domaine d'attaquant, que l'avocat colle dans un courriel |
| | Laisser le front composer l'URL | Le seed et tout envoi serveur n'auraient alors aucun moyen d'écrire un lien complet |
| Régénérer | Prolonger l'échéance du lien actif | Rallonger la vie d'un jeton déjà parti par courriel, hors de tout contrôle |
| 404 sur la demande d'autrui | 403 | Un 403 confirme que l'identifiant existe, ce qui suffit à énumérer les dossiers d'un confrère |
| `DELETE` idempotent, 204 | 200 avec un compteur | « 0 révoqué » invite l'appelant à lire un double-clic comme une erreur |
| Union discriminée pour `resolve` | Booléen, ou exception | C1 doit écraser les trois refus en une réponse unique ; la distinction sert aux tests et à G2, jamais à une route publique |
| Masquer le jeton dans le format de journal | `access_log off` sur ces routes | On perdrait toute visibilité sur exactement les routes anonymes, celles que F1 observera et que G1 limitera |
| | Ne rien faire | Le jeton s'écrirait en clair sur le disque d'une machine partagée avec d'autres candidats |

**Sécurité — ce qui est traité.** Le jeton et le PIN n'existent en clair qu'à l'émission. La
propriété est vérifiée en une seule requête (`findFirst` sur les deux critères), donc sans branche où
l'oublier. L'index unique partiel rend structurellement impossibles deux liens actifs, et sa
violation devient un 409 plutôt qu'un 500 muet. Les en-têtes ferment la fuite par `Referer` et
l'indexation.

**Sécurité — ce qui ne l'est pas**, et c'est dit dans le README : aucune limitation de débit sur le
PIN (10 000 combinaisons, seul argon2id borne l'attaquant — c'est G1) ; le jeton survit hors de nos
journaux, dans l'historique du navigateur du client et dans le courriel ; révoquer ne ferme pas une
session client déjà ouverte tant que C1 n'existe pas.

## Ce qui a été construit

Huit commits, un par tâche du plan.

| Commit | Contenu |
|---|---|
| `a4a306d` | `PUBLIC_BASE_URL` : `inspectPublic`, règle des trois fichiers, réalignement sur `DOMAIN` |
| `80bc2d0` | `buildDepositUrl`, `IssuedLink.url` remplace `token` |
| `ef1e133` | Extraction d'`isExpired` |
| `de0c524` | `PublicLinksService.resolve` |
| `0255380` | `regenerate`, `revoke`, décorateur `IsExpiresInDays` partagé |
| `ba86b56` | `RequestLinksController`, le seed délègue |
| `3d226e9` | nginx : en-têtes et masquage du jeton |
| *(celui-ci)* | Documentation |

**Deux choses n'étaient pas dans le plan et sont apparues en l'exécutant.**

Le **`chmod 600 .env`** dans la branche TLS d'`install.sh`. `set_env_value` écrit un fichier
temporaire puis le déplace, ce qui remet les droits au umask — et le `chmod` global s'exécute
*avant* cette branche. Sans la ligne ajoutée, activer HTTPS laissait `.env`, mot de passe de la base
et secret JWT compris, lisible par tous les autres candidats de la machine.

Le **décorateur `IsExpiresInDays`**. `expiresInDays` existait à l'identique dans les deux DTO, bornes
*et* messages français. Les bornes venaient déjà d'une constante partagée ; les messages, non — et
deux formulations pour une même règle est ce qu'un lecteur remarque avant un développeur.

## Vérification

**Tests** — 246 unitaires (+35), 61 e2e (+11), lint sans avertissement, `pnpm build` propre.

Ce que les nouvelles suites protègent, et non leur nombre :

- `public-url.spec.ts` — composition de l'URL, y compris la barre finale et l'encodage du jeton.
- `env.validation.spec.ts` — `PUBLIC_BASE_URL` absente, non-HTTP, porteuse d'un chemin, et sa
  **survie au court-circuit `DATABASE_URL`** : c'est le piège déjà connu du fichier, une valeur
  fusionnée dans un seul des deux `return` disparaît dès qu'on vise une base managée.
- `request-status.spec.ts` — `isExpired` à l'instant exact de l'échéance, isolément de `deriveStatus`
  puisque `resolve` en dépend maintenant.
- `public-links.service.spec.ts` — les quatre issues de `resolve` et la préséance de `revoked` sur
  `expired` ; côté `regenerate` : la recherche par empreinte et non par jeton, la révocation *avant*
  la création, l'exhaustivité des clés écrites (pour qu'une future colonne portant un secret ne
  rejoigne pas l'écriture en silence), le tirage distinct à chaque appel, l'échéance datée de
  maintenant, le cas où il n'y a rien à révoquer, le 409 sur `P2002` **et** le fait que toute autre
  erreur remonte intacte — l'avaler ferait conseiller un réessai qui ne réussira jamais.
- `regenerate-link.dto.spec.ts` — bornes, corps nommant le propriétaire, et l'absence de repli sur
  les messages anglais. Il prouve aussi que l'extraction du décorateur n'a perdu aucune règle.
- `requests.e2e-spec.ts` — 401 anonyme sur les deux routes (le contrôleur ne porte pas de garde : ce
  test est la seule preuve que le garde global le couvre), 404 sur la demande d'autrui, forme de la
  réponse, absence de hachage, 400 en français, et `DELETE` deux fois de suite.

**Bout en bout, à travers nginx** (pile reconstruite par `./install.sh --from-source`, 2 min 46 s) :

- Connexion 200, création 201, **régénération 201 en 97 ms**, 404 sur une demande inexistante,
  `DELETE` → 204 puis 204.
- En base : deux lignes `PublicLink` pour la demande, une seule active avant révocation ; **aucune
  demande de toute la base ne porte deux liens actifs** ; `tokenHash` en hexadécimal, `pinHash` en
  `$argon2id$`.
- En-têtes : `Referrer-Policy: no-referrer` et `X-Robots-Tag: noindex, nofollow` présents sur le 200
  **et sur le 403** de la sonde — le `always` fait son travail.
- Journal du proxy : `GET /depot/[redacted]` et `GET /api/v1/public/[redacted]/unlock`. Le suffixe
  `/unlock` est conservé, donc le journal reste lisible.
- Le seed imprime désormais l'URL complète, et `append_missing_keys` a bien rattrapé un `.env`
  antérieur à la nouvelle variable — cas réel, rencontré sur ce poste.

**Machine vierge** — `pnpm test:bare-machine` : succès en 2 min 23 s, avec la nouvelle assertion
`Referrer-Policy`.

**Le réalignement TLS d'`install.sh`**, lui, ne pouvait pas être rejoué en conditions réelles — il
faut un nom de domaine public résolvant vers la machine. Il a été exercé **hors du script**, en
extrayant ses vraies fonctions (`set_env_value`, `env_get`) plutôt qu'en les réécrivant :

| Cas | Attendu | Obtenu |
|---|---|---|
| `PUBLIC_BASE_URL` encore à la valeur par défaut | remplacée par `https://$DOMAIN`, droits 600 | conforme |
| Valeur saisie à la main (`https://portail.interne.cabinet`) | inchangée, droits 600 | conforme |
| Le même cas 1, **ligne `chmod` retirée** | droits dégradés | **644** |

Ce dernier cas est la preuve que la ligne ajoutée est porteuse : sans elle, activer HTTPS laissait
`.env` — mot de passe de la base et secret JWT compris — lisible par tous les comptes de la machine
partagée.

**Ce qui n'a PAS été vérifié, et pourquoi.** La campagne machine vierge appelle `./install.sh` nu,
qui **tire les images publiées 0.2.0** : elle valide `install.sh`, le rattrapage de `.env` et la
configuration nginx, mais **pas le backend de B3**, absent de ces images tant que la branche n'est
pas fusionnée. C'est `--from-source` qui l'a exercé. Reste aussi non exercé : le chemin TLS *complet*
d'`install.sh` (certbot, `nginx-tls.conf`), donc le fait que les deux en-têtes et le masquage
s'appliquent bien au serveur HTTPS. Le raisonnement est solide — `portal-locations.conf` est inclus
par les deux serveurs, et compose fusionne les montages par chemin cible — mais il n'est pas mesuré.

## Relecture de code

Six findings, tous corrigés. **Les trois premiers disent la même chose : le masquage du jeton livré
par la tâche 7 ne masquait rien**, et chacune de mes vérifications successives est passée à côté.

**1 — CRITIQUE. Deux lignes journalisées au lieu d'une.** J'avais d'abord repéré, seul, que
`access_log … redacted` posée dans `portal-locations.conf` ne couvrait pas le bloc `server` du port
80 du calque TLS (redirection + ACME), qui n'inclut pas ce fichier — un client tapant l'adresse sans
`https://` faisait donc écrire le jeton en clair avant redirection. J'ai « corrigé » en remontant la
directive au niveau `http`. **C'était pire.** nginx *cumule* les `access_log` déclarés au même
niveau, il ne les remplace pas, et l'image stock en déclare déjà un (`main`) dans son propre
`/etc/nginx/nginx.conf`, que nous ne montons pas. Chaque requête produisait alors les deux lignes.
Reproduit :

```
"GET /depot/PREUVE-EN-CLAIR-987 HTTP/1.1" 200   <- format `main` de l'image
"GET /depot/[redacted] HTTP/1.1" 200            <- le notre
```

Au niveau `server`, en revanche, la directive **remplace** celle héritée. Correctif : un fragment
`server-hardening.conf` portant l'`access_log` et les deux en-têtes, inclus par les **trois** blocs
`server` — plutôt qu'une ligne recopiée trois fois, ou une ligne unique qui ne couvre pas tout.

**Pourquoi ma vérification ne l'avait pas vu** : j'avais regardé `logs --tail 3 proxy | grep depot`.
La fenêtre était trop courte, et surtout l'assertion était *positive* — je cherchais `[redacted]`, je
l'ai trouvé, la ligne en clair était juste à côté hors du `tail`.

**2 — MOYEN. Le port 80 du calque TLS ne portait aucune des trois protections.** Même cause, réglé
par le même fragment : il l'inclut désormais.

**3 — MOYEN. Le conteneur frontend journalisait le jeton que nginx venait de masquer.** `serve`
écrit l'URL de chaque requête sur sa sortie standard, et les deux flux atterrissent au même endroit.
Mesuré avant correctif : `frontend-1 | HTTP … GET /depot/JETON-NEGATIF-4242`. Sans ce point, tout le
travail nginx ne protégeait rien. Correctif : `-L` (`--no-request-logging`) dans l'`ENTRYPOINT`.

**4 — MOYEN. L'assertion de la campagne machine vierge n'aurait attrapé aucun des trois.** Elle
vérifiait `Referrer-Policy` et serait restée verte. Ajoutée : une assertion **négative** — après une
requête sur `/depot/<jeton>`, les journaux du proxy *et* du frontend ne doivent contenir aucune
occurrence du jeton, et doivent contenir `[redacted]`. Négative à dessein : le mode d'échec ici est
une ligne **en trop**, pas une ligne manquante.

**5 — FAIBLE. Un littéral dupliqué désactivait silencieusement le réalignement TLS.**
`DEFAULT_PUBLIC_BASE_URL` dans `install.sh` doit être identique caractère pour caractère à la valeur
de `.env.example` ; sinon la comparaison ne matche plus jamais et une machine en production compose
des liens vers 127.0.0.1 pendant que l'API répond 201. Une garde lit `.env.example` au démarrage et
arrête le script en nommant les deux valeurs. Vérifiée en faisant diverger la valeur : le script
s'arrête.

**6 — FAIBLE. `LinkResolution.ok` transportait toute la ligne `PublicLink`**, `pinHash` et
`tokenHash` compris — seul un commentaire empêchait C1 de la sérialiser vers un client anonyme. Le
type est réduit à `Pick<PublicLink, 'id' | 'pinHash' | 'expiresAt'>` (le `pinHash` reste : vérifier
le PIN est précisément ce que C1 en fera), le `select` Prisma est explicite, et la construction se
fait champ par champ — un spread aurait laissé passer `revokedAt` sans que TypeScript le signale. Un
test verrouille la liste exhaustive des clés.

**Jugé sain par la relecture** : la mécanique `map`/`log_format` et l'ordre `00-` ; le chemin
`P2002` → 409, y compris le fait qu'un rollback laisse l'ancien lien actif ; l'asymétrie des deux
échéances ; `isExpired` partagé ; la propriété en un seul `findFirst` répondant 404 ; l'absence de
consommateur résiduel du `token` nu ; `applyDecorators` ; la délégation du seed ; et
`PUBLIC_BASE_URL` fusionnée dans les **deux** `return` de `validateEnv`.

**Après correctifs** : 247 tests unitaires, 61 e2e, lint et build propres ; `nginx -t` passe ;
assertion négative vérifiée sur la pile réelle, jeton absent des journaux du proxy **et** du
frontend, `[redacted]` présent.

## Livraison

Fusion dans `main`, puis publication en **0.3.0** (tag `exo2-v0.3.0` — le déclencheur du workflow est
`exo2-v*`, le dépôt hébergeant plusieurs exercices ; un `v0.3.0` ne publierait rien, en silence).

**Le bump de version n'est pas une formalité, et l'oublier aurait annulé la livraison.**
`docker-compose.yml` épinglait `0.2.0` : fusionner publie `edge` et `sha-<court>`, mais cette
étiquette-là continue de désigner l'ancienne image. Un évaluateur lançant `./install.sh` aurait
obtenu un portail **sans B3 du tout**. C'est la campagne machine vierge qui l'a révélé, en échouant
sur la nouvelle assertion négative : les images publiées fuyaient encore le jeton.

L'ordre suivi est celui que documente `infra/README.md` — vérifier l'**artefact réel** avant de figer
une version, plutôt que de promouvoir une image qu'on n'a jamais vue tourner : pile de production
lancée sur `IMAGE_TAG=sha-8b71841`, cinq services `running`, deux en-têtes présents, jeton absent des
journaux du proxy et du frontend, puis connexion 200, création 201, **régénération 201 en 112 ms**,
révocation 204. Le tag n'a été posé qu'après.

Campagne machine vierge finale, épingle déplacée : **succès en 3 min 36 s**, six assertions vertes
dont le masquage du jeton.

## Ce qui reste ouvert

- **G1**, limitation de débit par jeton de lien : c'est ce qui manque pour que 4 chiffres soient
  défendables.
- **C1** doit porter le `linkId` dans la session client, contrainte ajoutée à son entrée du backlog.
- Le tableau de bord (**B4**) et les écrans (**B5**) donneront leur place aux deux actions. B5 devra
  traiter l'affichage du PIN comme une étape à confirmer, copie en un clic puis accusé explicite,
  plutôt que comme un texte qu'on peut quitter par mégarde — la régénération est le filet, mieux vaut
  ne pas avoir à s'en servir.
