# Nettoyage : tests essentiels, commentaires relogés, README concis

> **Pour les agents :** SOUS-SKILL REQUISE — `superpowers:subagent-driven-development` (recommandée)
> ou `superpowers:executing-plans`. Les étapes sont en cases à cocher.

**Ce document remplace le plan de sprint parallèle**, qui est terminé et archivé dans
`ai-plans/2026-08-10-sprint-final-parallele.md`. Il ne le prolonge pas : c'est une autre tâche.

**But :** ramener la base de code à ce qui se lit — ne garder que les tests qui protègent vraiment
quelque chose, sortir la prose d'architecture du code vers un README court et un dossier `docs/`,
et corriger trois défauts trouvés en chemin.

**Approche :** cinq passes indépendantes, chacune vérifiable seule. Aucune ne change le
comportement du produit sauf la première (règle de statut) et la deuxième (métriques), qui sont
petites et testées. Les passes de suppression viennent après, pour qu'elles voient l'état final.

**Stack :** NestJS 11 / Jest, Vite + React 19 / Vitest, Prometheus + Grafana, nginx, docker compose.

## Contraintes globales

- **Tout le code en anglais** — identifiants, commentaires, noms de métriques, titres de tests.
  Seuls l'UI, les messages `class-validator` et les livrables écrits sont en français.
- Arrow functions, jamais `function name()`.
- `ConfigService.getOrThrow`, jamais `process.env`, jamais de valeur de repli.
- Les deux lints sont bloquants : `pnpm -C backend lint` (`--max-warnings 0`) et
  `pnpm -C frontend lint` (`--deny-warnings`).
- Commits en **Conventional Commits**, en anglais. **Annoncer les fichiers avant chaque commit et
  attendre le feu vert.** Jamais `git add -A` ni `git add .`. Pousser n'est jamais implicite.
- Ne jamais toucher `infra/` et `.env` sans le dire : la machine est partagée.

## Règle de commentaire, applicable à partir de maintenant

Un commentaire n'existe que pour **ce qui ne se lit pas dans le code** : un piège, une contrainte
externe, une alternative évidente écartée. **1 à 3 lignes.** Tout raisonnement plus long — mesures,
historique d'un bug, comparatif d'options, justification d'un choix — va dans `README.md` ou
`docs/`, et le code n'en garde au plus qu'un renvoi d'une ligne (`voir docs/architecture.md § TLS`).

Ce qui disparaît sans remplacement : les bannières de séparation (`# ---------`), les en-têtes de
fichier qui racontent une issue, les docblocks qui répètent la signature.

---

## Task 1 : mémoriser la règle, corriger le backlog

**Fichiers :**
- Créer : `~/.claude/projects/.../memory/commentaires-courts-doc-dans-readme.md`
- Modifier : `~/.claude/projects/.../memory/MEMORY.md` (une ligne de pointeur)
- Modifier : `issue_backlog.md` (C4 repasse en P2/bonus ; E2 reste en P1)

- [ ] **Étape 1 : écrire la mémoire globale**

```markdown
---
name: commentaires-courts-doc-dans-readme
description: Les commentaires de code restent courts et factuels ; les décisions d'architecture vont dans le README, jamais en bloc inline.
metadata:
  type: feedback
---

Un commentaire ne dit que ce qui ne se lit pas dans le code — un piège, une contrainte externe, une
alternative écartée — en **1 à 3 lignes**. Les choix d'architecture et les décisions prises (infra,
backend, frontend) sont documentés **uniquement** dans un README clair et concis à la racine, jamais
en blocs de commentaires dans le code ni dans les fichiers de configuration.

**Pourquoi :** le code doit être auto-explicatif. Des blocs de commentaires polluent la lecture, et
un raisonnement long noie les rares commentaires qui comptent. Mesuré sur exo2-portail-depot avant
nettoyage : 1 ligne sur 4 était un commentaire, et 49 % dans `infra/`.

**Comment l'appliquer :** avant d'écrire un commentaire de plus de 3 lignes, le déplacer dans la
documentation et ne laisser qu'un renvoi. Voir [[commentaires-pertinents]].
```

- [ ] **Étape 2 : ajouter le pointeur dans `MEMORY.md`**

```markdown
- [Commentaires courts, doc dans le README](commentaires-courts-doc-dans-readme.md) — 1-3 lignes max dans le code ; les décisions d'archi vont au README.
```

- [ ] **Étape 3 : remettre C4 en bonus dans `issue_backlog.md`**

Annuler la reclassification de C4 faite plus tôt dans cette session : titre `### C4. Antivirus sur
les pièces déposées — P2 (bonus)`, et retirer C4 du tableau « Ce qui reste » et de la section
« Deux exceptions », qui ne parle plus que d'E2. **E2 reste en P1** (critère *attendu*).

