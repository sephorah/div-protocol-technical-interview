# B1c — Jeton de rafraîchissement révocable

Date : 2026-08-09 · Branche : `feat/b1c-jeton-de-rafraichissement`

## Le besoin

B1 avait livré un jeton d'accès de 2 h en cookie `httpOnly`. Sa faiblesse n'était pas sa durée :
c'est qu'**on ne pouvait pas le fermer**. `POST /auth/logout` effaçait un cookie sans rien invalider,
et le seul levier restant était de supprimer le compte — ce qui coupe tout, et n'est pas une action
de session.

L'argument avancé en B1 pour s'en passer — « l'avocat ne reste pas connecté longtemps » — parlait de
confort, pas de sécurité. Il ne répondait pas à la question posée, et l'utilisatrice l'a relevé.

## Décisions, et ce qu'elles écartent

| Sujet | Choix | Alternative écartée |
|---|---|---|
| Détection de rejeu | **Rotation** à chaque usage | La RFC 9700 laisse le choix entre rotation et liaison cryptographique au client (mTLS, DPoP). DPoP suppose que le client signe chaque requête avec une clé privée, qu'un SPA ne peut pas garder hors de portée d'un XSS. |
| Nature du jeton | Secret opaque de 256 bits, haché en SHA-256 | Un second JWT : il serait auto-porteur, donc irrévocable — exactement le défaut qu'on corrige. |
| Portée de la révocation | **Toute la famille** | Le seul jeton présenté, ce que dit littéralement la RFC. Écarté : le serveur ne peut pas distinguer la victime de l'attaquant, donc laisser vivre la chaîne revient à parier que le dernier arrivé est le bon. |
| Durées | Accès 15 min, plafond 7 j, inactivité 3 j | Session glissante sans plafond : un accès obtenu discrètement et entretenu ne se refermerait jamais. Inactivité de 2 j : toute session du vendredi meurt le lundi, donc reconnexion hebdomadaire systématique. |
| Concurrence | Tolérance de **30 s** | Aucune tolérance : deux onglets ouverts déclencheraient une fausse détection et déconnecteraient l'avocat. C'est le mode d'échec classique de ce mécanisme. |

### Le point que la lecture de la norme a corrigé

Le plan initial affirmait que RFC 9700 **impose** la révocation de la famille. La lecture du texte
(§ 4.14.2) l'a démenti : elle impose la rotation *ou* la liaison au client, et sur la suite elle dit
seulement que le serveur « révoquera le jeton de rafraîchissement actif ». Elle ne fixe par ailleurs
**aucune durée** : « The expiration time is at the discretion of the authorization server ».

Les deux affirmations ont été corrigées dans le plan avant implémentation. Cela vaut d'être noté :
les résumés de blogs consultés d'abord présentaient la révocation de famille comme une exigence.

## Ce qui a été construit

`backend/src/auth/refresh-token.service.ts` porte toute la logique de sécurité, séparée de la
vérification du mot de passe pour être lisible et testable seule. S'y ajoutent la table
`RefreshToken`, le cookie `portail_refresh` limité à `${API_PREFIX}/auth`, la route
`POST /auth/refresh`, une déconnexion qui révoque, et `src/config/duration.ts` — extrait de
`auth-cookie.ts` parce que la validation d'environnement compare deux durées et que `config/` ne doit
pas dépendre de `auth/`.

### Trois points qui décident du résultat

1. **Les lignes tournées sont conservées.** Contre-intuitif — on voudrait supprimer un jeton usagé —
   mais c'est leur présence qui rend une réutilisation reconnaissable. Supprimées, un jeton volé
   ressemblerait à un jeton inconnu et aucune détection ne partirait jamais.
2. **L'asymétrie des deux échéances.** `expiresAt` se **recopie** à la rotation, `idleExpiresAt` se
   **recalcule**. Les traiter pareil rend la session immortelle dans un sens, déconnecte l'avocat en
   pleine séance au troisième jour dans l'autre — et rien ne le signalerait. Deux tests unitaires
   existent pour ce seul point.
3. **La réclamation est un compare-and-set atomique** (`updateMany ... where revokedAt: null`, puis
   contrôle du `count`). Un read-then-write laisserait deux requêtes concurrentes croire toutes deux
   qu'elles ont gagné, et créer deux successeurs dans une même famille.

## Vérification

| Contrôle | Résultat |
|---|---|
| `pnpm -C backend lint` (bloquant) | 0 avertissement |
| `pnpm -C backend build` | vert |
| `pnpm -C backend test` | **177 tests**, 10 suites |
| `pnpm -C backend test:e2e` | **39 tests**, 3 suites |
| `./install.sh --from-source` | conteneurs démarrés, seed rejoué |
| Login via nginx | 200, **deux** `Set-Cookie` : `portail_auth` (`Max-Age=900`, `Path=/`) et `portail_refresh` (`Max-Age=604800`, `Path=/api/v1/auth`), les deux `HttpOnly; SameSite=Strict` |
| Rafraîchissement légitime | 200, nouveau couple de cookies |
| Rejeu d'un cookie copié, **moins de 30 s** après | 401, **aucun cookie effacé** (pas de `Expires=…1970` dans la réponse), et la session légitime répond encore 200 |
| Rejeu d'un cookie copié, **35 s** après | 401, **et la session légitime aussi** — détection |
| État en base après détection | famille à **0 jeton actif sur 2** |
| Déconnexion puis rafraîchissement avec le cookie copié | 204 puis **401** |

Le premier essai du scénario de vol a rendu 200 sur la troisième requête, ce qui ressemblait à un
échec : c'était la tolérance de 30 s qui jouait son rôle, le rejeu ayant suivi la rotation de quelques
secondes. Il a fallu attendre 35 s pour observer la détection. Autrement dit, les deux comportements
ont été vérifiés — celui qui protège l'avocat, et celui qui l'alerte.