- [ ] **Étape 4 : commit**

```bash
git add issue_backlog.md
git commit -m "docs(backlog): put C4 back under the statement's bonuses, keep E2 as expected"
```

---

## Task 2 : le fichier de tests manuels

**Fichiers :** Créer `docs/tests-manuels.md`.

C'est un livrable à part entière : la liste que les correcteurs et vous pouvez dérouler. Le contenu
est celui déjà rédigé dans la conversation — huit blocs *obligatoires* (A1 à A7) et cinq blocs
*attendus* (B1 à B5), chaque ligne étant une case à cocher portant **l'action exacte et le résultat
attendu**, pas une intention.

- [ ] **Étape 1 : écrire `docs/tests-manuels.md`**

Structure imposée :

```markdown
# Tests manuels

Ce que le produit doit démontrer, dérivé de l'énoncé. Deux parties : les critères **obligatoires**,
puis les **attendus**. Chaque ligne est une action et son résultat attendu.

Pile lancée : `./install.sh`, puis http://127.0.0.1:21600

## A. Critères obligatoires
### A1. install.sh va jusqu'aux URLs, sur machine nue
- [ ] ... (action → attendu)
...
## B. Critères attendus
### B1. Tests Jest
...
```

Trois exigences de rédaction :

1. **Chaque case porte la commande ou le geste**, pas le sujet. « `ls -l .env` → 600 », pas
   « vérifier les permissions ».
2. **Les cases qu'on sait ouvertes sont marquées telles quelles**, avec la raison : l'antivirus
   n'existe pas (bonus), les violations CSP ne sont pas comptées, `ai-logs/` n'est pas caviardé.
3. **Les pièges de diagnostic sont notés à côté de la case concernée** — le plus important étant
   qu'il faut ouvrir le lien client en **navigation privée** et non dans un autre onglet, sinon on
   emporte le cookie avocat.

- [ ] **Étape 2 : relire la liste contre l'énoncé**

Ouvrir https://exercice-stagiaire-div.vercel.app/exo/portail-depot et vérifier que **chaque** ligne
des sections « Critères obligatoires » et « Critères attendus » a au moins une case dans le fichier.
Les bonus (URLs pré-signées, audit, CI, rate limiting) n'ont **pas** à y figurer.

- [ ] **Étape 3 : commit**

```bash
git add docs/tests-manuels.md
git commit -m "docs: add the manual acceptance checklist derived from the statement"
```

---

## Task 3 : une demande complète le reste, même après la date limite

**Le défaut :** un client dépose ses trois pièces, la date limite passe, et le tableau de bord de
l'avocat bascule de *complète* à *expirée*. Un dossier abouti ressemble alors à un dossier
abandonné.

**Fichiers :**
- Modifier : `backend/src/requests/request-status.ts` (`deriveStatus`)
- Modifier : `backend/src/requests/request-status.spec.ts`
- Vérifier : `backend/test/dashboard.e2e-spec.ts` (« reports a request whose deadline has passed as
  expired » — le cas y est incomplet, donc il doit rester vert sans changement ; le confirmer)

**Interfaces :** signature inchangée — `deriveStatus(input: StatusInput, now: Date): RequestStatus`.
Aucun appelant à modifier.

- [ ] **Étape 1 : écrire le test qui échoue**

Dans `request-status.spec.ts`, **remplacer** le cas
`reports expired rather than complete once the deadline has passed` par :

```ts
  // A finished case must not read as an abandoned one: everything arrived, so
  // the deadline passing changes nothing the lawyer needs to act on.
  it('stays complete once every piece is in, even past the deadline', () => {
    expect(
      deriveStatus(
        { expiresAt: EXPIRY, expectedCount: 3, receivedCount: 3 },
        after,
      ),
    ).toBe(RequestStatus.Complete);
  });

  it('still reports expired when a piece is missing at the deadline', () => {
    expect(
      deriveStatus(
        { expiresAt: EXPIRY, expectedCount: 3, receivedCount: 2 },
        after,
      ),
    ).toBe(RequestStatus.Expired);
  });
```

- [ ] **Étape 2 : constater l'échec**

Run : `pnpm -C backend test request-status`
Attendu : le premier cas échoue avec `Expected "complete", received "expired"`. Le second passe déjà.

- [ ] **Étape 3 : inverser les deux branches**

```ts
export const deriveStatus = (input: StatusInput, now: Date): RequestStatus => {
  // Completeness is checked first: a request whose pieces all arrived is done,
  // and the deadline passing afterwards does not undo the work.
  if (input.expectedCount > 0 && input.receivedCount >= input.expectedCount) {
    return RequestStatus.Complete;
  }

  if (isExpired(input.expiresAt, now)) {
    return RequestStatus.Expired;
  }

  return RequestStatus.Pending;
};
```

- [ ] **Étape 4 : vérifier**

Run : `pnpm -C backend test request-status && pnpm -C backend test:e2e`
Attendu : tout vert. **Si un cas e2e du tableau de bord tombe, le lire avant de le corriger** — il
dira si un scénario incomplet a été confondu avec un complet.

- [ ] **Étape 5 : ce qui NE change pas, et qu'il faut confirmer**

`isExpired` reste la seule définition de « dépassée », et `PublicLinksService.resolve` continue de
l'appeler : **un lien expiré reste fermé au client même si la demande est complète**. Le statut
décrit le dossier, le lien décrit l'accès. Vérifier que `public.e2e-spec.ts` (« dies as soon as the
link expires ») reste vert — c'est la preuve que les deux ne se sont pas mélangés.

- [ ] **Étape 6 : commit**

```bash
git add backend/src/requests/request-status.ts backend/src/requests/request-status.spec.ts
git commit -m "fix(requests): keep a complete request complete after its deadline"
```

---

## Task 4 : métriques — noms anglais, et les deux questions qu'elles ne savaient pas répondre

**Fichiers :**
- Modifier : `backend/src/metrics/metrics.service.ts`
- Modifier : `backend/src/public/deposits.service.ts`, `backend/src/public/upload-limit.filter.ts`
- Modifier : `infra/grafana/dashboards/portail.json` (9 panneaux),
  `infra/grafana/provisioning/alerting/portail-alerts.yml` (4 règles)
- Modifier : `backend/src/metrics/metrics.service.spec.ts` et les blocs « the counters » des specs
  appelantes (voir Task 5, qui les élague ensuite)

**Interfaces produites :**

```ts
recordDeposit(outcome: DepositOutcome): void          // inchangé
recordUnlock(outcome: UnlockOutcome): void            // inchangé
recordExpiredLinkHit(): void                          // inchangé
observeUploadBytes(bytes: number): void               // inchangé
observeHttpRequest(m: string, r: string, s: number, sec: number): void  // inchangé
recordRequestCompleted(): void                        // NOUVEAU
observeRejectedUploadBytes(declaredBytes: number): void // NOUVEAU
```

### 4a — renommer `portail_` en `portal_`

Cinq noms de métriques sont en français au milieu d'un fichier entièrement anglais. Aucun coût
caché : renommer une métrique jette son historique, et il n'y en a pas.

- [ ] **Étape 1** : remplacer le préfixe dans `metrics.service.ts` — `portal_deposits_total`,
  `portal_unlock_attempts_total`, `portal_expired_link_hits_total`, `portal_upload_bytes`,
  `portal_http_request_duration_seconds`.
- [ ] **Étape 2** : `grep -rn "portail_" infra/ backend/` → **zéro** résultat. Les fichiers Grafana
  gardent leur *nom de fichier* (`portail.json`, `portail-alerts.yml`) et leur `uid`, ce sont des
  identifiants de tableau de bord, pas du code. Le `job_name: portail-backend` de
  `infra/prometheus/prometheus.yml` devient `portal-backend`, et il faut alors le suivre dans les
  requêtes `up{job=...}` du tableau de bord **et** de l'alerte 1.
- [ ] **Étape 3** : `pnpm -C backend test metrics` → vert.

### 4b — combien de demandes aboutissent

Aucune métrique ne dit combien de **demandes** passent à *complète* : `deposits_total` compte des
**fichiers**. C'est pourtant la question produit la plus utile.

- [ ] **Étape 4 : test d'abord**, dans `deposits.service.spec.ts` :

```ts
  it('counts the request as completed when the last expected piece lands', async () => {
    // ... deposit the third of three pieces
    expect(metrics.recordRequestCompleted).toHaveBeenCalledTimes(1);
  });

  it('does not count it again on a replacement deposit', async () => {
    // ... redeposit onto an already-received piece of an already-complete request
    expect(metrics.recordRequestCompleted).not.toHaveBeenCalled();
  });
```

Le second cas est celui qui compte : sans lui, un client qui remplace un fichier ferait grimper le
compteur des dossiers aboutis, et le taux d'aboutissement dépasserait 100 %.

- [ ] **Étape 5** : compteur `portal_requests_completed_total` (sans étiquette), incrémenté dans
  `deposits.service.ts` uniquement quand le dépôt **fait passer** la demande de incomplète à
  complète — donc en comparant l'état avant et après, pas en relisant l'état après.
- [ ] **Étape 6** : `pnpm -C backend test deposits && pnpm -C backend test:e2e` → vert.

### 4c — de combien les fichiers refusés dépassent