### Ce que protègent les tests ajoutés

- `refresh-token.service.spec.ts` (14 tests) — la rotation, le maintien du plafond, le report de
  l'inactivité, les deux échéances, la détection de réutilisation, les **deux** formes de course
  (jeton tourné il y a peu, et compare-and-set perdu), la révocation de famille, la purge.
- `auth.service.spec.ts` (+3) — l'ouverture de session avec purge, le refus de renouveler quand le
  compte a disparu entre-temps, et les deux durées lues chacune à sa propre clé.
- `auth.e2e-spec.ts` (+8) — le parcours complet à travers `configureApp()`, dont les deux cas que le
  plafond seul laisserait passer : une session inutilisée quatre jours doit mourir, une session
  utilisée tous les deux jours doit vivre. La table est remplacée par un magasin en mémoire qui
  applique vraiment les règles, pas par un double rendant des valeurs figées — sinon une détection
  cassée passerait.
- `duration.spec.ts` — les durées invalides, `0h` compris.
- `env.validation.spec.ts` (+3) — dont le refus d'une inactivité au-delà du plafond, la panne
  silencieuse type : la variable est renseignée, elle a l'air de faire quelque chose, elle ne fait
  rien.

## Revue de code

Relecture par sous-agent (`superpowers:requesting-code-review`), puis traitement
(`superpowers:receiving-code-review`). **Aucun finding critique** : le relecteur a cherché
explicitement un contournement de la détection, une fuite de jeton, un accès inter-avocats et une
course entre la lecture et la réclamation.

Un finding important, et c'est **le plan qui l'avait introduit**, pas l'implémentation :

> **`refresh()` effaçait les deux cookies sur *toute* erreur, `raced` compris.**
> Or `raced` existe précisément parce que le navigateur détient encore un cookie valide — celui que
> l'autre onglet vient d'obtenir. L'effacer déconnecte l'avocat pour avoir ouvert deux onglets,
> c'est-à-dire annule côté client la protection qu'on venait d'écrire côté serveur. Aucun test ne le
> couvrait, donc la suite était verte.

Corrigé : seules les erreurs terminales effacent les cookies. Deux cas e2e ajoutés — l'un vérifie
qu'un rejeu concurrent **ne pose aucun cookie** et que la session survit, l'autre qu'une expiration
réelle les efface bien. Vérifié aussi dans les conteneurs : le rejeu concurrent répond 401 sans
aucune ligne `Expires=…1970`, et le rafraîchissement suivant rend 200.

Autres correctifs :

| Gravité | Finding | Correctif |
|---|---|---|
| Important | Réclamation et création du successeur hors transaction : un `INSERT` en échec laissait le jeton présenté révoqué sans remplaçant — une panne réseau passagère tuait une session de 7 jours | `$transaction` autour des deux, avec la limite honnête écrite en commentaire (READ COMMITTED rend la paire atomique, il ne ferme pas la milliseconde où un `revokeFamily` concurrent se glisse) |
| Important | Le README réaffirmait que la révocation de famille est « explicite dans la norme », se contredisant douze lignes plus bas | phrase supprimée |
| Important | Table des variables du README périmée : `JWT_EXPIRES` à `2h`, `SESSION_*` absentes | table corrigée, et le piège du `.env` existant y figure désormais (il n'était que dans ce fichier) |
| Mineur | `purgeExpired` supprimait aussi sur `idleExpiresAt`, donc effaçait les maillons anciens d'une chaîne vivante : un rejeu y répondait `unknown` au lieu de `reused`, sans révocation | purge sur le plafond seul, avec le raisonnement en commentaire et une assertion de test |
| Mineur | Le `Max-Age` du cookie de rafraîchissement repartait à 7 jours à chaque rotation, donc dépassait la fin de session | le cookie reçoit ce qui **reste** de la session ; `rotate` et `issue` rendent l'échéance |
| Mineur | Le double e2e de `updateMany` correspondait à **toutes** les lignes quand aucun discriminant n'était fourni | il lève désormais une erreur, plutôt que de laisser passer une révocation trop large |
| Mineur | Trois doubles jamais réinitialisés entre tests | ajoutés au `mockClear` |
| Mineur | Une phrase sur la conservation des lignes tournées répétée sept fois | retirée du docblock de classe |

Deux cas de test ajoutés au passage : un cookie de rafraîchissement vide ou malformé doit répondre
401 comme un autre.

## Limites connues

Toutes reportées au README :

- **Le jeton d'accès reste irrévocable pendant ses 15 minutes** — nature du JWT. La déconnexion coupe
  le renouvellement, pas le quart d'heure en cours.
- **La tolérance de 30 s** laisse un attaquant rejouer sans déclencher l'alerte pendant cet
  intervalle. Il n'y gagne rien, mais la détection ne part pas.
- **Aucune notification** lors d'une détection : la session tombe, personne n'est prévenu.
- **Pas de liste des sessions actives** ni de déconnexion à distance — porté en **B1b**.
- **Toujours aucune limitation de débit**, ni sur `/auth/login` ni sur `/auth/refresh` : inchangé, et
  pour la même raison qu'en B1 — derrière le passthrough TLS, une limite par IP est une limite
  globale. Reste en G1.

## Note d'exploitation

Sur une machine dont le `.env` précède ce chantier, `JWT_EXPIRES` **reste à 2 h** :
`append_missing_keys` n'écrase jamais une valeur choisie. Les deux nouvelles clés, elles, sont
ajoutées automatiquement. Corriger `JWT_EXPIRES` à la main sur les déploiements existants.