`deposits_total{outcome="rejected_size"}` dit **combien** de fichiers sont refusés, jamais **de
combien** ils dépassent. Or c'est ça qui dit si 20 Mio est le bon plafond : un fichier de 21 Mo dit
« relève la limite », un de 500 Mo dit « c'est un abus ».

**La réserve, à écrire dans le code et dans la doc :** Multer interrompt la lecture au plafond, donc
la taille réelle est inconnue à ce moment. La seule valeur disponible est le `Content-Length`
déclaré par le client. Elle n'est **pas fiable pour la sécurité** — elle ne sert qu'à dimensionner.

- [ ] **Étape 7 : test d'abord**, dans `upload-limit.filter.spec.ts` :

```ts
  it('observes the size the client declared when it refuses an oversized file', () => {
    // request carrying Content-Length: 41943040
    expect(metrics.observeRejectedUploadBytes).toHaveBeenCalledWith(41_943_040);
  });

  it('observes nothing when the client declared no length', () => {
    expect(metrics.observeRejectedUploadBytes).not.toHaveBeenCalled();
  });
```

- [ ] **Étape 8** : histogramme `portal_rejected_upload_bytes`, tranches **au-dessus** du plafond
  (`20Mi, 32Mi, 64Mi, 128Mi, 512Mi, 1Gi`) — en dessous elles seraient vides par construction.
  Commentaire inline, **3 lignes maximum**, disant que la valeur est déclarée par le client et ne
  sert qu'au dimensionnement.
- [ ] **Étape 9** : ajouter deux panneaux au tableau de bord — *Demandes abouties (24 h)* et
  *Taille déclarée des fichiers refusés (p50 / p95)*. Pas de nouvelle alerte : ni l'un ni l'autre
  n'appelle une intervention.
- [ ] **Étape 10 : vérifier pour de vrai**, pas seulement en test unitaire :

```bash
./install.sh --from-source
# déposer un fichier, puis un fichier de 40 Mo
docker compose -f infra/docker-compose.yml --env-file .env exec backend \
  node -e "fetch('http://127.0.0.1:21610/api/v1/metrics').then(r=>r.text()).then(console.log)" \
  | grep portal_
```

Attendu : `portal_deposits_total{outcome="success"} 1`,
`portal_deposits_total{outcome="rejected_size"} 1`, `portal_rejected_upload_bytes_sum 41943040`,
et **aucune ligne `portail_`**. Puis dans Grafana : les quatre alertes toujours en *Normal*, les
onze panneaux affichant des données.

> **Piège vérifié aujourd'hui :** un compteur porteur d'étiquettes n'émet **aucune série** tant
> qu'il n'a jamais été incrémenté — sur une pile fraîche, `portal_deposits_total` n'affiche que son
> en-tête. C'est pourquoi l'alerte de taux d'échec est en `noDataState: OK` : sans ça, le portail
> alerterait dès son installation.

- [ ] **Étape 11 : commit** (deux commits séparés : le renommage, puis les deux métriques)

---

## Task 5 : ne garder que les tests essentiels — backend

**Cible : 459 cas backend → ~200.** Le critère de conservation, appliqué dans cet ordre :

1. **Est-ce que ce test peut échouer à cause d'un changement plausible de *notre* code ?** Sinon,
   supprimer. Cela élimine les tests de bibliothèque (argon2 sale, `crypto.randomBytes` produit du
   base64url, `Intl` formate une date) et les assertions de constante.
2. **La même règle est-elle déjà affirmée à une autre couche ?** Alors n'en garder **qu'une**, celle
   qui traverse le plus de code réel — l'e2e pour une règle de bout en bout, l'intégration pour une
   permission de stockage, l'unitaire pour une règle pure sans dépendance.
3. **Un `it.each` de sept lignes teste-t-il sept choses ?** Sinon, garder deux lignes : un cas
   nominal, un cas limite.
4. **La sécurité ne s'élague pas.** Réponses indistinguables, hachage jamais en clair, frontière
   entre les deux types de session, 404 plutôt que 403, traversée de chemin, injection d'en-tête,
   octets magiques : tout reste, y compris en double si les deux couches testent des choses
   différentes.

**Suppressions décidées** (fichiers entiers) :

| Fichier | Cas | Pourquoi |
|---|---|---|
| `src/requests/dto/regenerate-link.dto.spec.ts` | 10 | Copie du bloc `expiresInDays` de `create-request.dto.spec.ts`, elle-même rejouée en e2e. Les deux bornes viennent d'un décorateur partagé. |
| `src/metrics/metrics.service.spec.ts` | 7 → **1** | Six cas testent prom-client. Garder **uniquement** « registers nothing in the global registry ». |
| `src/auth/auth-cookie.spec.ts` | 6 → **0** | Deux paires identiques, et `auth.e2e-spec.ts` affirme les mêmes attributs sur le fil. |
| `src/requests/public-url.spec.ts` | 4 → **2** | Les cas 1 et 2 sont la même assertion avec un autre nom d'hôte. Garder la barre finale et le pourcent-encodage. |

**Élagages ciblés** (fichiers conservés, cas retirés) :

- `src/config/env.validation.spec.ts` (**82 → ~25**) — le plus gros gisement. Retirer : les ~17
  lignes qui rejouent `durationToMilliseconds` (couvert par `duration.spec.ts`), les trois
  « survives an explicitly supplied DATABASE_URL » identiques (en garder **un**), et les 18
  « variable manquante » qui exercent la même boucle — garder « names every missing variable at
  once » et **un** représentant. **Garder impérativement** « never copies a secret into the error
  message ».
- `src/config/database-url.spec.ts` (10 → 4) — garder deux caractères réservés sur sept.
- `src/crypto/secrets.spec.ts` (19 → ~8) — retirer ce qui teste `crypto` et `argon2` eux-mêmes.
  Garder les six cas de `buildStorageKey` (traversée de chemin) et « tells '0042' from '42' ».
- `src/storage/storage.service.spec.ts` (20 → ~10) — retirer les huit cas que
  `storage.int-spec.ts` couvre contre un vrai MinIO sous la vraie policy. Garder ce que le mock seul
  atteint : « fails when the server reports a per-key failure », « counts what the server confirms,
  not what was requested », « refuses an empty prefix », la pagination.
- `src/public/public.service.spec.ts` (14 → ~7) — le bloc « the counters » rejoue les trois mêmes
  résolutions. Garder deux compteurs représentatifs et **tout** le bloc unlock.
- `src/public/dto/unlock.dto.spec.ts` (10 → 4) — six lignes pour un `@Matches(/^\d{4}$/)`. Garder
  « accepts four digits, leading zeros included », un refus de format, « rejects a numeric pin »
  (perte du zéro de tête — le seul cas non évident), « phrases every refusal in French ».
- `src/requests/requests.service.spec.ts` (8 → 3) — sept sur huit sont rejoués en e2e. Garder
  « stores the SHA-256 of the token, and never the token », « stores the PIN as an argon2id hash »,
  « draws a different token and PIN every time ».
- `src/requests/request.types.spec.ts` (9 → 6) — retirer « exposes those fields and no others »
  (assertion de forme, casse sur tout ajout inoffensif ;
  `dashboard.e2e-spec.ts` « never lets a hash, a token or a PIN reach the response » est la version
  qui a un scénario d'échec) et les deux cas de statut rejoués en e2e.
- `src/requests/request-status.spec.ts` (9 → 6 après Task 3) — supprimer
  « never reports complete when nothing is expected » : le DTO impose 1 à 20 pièces, l'état est
  inatteignable par l'API. Le garde-fou `expectedCount > 0` reste dans le code.
- `src/auth/auth.service.spec.ts` (11 → 8) — retirer les deux « derives the … cookie lifetime »
  (c'est `duration.spec.ts`) et le test de chronométrage « spends comparable time », qui est
  instable. **Garder** « rejects an unknown address with the same message » : c'est l'énumérateur
  de comptes, et il se teste sur le message, pas sur le temps.
- `src/auth/jwt-auth.guard.spec.ts` (10 → 5) — les trois lignes de charge utile deviennent une, et
  les trois cas rejoués mot pour mot dans `auth.e2e-spec.ts` partent.
- `test/auth.e2e-spec.ts` (30 → ~18) — retirer « leaves the health probe open » (c'est
  `health.e2e-spec.ts`), les cinq cas de `GET /auth/me` (c'est le garde), les deux cas de cookie
  `Secure`. **Garder toute la rotation des jetons de rafraîchissement** : réutilisation détectée,
  course concurrente, plafond de 7 jours, inactivité de 3 jours.
- `test/dashboard.e2e-spec.ts` (18 → ~12) — retirer les quatre cas de statut (unitaires) et les
  deux cas de DTO de pagination.
- `test/requests.e2e-spec.ts` (23 → ~14) — retirer les sept lignes de validation rejouées par les
  DTO. **Garder** « forbids a second active link, by index » et « erases the pieces and the links
  when the request goes » : seule une vraie base peut les faire échouer.
- `test/health.e2e-spec.ts` (6 → 5) — « reports both failures at once » n'ajoute pas de branche.

**Conservés intégralement, sans discussion :** `src/public/deposits.service.spec.ts` (19),
`src/public/file-type.spec.ts` (8), `src/public/client-session.guard.spec.ts` (8),
`src/public/upload-limit.filter.spec.ts` (3), `src/requests/public-links.service.spec.ts` (20),
`src/metrics/http-metrics.interceptor.spec.ts` (4), `test/deposit.e2e-spec.ts` (13),
`test/download.e2e-spec.ts` (8), `test/public.e2e-spec.ts` (10), `test/storage.int-spec.ts` (10).

- [ ] **Étape 1** : appliquer les suppressions de fichiers entiers, lancer `pnpm -C backend test`,
  commit.
- [ ] **Étape 2** : appliquer les élagages ciblés, un fichier à la fois.
- [ ] **Étape 3 : le contrôle qui donne son sens à la passe.** Après élagage, prendre **trois**
  invariants de sécurité — hachage du jeton, 401 uniforme sur lien inconnu/révoqué/expiré/mauvais
  PIN, refus d'un exécutable renommé `.pdf` — et pour chacun **casser volontairement le code**,
  constater qu'au moins un test tombe, restaurer. Un invariant qui ne fait plus tomber personne a
  perdu son gardien pendant l'élagage.
- [ ] **Étape 4** : `pnpm -C backend test && pnpm -C backend test:e2e && pnpm -C backend
  test:integration && pnpm -C backend lint` → tout vert.
- [ ] **Étape 5 : commit** (un commit par groupe de fichiers, message nommant ce qui saute et
  pourquoi).

---

## Task 6 : ne garder que les tests essentiels — frontend

**Cible : 171 cas → ~80.** Même critère.

**Suppressions de fichiers entiers (48 cas) :**

| Fichier | Cas | Pourquoi |
|---|---|---|
| `src/test/setup.test.tsx` | 1 | Rend `<p>bonjour</p>` et vérifie qu'il est là. Teste le harnais de test. |
| `src/theme/theme.test.ts` | 15 | Douze cas affirment qu'une constante vaut la constante qu'elle vaut. |
| `src/theme/recipes/button.test.tsx` | 6 | Égalité d'objets de style, plus un « rend sans planter ». |
| `src/theme/recipes/card.test.tsx` | 7 | Idem, dont trois lignes qui relisent trois fois le même objet. |
| `src/theme/recipes/pin-digit.test.tsx` | 2 | Deux `toMatchObject` sur un objet de style. |
| `src/components/status-badge.test.tsx` | 3 | Rejoué par `dashboard-page` et `request-detail-page`. |

**Élagages ciblés :**

- `src/theme/recipes/badge.test.tsx` (5 → **1**) — garder **uniquement** « keeps the charter box on
  the variant a screen actually renders » : c'est le seul qui documente un vrai bug Chakra (une
  variante `size` divisait la marge par deux en silence).
- `src/theme/recipes/field.test.tsx` (4 → **1**) — garder « links the label to the input and marks
  it invalid by state » : accessibilité, vraie panne. Les trois autres sont des jetons relus.
- `src/format.test.ts` (15 → ~9) — retirer les trois lignes de `pluralize` (un ternaire) et
  « renders a French long date » (c'est `Intl`, et c'est fragile selon l'ICU de la machine).
  **Garder** l'inversion droite-à-gauche et la troncature par point de code.
- `src/components/item-row.test.tsx` (7 → ~4) — retirer la troisième affirmation de `safeFileName`
  et « renders the action beside the state badge » (présence de mise en page).
- `src/components/reveal.test.tsx` (4 → **2**) — garder « shows its children when the observer never
  fires » (le mode de défaillance réel : du contenu invisible pour toujours) et « hides what the
  observer reports off-screen, then reveals it ».
- `src/components/screen-state.test.tsx` (7 → ~4) — retirer « does not pulse » et « gives its ghosts
  the height of the real content » (CSS).
- `src/components/issued-link-card.test.tsx` (4 → ~2) — les deux cas de présence de texte sont
  rejoués par `new-request-page.test.tsx`.
- `src/components/copy-field.test.tsx` (4 → 3) — retirer « shows the value in a read-only field »
  (une prop relue).
- `src/components/app-shell.test.tsx` (3 → 1) — garder « signs out and lands on the login screen ».
- `src/api/client.test.ts` (16 → ~13) — les trois lignes de citation 400/413/415 deviennent une.
- `src/pages/request-detail-page.test.tsx` (12 → ~10) — retirer « renders a file name carrying
  markup as text » (c'est l'échappement de React) et la troisième assertion de `safeFileName`.
- `src/pages/new-request-page.test.tsx` (10 → ~8) — retirer « starts with one empty piece row »
  (forme au premier rendu) et le doublon de copie.

**Conservés intégralement :** `src/pages/deposit-page.test.tsx` (13),
`src/pages/login-page.test.tsx` (5), `src/pages/dashboard-page.test.tsx` (9),
`src/hooks/use-resource.test.ts` (5), `src/auth/session-provider.test.tsx` (5),
`src/components/pin-entry.test.tsx` (5), `src/api/upload.test.ts` (4).

- [ ] **Étape 1** : supprimer les six fichiers, `pnpm -C frontend test`, commit.
- [ ] **Étape 2** : appliquer les élagages ciblés.
- [ ] **Étape 3 : ce que la suppression du dossier `theme/` fait perdre, et comment le compenser.**
  Ces 35 cas ne protégeaient rien (jsdom ne calcule aucun style), mais ils *donnaient l'impression*
  de couvrir la charte. Leur suppression rend visible que **la charte n'est vérifiée qu'au
  navigateur** — c'est E2 et la passe navigateur. Ajouter une ligne à ce sujet dans
  `docs/tests-manuels.md § B3`.
- [ ] **Étape 4** : `pnpm -C frontend test && pnpm -C frontend lint` → vert.
- [ ] **Étape 5 : commit.**

---

## Task 7 : sortir la prose d'architecture du code

**Mesuré avant :** 4 722 lignes de commentaires, **une ligne sur quatre**. `infra/` est à **49 %**,
`.env.example` à 87 %, `infra/nginx/server-hardening.conf` à **96 %**.

**Le fait qui décide de la méthode :** les 63 commentaires d'une ligne du backend et du frontend ont
été lus un par un — **aucun n'est une paraphrase**. Il n'y a donc pas de bruit à supprimer : il y a
un document de conception écrit à l'intérieur du code. **C'est un déménagement, pas une purge.**

**Structure cible :**

```
README.md               ~200 l.  produit, installation, architecture en une page,
                                 modèle de données, stratégie de test, observabilité, limites
docs/architecture.md             choix backend / frontend / données, options écartées
docs/observabilite.md            métriques et pourquoi, alertes et leurs seuils, runbook
docs/exploitation.md             install.sh, compose, TLS, registre d'images, pièges de déploiement
docs/tests-manuels.md            (Task 2)
```

`infra/README.md` existant est **absorbé** par `docs/exploitation.md`, puis supprimé : deux
documents d'exploitation à deux endroits divergent.

**Ordre d'attaque — cinq fichiers portent 998 lignes, soit 21 % du total :**

- [ ] **Étape 1 : `infra/nginx/*.conf` (281 lignes de commentaires).** Déménager vers
  `docs/exploitation.md § reverse proxy`. **Rester inline, en 1-3 lignes chacun**, parce que ce sont
  des contraintes externes qu'on redécouvre à ses dépens :
  - `access_log` **s'accumule** au même niveau et ne **remplace** qu'au niveau `server` ;
  - un `add_header` ajouté dans un `location` **annule tous les en-têtes hérités** ;
  - `proxy_pass` avec barre finale enlève le préfixe.
- [ ] **Étape 2 : `infra/docker-compose.yml` (244).** Déménager vers
  `docs/exploitation.md § compose`. Garder inline **six lignes** : pourquoi les deux drapeaux
  `--env-file .env` et `name:` sont indispensables.
- [ ] **Étape 3 : `.env.example` (193 sur 244).** Une ligne par variable : ce qu'elle fait, pas son
  histoire. Le comparatif et les bugs passés vont dans `docs/exploitation.md`.
- [ ] **Étape 4 : `install.sh` (355).** Déménager la cascade Docker, les mesures et l'historique
  vers `docs/exploitation.md § install.sh`. Garder inline ce dont l'oubli **casse en silence** :
  `chmod 600` après les substitutions, l'ordre port/`.env`, `if` et non `&&` dans
  `set_env_default`.
- [ ] **Étape 5 : `infra/grafana/.../portail-alerts.yml` (117).** Les seuils et leur justification
  vont dans `docs/observabilite.md § alertes`, qui devient le runbook. Garder inline la contrainte
  Grafana : **l'intervalle doit être un multiple de 10 s, sinon tout le provisionnement échoue.**
- [ ] **Étape 6 : backend (~800 relogeables sur 2 517).** Les en-têtes JSDoc de plus de dix lignes
  sur les services, `src/crypto/secrets.ts` (103 sur 156), `backend/prisma/schema.prisma` (101),
  `src/config/env.validation.ts` (105), les préambules de stratégie de test des `*.e2e-spec.ts`.
  Restent inline : `BIND_ADDRESS` (l'écoute par défaut sur `0.0.0.0`), les contraintes Prisma du
  `backend/Dockerfile`, la note `satisfies` de `secrets.ts`.
- [ ] **Étape 7 : frontend.** Peu à faire — seuls `src/api/client.ts` (37 %),
  `src/pages/deposit-page.tsx` et deux hooks portent de longs blocs. Les pages sont déjà à 6-17 %.
- [ ] **Étape 8 : réécrire `README.md` à ~200 lignes.** Sections imposées, dans cet ordre : ce que
  fait le produit ; installation en une commande ; architecture en une page (dont **pourquoi pas
  Next.js**) ; modèle de données ; **stratégie de test** — y reprendre le texte déjà rédigé sur les
  trois sujets exigés par l'énoncé (expiration, PIN, transitions de statut) avec les fichiers
  nommés, et **dire ce qui n'est vérifié qu'au navigateur** ; observabilité, avec la justification
  de chaque métrique ; **limites connues**. Chaque section se termine par un lien vers son `docs/`.
- [ ] **Étape 9 : les limites connues, en un seul endroit et sans euphémisme** — pas de limitation
  de débit sur le PIN (détectée, pas empêchée) ; pas d'antivirus ; `style-src 'unsafe-inline'`
  imposé par Chakra v3 ; alertes visibles et non poussées, faute de SMTP ; l'alerte de dépendance
  ne distingue pas Postgres de MinIO ; `linux/amd64` uniquement ; la production épingle un **tag**,
  qui est mutable ; l'URL pré-signée est la voie de montée en charge et pourquoi elle a été écartée.
- [ ] **Étape 10 : vérifier que rien n'a été perdu en route.**

```bash
git diff --stat HEAD~N                       # volume déplacé
grep -rn "CLAUDE.md\|§ " docs/ README.md     # les renvois pointent quelque part
pnpm -C backend lint && pnpm -C frontend lint
./install.sh --from-source                   # la conf commentée autrement démarre encore
pnpm test:bare-machine                       # exit 0, / → 200, /api/v1/health → 403,
                                             # /api/v1/metrics → 403, jeton absent des journaux
```

**Le risque réel de cette passe est le copier-coller d'une configuration** — une accolade nginx
avalée avec son commentaire, une clé compose déplacée. `install.sh --from-source` puis
`test:bare-machine` sont ce qui l'attrape ; un `docker compose config` ne suffit pas, il ne dit rien
d'un `nginx.conf` mal monté (nginx sert alors sa page d'accueil et tout paraît sain).

- [ ] **Étape 11 : commit**, un par fichier d'infrastructure, pour qu'une régression se bissecte.

---

## Task 8 : mettre `CLAUDE.md` en accord, et clore

`CLAUDE.md` décrit aujourd'hui un projet où `API_PREFIX` est figé à quatre endroits — il l'est à
**six** depuis F1 (`infra/nginx/portal-locations.conf` pour `= /api/v1/metrics`, et
`infra/prometheus/prometheus.yml` pour `metrics_path`). Il décrit aussi une base de code dont il
vient de perdre la moitié des commentaires.

- [ ] **Étape 1** : corriger le décompte `API_PREFIX` (six emplacements, nommés).
- [ ] **Étape 2** : y inscrire la règle de commentaire et la nouvelle carte de la documentation
  (`README.md` + `docs/`), pour qu'une session suivante ne réécrive pas des blocs dans le code.
- [ ] **Étape 3** : y inscrire le critère de conservation des tests, pour la même raison.
- [ ] **Étape 4 : revue de code du diff complet** — `git diff main...HEAD` — findings classés par
  gravité, avec pour chacun le scénario d'échec concret. Chercher spécifiquement : un test supprimé
  qui était le seul gardien d'un invariant, une ligne de configuration partie avec son commentaire.
- [ ] **Étape 5 : mettre `issue_backlog.md` à jour**, et **décocher ce qui ne tient plus**.
- [ ] **Étape 6 : commit.**

---

## Vérification d'ensemble

| Quoi | Commande | Attendu |
|---|---|---|
| Unitaires backend | `pnpm -C backend test` | vert, ~200 cas |
| e2e backend | `pnpm -C backend test:e2e` | vert (Docker requis) |
| Intégration | `pnpm -C backend test:integration` | vert, 10 cas, vrai MinIO |
| Frontend | `pnpm -C frontend test` | vert, ~80 cas |
| Lints | `pnpm lint` | vert des deux côtés, zéro avertissement |
| Pile complète | `./install.sh --from-source` | exit 0, portail répondant |
| Machine nue | `pnpm test:bare-machine` | exit 0, `/`→200, health→403, metrics→403, jeton absent |
| Métriques | `curl` interne sur `/api/v1/metrics` | préfixe `portal_` seul, 7 métriques |
| Grafana | à la main | 11 panneaux avec données, 4 alertes en *Normal* |
| Parcours | `docs/tests-manuels.md` | dérouler A1→B5, cocher |

**Ce que cette vérification ne couvre pas, et qu'il faut dire :** la charte au navigateur. Les 35
cas de `theme/` supprimés ne la couvraient pas non plus — ils en donnaient l'illusion. E2 et la
passe navigateur restent ouvertes, et `docs/tests-manuels.md § B3` est la seule chose qui les
décrit.
