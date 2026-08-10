# Sprint final — plan d'exécution parallèle (budget 7 h)

> **Pour les agents :** SOUS-SKILL REQUISE — `superpowers:subagent-driven-development` (recommandée)
> ou `superpowers:executing-plans` pour dérouler ce plan tâche par tâche. Les étapes sont en cases à
> cocher (`- [ ]`).

**Objectif :** livrer tout le P0 et tout le P1 restants du portail de dépôt — parcours client
complet (déverrouillage, dépôt, progression), écrans avocat, téléchargement des pièces,
observabilité Prometheus/Grafana, README — en trois pistes parallèles isolées par `git worktree`.

**Architecture :** trois pistes qui ne partagent aucun fichier applicatif. La piste A tient le chemin
critique backend (`/public/*`), la piste B tout le `frontend/`, la piste C `infra/` plus un module
backend neuf. Les contrats entre pistes sont **gelés dans ce document** (§ Interfaces gelées) pour
que personne n'attende la livraison d'une autre pour commencer.

**Stack :** NestJS 11 + Prisma 7 + Postgres 17 + MinIO (S3) côté serveur, Vite 8 + React 19 +
Chakra v3 côté client, Jest côté backend, Vitest côté frontend, Docker Compose + nginx pour l'infra.

---

## Changements depuis la première version

Section autonome : elle énonce le contenu de chaque modification, sans renvoyer à la section qui a
changé.

### 1. La session client reçoit son propre secret, `CLIENT_JWT_SECRET`

Le plan signait la session client avec le `JWT_SECRET` de l'avocat et séparait les deux populations
par un contrôle applicatif. La frontière devient **cryptographique** : un jeton client présenté au
garde avocat échoue désormais à la vérification de signature, pas à un `if` qu'un refactor peut
supprimer. **RFC 8725 (BCP 225) § 3.8** admet clés distinctes, `typ` distinct ou `aud` distinct ; les
clés distinctes sont la forme la plus forte.

Trois conséquences concrètes : un **`JwtService` dédié** instancié dans `PublicModule` (et non le
`JwtService` global d'`AuthModule`, sans quoi les secrets ne seraient distincts que sur le papier) ;
`CLIENT_JWT_SECRET` rejoint la **règle des trois fichiers** plus `env.validation.ts`, le diff étant
**rédigé par la piste A et appliqué par la piste C** qui possède `infra/` ; et le `typ: 'client'` est
**conservé** — gratuit, lisible — mais il ne porte plus la sécurité. Bénéfice d'exploitation : faire
tourner le secret client invalide toutes les sessions de dépôt sans déconnecter les avocats.

### 2. Le comparatif du téléchargement (B4b) est refait sur des coûts réels

La version précédente écartait l'URL pré-signée comme « techniquement impossible ». **C'était faux.**
Publier un port sur l'hôte ne rendrait effectivement rien joignable depuis internet — la machine ne
route que `:80 → 21600` et `:443 → 21601` — mais une `location` nginx vers `minio:9000` marcherait.
Sa contrainte exacte est que **SigV4 signe le `Host` ET le chemin**, et que l'API S3 de MinIO ne se
monte pas sous un préfixe : il faudrait exposer le bucket à la racine de l'origine. 45 min contre 30.

Le flux reste retenu, sur quatre arguments d'arbitrage désormais écrits : le pré-signé remet un
porteur dans une URL, donc une entrée de plus dans le seul mécanisme dont l'échec est **muet** ; il
ajoute un chemin de signature qu'aucune suite ne traverse, qui marche en développement et casse
derrière nginx ; son bénéfice est un débit dont personne n'a mesuré le coût ; et G3 est P2 et porte
sur l'upload. Le mécanisme est **documenté au README** comme voie de montée en charge, sans être
construit.

### 3. L'argument contre le pré-signé en UPLOAD change de nature

Il ne repose plus sur une impossibilité mais sur la fonction : la vérification par *magic bytes* est
un critère dur de C2, et sans les octets le contrôle devient post-upload — retélécharger, vérifier,
supprimer — ce qui annule le bénéfice recherché.

### 4. Défaut relevé dans le plan B5, à corriger en chemin

`ai-plans/2026-08-10-b5-ecrans-avocat.md` contient **deux octets NUL écrits en clair** dans
l'échantillon de test `safeFileName` (tâche 2), ce qui suffit à faire classer le fichier en binaire
par `file` et à rendre `grep` muet dessus. Recopié tel quel, ce test mettrait de vrais octets NUL
dans une source TypeScript, où l'intention devient invisible. À écrire `'bail\x00\x1fsigne.pdf'`.

### Ce qui n'a pas bougé

Le périmètre (P0 + P1, les dix issues P2 restent coupées) ; la structure en trois pistes et leur
contenu ; la chronologie ; le protocole de ports et de conflit ; toutes les autres interfaces gelées ;
le choix Multer `memoryStorage` ; les signatures écrites à la main plutôt que `file-type` ; le
tranchage de `received` face à `failed` ; `prom-client` direct ; la section sécurité et les tâches de
clôture.

---

## Verdict de périmètre — à lire avant de lancer quoi que ce soit

**7 h ne suffisent pas pour les 22 issues restantes.** Le décompte honnête, à la maille où les
features B2/B3/B4 ont été livrées dans ce dépôt :

| Périmètre | Travail agent | Tenable en 7 h à 3 pistes ? |
|---|---|---|
| P0 + P1 restants (12 issues) | ≈ 14 h | **Oui, à 6 h 30 de temps mural** — c'est ce plan |
| + les 10 issues P2 | ≈ 22 h | Non |

**Ce qui entre :** D6, C1, C2, C3, B4b, B5, F1, F2, A8 (critère restant), G4, H1, H2, H3, H4.

**Ce qui est coupé, et pourquoi c'est le bon arbitrage :** l'énoncé classe explicitement ces
issues en *bonus*. Les couper ne retire aucun point éliminatoire ni aucun critère de
différenciation.

- **B1b** (gestion des sessions) — confort ; le mécanisme de sécurité est livré par B1c.
- **C4** (antivirus ClamAV) — bonus énoncé ; le contrôle de type réel remonte dans C2, donc la
  partie qui *rend l'allowlist effective* est bien livrée.
- **G1** (rate limiting PIN), **G2** (audit), **G3** (URLs pré-signées) — bonus énoncé. G1 est le
  seul regret : il sera **nommé comme limite connue** dans le README (§ Sécurité) plutôt que passé
  sous silence.
- **D1** (les trois cases restantes), **D3** (CI), **D4** (messages homogènes), **D5** (tests de
  rendu), **E2** (densité mobile) — qualité et outillage.

Si le budget déborde, **couper dans cet ordre** : F2 avant F1 (un `/metrics` sans dashboard vaut
mieux qu'un dashboard sans métriques), puis B4b, puis les écrans annexes de B5.

---

## Contraintes globales

Elles s'appliquent à **chaque tâche** de ce plan, sans être répétées.

- **Node 22, pnpm 11.20.0.** Jamais `npm install`.
- **Tout le code en anglais** — identifiants, commentaires, tests, noms de fichiers. Seuls l'UI et
  les messages de validation `class-validator` sont en français.
- **Arrow functions**, jamais `function name()`.
- **Aucune variable d'environnement lue par `process.env`** : `ConfigService.getOrThrow`, sans
  valeur de repli.
- **Ajouter une variable requise = toucher trois fichiers ensemble** : `.env.example`, `install.sh`,
  `infra/docker-compose.yml`. `set_env_value` sort en 3 si la clé manque à `.env.example`.
- **Les deux lints sont bloquants** (`--max-warnings 0` et `--deny-warnings`). Un avertissement est
  du travail, pas un motif d'élargir un ignore.
- **TDD** : test qui échoue, on le lance pour le voir échouer, implémentation minimale, test qui
  passe, commit. Un commit par étape verte.
- **Aucun secret en clair en base ni dans un journal.** Le PIN est argon2id, le jeton SHA-256.
- **Le statut d'une demande est dérivé**, jamais stocké. Ne pas « optimiser » en colonne.
- **Un `ai-plans/2026-08-10-<issue>.md` par issue livrée** (H4), et les cases cochées dans
  `issue_backlog.md`.
- **Revue de code du diff complet avant chaque merge**, findings classés par gravité avec le
  scénario d'échec concret.

---

## Interfaces gelées

C'est la partie qui rend le parallélisme possible : chaque piste code **contre ces signatures**,
sans attendre que la piste voisine ait livré. Les changer en cours de route casse une autre piste.

### Routes publiques (piste A produit, piste B consomme)

```
POST   /api/v1/public/:token/unlock       body { pin: string }   -> 200 { requestId, title, expiresAt, items: PublicItemView[] }
GET    /api/v1/public/session             (cookie)               -> 200 { requestId, title, expiresAt, items: PublicItemView[] }
POST   /api/v1/public/files               multipart              -> 201 { itemId, originalName, mimeType, sizeBytes, receivedAt }
GET    /api/v1/requests/:id/items/:itemId/file   (avocat)        -> 200 flux binaire
```

```ts
// backend/src/public/public.types.ts — la vue que le client anonyme reçoit
export interface PublicItemView {
  id: string;
  label: string;
  received: boolean;
}

export interface PublicRequestView {
  requestId: string;
  title: string;
  expiresAt: Date;
  items: PublicItemView[];
}

export interface DepositedFileView {
  itemId: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  receivedAt: Date;
}
```

**Ce que la vue publique ne porte JAMAIS :** le nom de l'avocat, la liste des autres demandes, le
`linkId`, une quelconque date de création de la demande. Le client voit son dossier, rien d'autre.

### Session client (piste A)

```ts
// backend/src/public/client-session.ts
export const CLIENT_COOKIE_NAME = 'portail_client';
export const CLIENT_SESSION_TTL_MS = 30 * 60 * 1000; // 30 min

/** Le `typ` est ce qui empêche un jeton avocat de passer pour une session client. */
export interface ClientSessionPayload {
  typ: 'client';
  linkId: string;
  requestId: string;
}
```

**`linkId` et pas seulement `requestId`** — contrainte posée par B3 : sans lui, un client déjà
déverrouillé garde son accès après une révocation, et `DELETE /requests/:id/link` ne coupe plus
rien.

### Codes de réponse

| Situation | Réponse | Pourquoi |
|---|---|---|
| Token inconnu / révoqué / expiré / PIN faux | **401** `{ message: "Lien ou code invalide." }` | Une seule et même réponse : sinon la route devient l'oracle que C1 interdit |
| Session client absente ou expirée | 401 | |
| Fichier trop gros | 413 `{ message: "Fichier trop volumineux (20 Mo maximum)." }` | |
| Type refusé | 415 `{ message: "Format refusé. PDF, JPG ou PNG uniquement." }` | |
| `itemId` hors de la demande de la session | **404** | Un 403 confirmerait l'existence de la pièce chez un autre |

### Métriques (piste C)

```
portail_deposits_total{outcome="success"|"rejected_type"|"rejected_size"|"error"}
portail_unlock_attempts_total{outcome="success"|"failure"}
portail_expired_link_hits_total
portail_upload_bytes            (histogram)
portail_http_request_duration_seconds{method,route,status}   (histogram)
```

Les compteurs sont incrémentés par la piste A **via une interface que la piste C fournit** :

```ts
// backend/src/metrics/metrics.service.ts — piste C écrit, piste A appelle
recordDeposit(outcome: 'success' | 'rejected_type' | 'rejected_size' | 'error'): void
recordUnlock(outcome: 'success' | 'failure'): void
recordExpiredLinkHit(): void
observeUploadBytes(bytes: number): void
```

**Ordre d'intégration :** la piste A **n'appelle rien** tant que F1 n'est pas fusionnée. Le
branchement est une tâche dédiée (Tâche C4), faite après le merge de C2 — cinq lignes, un fichier.
C'est ce qui évite que les deux pistes se disputent `public.controller.ts`.

---

## Mise en place des worktrees

Un worktree, c'est un **second répertoire de travail sur le même dépôt** : historique, objets et
branches partagés, seuls les fichiers sont dupliqués. Deux worktrees ne peuvent pas avoir la même
branche sortie — c'est le garde-fou.

```bash
cd /home/sephorahaniambossou/delivery/div-protocol-internship

git worktree add ../wt-b5 -b feat/b5-ecrans-avocat
git worktree add ../wt-f1 -b feat/f1-observabilite
# la piste A reste dans le dépôt principal, sur main puis sur ses branches

git worktree list        # qui occupe quoi
```

**Deux choses ne sont pas versionnées et ne suivent donc pas :**

```bash
# 1. le .env (gitignoré) — sans lui l'API refuse de démarrer
cp exo2-portail-depot/.env ../wt-b5/exo2-portail-depot/.env
cp exo2-portail-depot/.env ../wt-f1/exo2-portail-depot/.env
chmod 600 ../wt-b5/exo2-portail-depot/.env ../wt-f1/exo2-portail-depot/.env

# 2. les node_modules — le store pnpm est partagé, ce sont des liens durs
pnpm -C ../wt-b5/exo2-portail-depot/frontend install
pnpm -C ../wt-f1/exo2-portail-depot/backend install
```

Nettoyage en fin de sprint, après fusion :

```bash
git worktree remove ../wt-b5 && git branch -d feat/b5-ecrans-avocat
git worktree remove ../wt-f1 && git branch -d feat/f1-observabilite
```

### Protocole de ports — la seule vraie contention

`pnpm db:up` porte un **nom de projet compose fixe** (`exo2-portail-depot-dev`) et publie
21632/21690/21691. Deux worktrees qui le lancent se recréent la base l'un sous l'autre : c'est
exactement le bug que A5 a corrigé, et il ne produit aucune erreur visible.

| Ressource | Qui la détient | Règle |
|---|---|---|
| Postgres + MinIO (`pnpm db:up`) | **Dépôt principal uniquement** | Les worktrees ne le lancent jamais |
| API `:21610` (`pnpm dev:backend`) | **Piste A uniquement** | Les pistes B et C tapent dessus |
| Vite `:5173` | Piste A | |
| Vite `:5174` | Piste B | `pnpm dev -- --port 5174` |
| Suites de tests | Toutes, en parallèle | testcontainers tire un port éphémère par conteneur : `pnpm test`, `test:e2e` et `test:integration` sont sûrs en simultané |

**La piste C ne démarre pas d'API du tout** jusqu'à sa tâche F2 : ses tests unitaires suffisent, et
sa vérification finale passe par `./install.sh --from-source`, qui monte sa propre pile isolée.

### Protocole de conflit

Quatre fichiers seront touchés par plus d'une piste. Règle : **la piste nommée est propriétaire, les
autres n'y touchent pas et signalent leur besoin.**

| Fichier | Propriétaire | Ce que les autres font |
|---|---|---|
| `backend/src/app.module.ts` | Piste A | Piste C ajoute `MetricsModule` **en dernière ligne** de `imports` — conflit trivial, résolu au merge |
| `infra/docker-compose.yml`, `install.sh`, `.env.example` | **Piste C** | Personne d'autre n'y touche |
| `issue_backlog.md`, `CLAUDE.md` | **Personne pendant le sprint** | Une tâche finale unique (Tâche Z2) les met à jour d'un coup |
| `README.md` | Piste C (H1) | |

Chaque piste rebase sur `main` avant sa revue : `git fetch && git rebase origin/main`.

---

# Piste A — chemin critique client

Dépôt principal. Séquentielle : D6 → C1 → C2 → B4b. **≈ 5 h.**

## Tâche A1 — D6 : `/depot` → `/deposit`

**Pourquoi maintenant :** après C1, la route du SPA existe et le coût monte. Le piège n'est pas la
route, c'est le journal : un préfixe désaligné ne casse rien de visible, mais le jeton de dépôt
réapparaît **en clair** dans `access.log`, sur une machine partagée.

**Fichiers :**
- Modifier : `backend/src/requests/public-url.ts:9` (`DEPOSIT_PATH`)
- Modifier : `infra/nginx/log-redact.conf` (la carte de masquage)
- Test : `backend/src/requests/public-url.spec.ts`, `scripts/test-bare-machine.sh`

**Décision à acter dans le plan de l'issue :** les liens déjà envoyés cesseraient de fonctionner.
**On accepte** — rien n'est en production, aucun client réel n'a reçu de lien. Une redirection nginx
`/depot/` → `/deposit/` obligerait la carte de masquage à couvrir **les deux** préfixes, donc à
doubler la surface du seul mécanisme dont l'échec est invisible. Le noter dans le README.

- [ ] **A1.1 — Écrire le test qui échoue**

```ts
// backend/src/requests/public-url.spec.ts
it('composes the client address on the English deposit path', () => {
  expect(buildDepositUrl('https://portail.example', 'abc')).toBe(
    'https://portail.example/deposit/abc',
  );
});
```

- [ ] **A1.2 — Le lancer, constater l'échec** : `pnpm -C backend test public-url` → attendu `/depot/abc` reçu.
- [ ] **A1.3 — Changer `DEPOSIT_PATH` en `'/deposit'`**, et mettre à jour le commentaire qui renvoie
      à `log-redact.conf`.
- [ ] **A1.4 — Aligner la carte de masquage** dans `infra/nginx/log-redact.conf` : le segment
      reconnu passe de `/depot/` à `/deposit/`. Vérifier que `/api/v1/public/` reste couvert.
- [ ] **A1.5 — Lancer la suite** : `pnpm -C backend test` → vert. Grep de contrôle :
      `grep -rn "/depot" backend/src infra/ scripts/` ne doit plus rien rendre hors historique.
- [ ] **A1.6 — Commit** : `refactor(links): serve the client page on /deposit and realign log redaction`

## Tâche A2 — C1 : déverrouillage par PIN

**Fichiers :**
- Créer : `backend/src/public/public.module.ts`, `public.controller.ts`, `public.service.ts`,
  `public.types.ts`, `client-session.ts`, `client-session.guard.ts`, `dto/unlock.dto.ts`
- Test : `backend/src/public/public.service.spec.ts`, `client-session.guard.spec.ts`,
  `backend/test/public.e2e-spec.ts`
- Modifier : `backend/src/app.module.ts` (importer `PublicModule`)

**Interfaces :**
- Consomme : `PublicLinksService.resolve(token, now): Promise<LinkResolution>` (B3, inchangé),
  `verifySecret` de `src/crypto/secrets.ts`, `JwtService`.
- Produit : les quatre types de § Interfaces gelées, plus `ClientSessionGuard`.

### Comparatif — comment porter la session client

| Option | Pour | Contre | Verdict |
|---|---|---|---|
| **JWT court en cookie httpOnly** | Aucune migration, aucune table, révocation par `linkId` vérifié à chaque requête | Irrévocable en soi — mais 30 min de durée et le contrôle du lien à chaque appel comblent le trou | **Retenu** |
| Ligne `ClientSession` en base | Révocable immédiatement, auditable pour G2 | Une migration, une table, un nettoyage périodique — pour un accès qui vit 30 min | Écarté |
| Rien : renvoyer le PIN à chaque appel | Zéro état | Le PIN circule à chaque requête, donc dans chaque journal intermédiaire | Écarté, dangereux |

**Le point non devinable : le jeton client a SON PROPRE SECRET, `CLIENT_JWT_SECRET`.** Signé avec le
`JWT_SECRET` de l'avocat, un jeton client présenté au garde avocat franchirait la vérification de
signature, et la frontière ne tiendrait plus qu'à un contrôle applicatif — un `if` qu'un refactor
peut supprimer sans qu'aucun test de signature ne le voie. **RFC 8725 (BCP 225) § 3.8** admet clés
distinctes, `typ` distinct ou `aud` distinct ; les clés distinctes sont la forme la plus forte, le
refus arrivant à la cryptographie. Bénéfice d'exploitation : faire tourner le secret client invalide
toutes les sessions de dépôt **sans déconnecter les avocats**.

Trois conséquences :

1. **Un `JwtService` dédié**, instancié dans `PublicModule` par
   `JwtModule.register({ secret: config.getOrThrow('CLIENT_JWT_SECRET') })` — et **non** le
   `JwtService` global d'`AuthModule`, sans quoi les deux secrets ne seraient distincts que sur le
   papier.
2. `CLIENT_JWT_SECRET` rejoint la **règle des trois fichiers** : `.env.example`, un
   `set_env_default CLIENT_JWT_SECRET "$(random_hex 32)"` dans `install.sh` (à côté de la ligne 441),
   et `${CLIENT_JWT_SECRET:?}` dans `infra/docker-compose.yml` — plus la liste `REQUIRED` et le
   contrôle des 32 caractères dans `backend/src/config/env.validation.ts:51`. **Le diff est rédigé
   par la piste A et appliqué par la piste C**, qui possède `infra/`.
3. Le `typ: 'client'` est **conservé** : il est gratuit et rend l'intention lisible. Mais il ne porte
   plus la sécurité, et `JwtAuthGuard` exige toujours `sub`. Deux tests figent les deux sens.

- [ ] **A2.1 — Test : les trois refus sont indistinguables**

```ts
// backend/src/public/public.service.spec.ts
describe('unlock', () => {
  const refusals: LinkResolution[] = [
    { outcome: 'unknown' },
    { outcome: 'revoked' },
    { outcome: 'expired' },
  ];

  // Le scenario d'echec reel : une reponse qui differe d'un cas a l'autre laisse
  // un client anonyme distinguer un lien inexistant d'un lien expire, donc
  // enumerer les liens vivants du cabinet.
  it.each(refusals)('answers the same 401 for %o as for a wrong pin', async (resolution) => {
    links.resolve.mockResolvedValue(resolution);
    const refused = await service.unlock('token', '0000', new Date()).catch((e: unknown) => e);

    links.resolve.mockResolvedValue(okResolution);
    const wrongPin = await service.unlock('token', '9999', new Date()).catch((e: unknown) => e);

    expect(refused).toBeInstanceOf(UnauthorizedException);
    expect((refused as UnauthorizedException).getResponse()).toEqual(
      (wrongPin as UnauthorizedException).getResponse(),
    );
  });
});
```

- [ ] **A2.2 — Le lancer** : `pnpm -C backend test public.service` → échec, `PublicService` n'existe pas.
- [ ] **A2.3 — Écrire `public.types.ts` et `client-session.ts`** (contenu exact au § Interfaces gelées).
- [ ] **A2.4 — Écrire `PublicService.unlock`**

```ts
// backend/src/public/public.service.ts
/** La seule reponse de refus. Une constante, pas trois litteraux : trois
 *  copies pourraient diverger d'un mot, ce qui suffit a faire l'oracle. */
const REFUSED = 'Lien ou code invalide.';

@Injectable()
export class PublicService {
  constructor(
    private readonly links: PublicLinksService,
    private readonly prisma: PrismaService,
  ) {}

  async unlock(token: string, pin: string, now: Date): Promise<UnlockResult> {
    const resolution = await this.links.resolve(token, now);

    // Verifie le PIN contre un hachage factice quand le lien n'est pas ouvrable :
    // sans ca, un token inconnu repond en 1 ms la ou un PIN faux coute 67 ms, et
    // le chronometre redevient l'oracle que la reponse unique vient de fermer.
    // Meme dispositif que AuthService pour un e-mail inconnu.
    const hash = resolution.outcome === 'ok' ? resolution.link.pinHash : this.decoyHash;
    const pinMatches = await verifySecret(hash, pin);

    if (resolution.outcome !== 'ok' || !pinMatches) {
      throw new UnauthorizedException(REFUSED);
    }
    return { linkId: resolution.link.id, request: resolution.request };
  }
}
```

- [ ] **A2.5 — Lancer, vérifier le vert.** Ajouter le test du hachage factice : `resolve` renvoyant
      `unknown` doit tout de même avoir appelé `verifySecret` une fois.
- [ ] **A2.6 — Commit** : `feat(public): refuse an unknown, revoked or expired link exactly like a wrong pin`
- [ ] **A2.7 — Test du garde** : un jeton avocat (payload `{ sub }`) présenté à `ClientSessionGuard`
      répond 401 ; un jeton client (payload `{ typ: 'client', linkId, requestId }`) présenté à
      `JwtAuthGuard` répond 401. Deux tests, deux sens.
- [ ] **A2.8 — Écrire `ClientSessionGuard`** : lit `CLIENT_COOKIE_NAME`, `verifyAsync`, exige
      `payload.typ === 'client'`, **relit le lien** (`prisma.publicLink.findUnique` sur `linkId`) et
      refuse si `revokedAt !== null` ou si `isExpired(expiresAt, now)`. C'est ce qui fait qu'une
      révocation coupe une session déjà ouverte.
- [ ] **A2.9 — Lancer, vérifier le vert. Commit** :
      `feat(public): scope the client session to the link, not to the request`
- [ ] **A2.10 — Contrôleur + DTO.** `@Public()` sur la classe. `UnlockDto` : `@Matches(/^\d{4}$/, { message: 'Le code doit comporter 4 chiffres.' })`.
      La réponse pose le cookie `portail_client` (httpOnly, `sameSite: 'strict'`, `secure` depuis
      `req.secure`, `path: '${API_PREFIX}/public'`, `maxAge: CLIENT_SESSION_TTL_MS`).
- [ ] **A2.11 — Suite e2e** `backend/test/public.e2e-spec.ts` : unlock correct → 200 + cookie ;
      PIN faux → 401 ; token inconnu → **même corps** ; lien révoqué entre-temps → `GET /public/session`
      → 401 ; aucune réponse ne contient `pinHash`, `tokenHash`, `lawyerId` ni le titre d'une autre demande.
- [ ] **A2.12 — `pnpm -C backend test && pnpm -C backend test:e2e && pnpm -C backend lint`. Commit** :
      `feat(public): unlock a deposit link with its pin`

## Tâche A3 — C2 : dépôt de pièces

**Fichiers :**
- Créer : `backend/src/public/file-type.ts`, `upload.constants.ts`, `deposits.service.ts`
- Modifier : `public.controller.ts`, `public.module.ts`
- Test : `backend/src/public/file-type.spec.ts`, `deposits.service.spec.ts`,
  `backend/test/deposit.e2e-spec.ts`

### Comparatif — comment recevoir les octets

| Option | Pour | Contre | Verdict |
|---|---|---|---|
| **Multer `memoryStorage` + `FileInterceptor`** | Intégré à Nest, `limits.fileSize` avorte la requête, les magic bytes sont lisibles immédiatement, **aucune écriture disque** (la promesse d'A3 tient) | 20 Mo de RAM par upload concurrent | **Retenu**, borné par `limits: { files: 1, fileSize: 20 Mio }` |
| Busboy en flux, avec lecture des premiers octets | Empreinte mémoire constante | Il faut bufferiser le début, remonter le flux, gérer l'annulation — beaucoup de code pour un fichier de 20 Mo | Écarté |
| URL pré-signée (G3) | L'API ne voit plus les octets | **C'est précisément le problème** : la vérification par *magic bytes* est un critère dur de C2, et sans les octets le contrôle devient post-upload — retélécharger, vérifier, supprimer — ce qui annule le bénéfice | Écarté |

### Comparatif — vérifier le type réel

| Option | Pour | Contre | Verdict |
|---|---|---|---|
| **Signatures écrites à la main** | 3 formats, ~25 lignes, entièrement testables, zéro dépendance | À étendre si un format s'ajoute | **Retenu** |
| Paquet `file-type` | Couvre 100+ formats | **ESM pur** : le Jest CommonJS du backend demanderait une liste `transformIgnorePatterns` à maintenir — le même piège qui a fait choisir Vitest côté frontend | Écarté |

- [ ] **A3.1 — Test des magic bytes**

```ts
// backend/src/public/file-type.spec.ts
// Le scenario d'echec reel : un .exe renomme en .pdf, envoye avec
// Content-Type: application/pdf. L'allowlist se contourne en mentant sur un
// en-tete, et l'avocat telecharge un binaire en croyant ouvrir un contrat.
it('refuses a payload whose declared type contradicts its bytes', () => {
  const executable = Buffer.from([0x4d, 0x5a, 0x90, 0x00]); // MZ, en-tete PE
  expect(detectFileType(executable)).toBeNull();
});

it.each([
  ['application/pdf', Buffer.from('%PDF-1.7\n')],
  ['image/jpeg', Buffer.from([0xff, 0xd8, 0xff, 0xe0])],
  ['image/png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
])('recognises %s from its signature alone', (expected, bytes) => {
  expect(detectFileType(bytes)).toBe(expected);
});
```

- [ ] **A3.2 — Le lancer, constater l'échec.**
- [ ] **A3.3 — Écrire `file-type.ts`** : un tableau `{ mimeType, signature: number[] }`, comparaison
      octet à octet sur le préfixe. `null` quand rien ne correspond.
- [ ] **A3.4 — Lancer, vérifier le vert. Commit** :
      `feat(public): identify a deposited file by its magic bytes, never by its declared type`
- [ ] **A3.5 — Écrire `upload.constants.ts`**

```ts
/** Figes par l'enonce : ce sont des constantes du produit, pas de la
 *  configuration de deploiement. Une variable d'environnement laisserait
 *  croire qu'un exploitant peut ouvrir l'allowlist. */
export const MAX_FILE_BYTES = 20 * 1024 * 1024;
export const ALLOWED_MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/png'] as const;
```

- [ ] **A3.6 — Test : le re-dépôt remplace, objet MinIO compris**

```ts
// deposits.service.spec.ts
// Le scenario d'echec reel : sans suppression de l'ancien objet, un client qui
// se trompe de fichier laisse le premier dans le bucket pour toujours -- plus
// aucune ligne ne porte sa cle, donc plus aucune requete ne peut le retrouver.
it('deletes the previous object when a piece is deposited twice', async () => {
  await service.deposit(session, itemId, secondFile);
  expect(storage.deleteObject).toHaveBeenCalledWith(previousKey);
});
```

- [ ] **A3.7 — Écrire `DepositsService.deposit`**, dans cet ordre :
      1. l'`itemId` appartient bien à `session.requestId` (`findFirst` sur les deux critères), sinon **404** ;
      2. `detectFileType(buffer)` ; `null` ou hors allowlist → **415** ;
      3. `buildStorageKey(requestId, itemId, originalName)` ;
      4. `storage.putObject` ;
      5. `prisma.uploadedFile.upsert` sur `requestedItemId` (unique), `status: 'complete'`, en
         mémorisant l'ancien `storageKey` ;
      6. l'ancien objet supprimé **après** l'écriture réussie — dans l'autre ordre, un échec de
         `putObject` laisse la pièce sans aucun fichier alors qu'elle en avait un.
- [ ] **A3.8 — Lancer, vérifier le vert. Commit** : `feat(public): store a deposited file and replace the previous one`
- [ ] **A3.9 — Trancher `received` face à `failed`** — question ouverte laissée par B4.

  **Décision : `received` devient « un fichier attaché ET `status = complete` ».** Un fichier
  refusé compté comme reçu ferait afficher **complète** une demande à laquelle il manque une pièce,
  au tableau de bord de l'avocat comme dans la progression du client. Concrètement :
  `countReceived` et `toRequestDetail` dans `request.types.ts` filtrent sur
  `item.file?.status === 'complete'`, et le `select` Prisma de `requests.service.ts` remonte
  `status`. **Test de non-régression** : une demande d'une pièce avec un fichier `failed` reste
  `pending`, pas `complete`.

- [ ] **A3.10 — Contrôleur** : `@Post('files')` sous `ClientSessionGuard`, `FileInterceptor('file', { storage: memoryStorage(), limits: { files: 1, fileSize: MAX_FILE_BYTES } })`.
      Un `MulterError` de code `LIMIT_FILE_SIZE` est traduit en **413** par un filtre d'exception —
      sans lui Nest répond un 500 opaque sur un cas parfaitement normal.
- [ ] **A3.11 — Suite e2e** `deposit.e2e-spec.ts` : PDF valide → 201 puis la pièce est `received` ;
      exécutable renommé `.pdf` → 415 ; 21 Mo → 413 ; `itemId` d'une autre demande → 404 ; sans
      cookie → 401 ; second dépôt → une seule ligne `UploadedFile`.
- [ ] **A3.12 — Vérification manuelle contre le vrai MinIO** : `pnpm db:up && pnpm dev:backend`,
      dépôt d'un PDF réel, puis lecture de l'objet dans la console MinIO (`:21691`). Noter la durée
      mesurée dans le plan de l'issue.
- [ ] **A3.13 — `pnpm -C backend test && test:e2e && test:integration && lint`. Commit** :
      `feat(public): accept a deposit, validated by size and by real type`

## Tâche A4 — B4b : téléchargement par l'avocat

### Comparatif — servir le fichier

| Option | Pour | Contre | Verdict |
|---|---|---|---|
| **Flux à travers l'API** | Passe par le garde avocat existant, aucun secret dans une URL, en-têtes de restitution maîtrisés | Les octets traversent Node | **Retenu** |
| URL pré-signée MinIO | L'API ne voit pas les octets | **Faisable** (voir ci-dessous), mais remet un porteur dans une URL et ajoute un chemin de signature qu'aucune suite ne couvre | Écarté, sur arbitrage et non sur impossibilité |

**Correction d'une version antérieure de ce plan, qui disait le pré-signé « techniquement
impossible ». C'était faux.** Publier un port sur l'hôte ne rendrait effectivement rien joignable
depuis internet — la machine ne route que `:80 → 21600` et `:443 → 21601` — mais une `location`
nginx relayant vers `minio:9000` marcherait très bien. Sa contrainte exacte : **SigV4 signe le `Host`
ET le chemin**, et l'API S3 de MinIO ne se monte pas sous un préfixe ; il faudrait donc exposer le
bucket à la racine de l'origine (`location ~ ^/portail-depot/`, `proxy_set_header Host $http_host`).
Compter 45 min contre 30 pour le flux.

Ce qui tranche est donc ailleurs, par poids décroissant :

1. Le pré-signé met un **second porteur dans une URL**, donc une seconde entrée dans
   `log-redact.conf` — la seule protection du projet dont l'échec est **muet** : nginx sert
   normalement, et le secret part sur le disque d'une machine partagée. C'est la classe de risque que
   tout B3 a fermée.
2. Le flux réutilise `getObjectStream`, **déjà couvert** par `storage.int-spec.ts` contre un vrai
   MinIO sous la policy restreinte. Le pré-signé ajoute un chemin de signature qu'**aucune suite ne
   traverse** : en développement l'endpoint signé et l'endpoint réel sont le même et tout marche ; en
   production nginx s'intercale et la signature tombe sur un `SignatureDoesNotMatch` que rien n'a
   annoncé.
3. Son bénéfice est le débit. Un conteneur backend, quelques avocats, 20 Mo par fichier, et
   `getObjectStream` rend un `Readable` avec contre-pression : aucun coût mesuré à supprimer.
4. G3 est **P2 et porte sur l'upload**. Le faire en descente dans un P0 dépense du budget P0 sur du
   bonus, alors que les 7 h ont déjà forcé à couper dix issues P2.

**À documenter au README (H1) sans le construire** : le pré-signé est la voie de montée en charge,
avec la contrainte SigV4 ci-dessus. Le raisonnement est un livrable ici ; on en garde le crédit sans
en payer la surface. **Ce qui ferait changer d'avis** : un plafond de fichier bien plus haut, ou de
la concurrence réelle.

- [ ] **A4.1 — Test : un fichier `failed` n'est jamais servi** (décision actée en B4b).

```ts
// Le scenario d'echec reel : C4 marquera `failed` un fichier refuse par
// l'antivirus. Servi quand meme, le portail livre a l'avocat exactement le
// fichier qu'il venait de refuser.
it('answers 404 for a file whose status is failed', async () => {
  await expect(service.streamFile(requestId, itemId, lawyerId)).rejects.toThrow(NotFoundException);
});
```

- [ ] **A4.2 — Écrire `GET /requests/:id/items/:itemId/file`** dans `requests.controller.ts` :
      propriété vérifiée via `ownedRequestId`, `status === 'complete'` exigé,
      `storage.getObjectStream(key)` renvoyé en `StreamableFile`.
- [ ] **A4.3 — En-têtes de restitution**

```ts
// Content-Disposition en filename* / RFC 5987 : originalName vient du client,
// donc il peut contenir un guillemet ou un retour a la ligne, de quoi injecter
// un second en-tete. encodeURIComponent ferme les deux.
res.setHeader('Content-Type', file.mimeType);
res.setHeader(
  'Content-Disposition',
  `attachment; filename*=UTF-8''${encodeURIComponent(file.originalName)}`,
);
```

- [ ] **A4.4 — e2e** : 200 avec le bon `Content-Type` ; demande d'un autre avocat → 404 ; anonyme → 401 ;
      un `originalName` contenant `"` et `\n` ne casse pas l'en-tête.
- [ ] **A4.5 — `pnpm -C backend test && test:e2e && lint`. Commit** :
      `feat(requests): let the lawyer download a deposited piece as a stream`

## Tâche A5 — Revue et fusion de la piste A

- [ ] Relire le diff complet (`git diff main...HEAD`), findings classés par gravité, scénario
      d'échec concret pour chacun. **Chercher les chemins non couverts** : que se passe-t-il si le
      lien est révoqué *pendant* un upload ? si deux dépôts de la même pièce arrivent en même temps ?
- [ ] Écrire `ai-plans/2026-08-10-c1-c2-parcours-client.md` et `2026-08-10-b4b-telechargement.md`.
- [ ] `git checkout main && git merge --no-ff feat/...`

---

# Piste B — écrans (worktree `../wt-b5`)

B5 puis C3. **≈ 4 h.** Ne touche que `frontend/`. Peut démarrer **immédiatement** : B1–B4 sont
livrés, et C1/C2 sont consommés via les signatures gelées plus haut.

## Tâche B1 — B5 : liste et détail des demandes

**Fichiers :**
- Créer : `frontend/src/pages/requests-page.tsx`, `request-detail-page.tsx`,
  `frontend/src/requests/api.ts`, `frontend/src/requests/status-badge.tsx`,
  `frontend/src/components/reveal-on-scroll.tsx`
- Modifier : `frontend/src/app.tsx` (routes), suppression de `dashboard-placeholder.tsx`

**Rappel des trois pièges d'E1**, qu'aucun test unitaire ne voit — ils valent ici :
les variantes livrées avec Chakra l'emportent sur le `base` d'une recette ; un `textStyle`
l'emporte sur un `fontSize` voisin ; `Stack` étire ses enfants, donc un bouton y perd son gabarit.
**Écran écrit = écran ouvert au navigateur.**

- [ ] **B1.1 — Test : le statut et l'état du lien sont rendus séparément**

```tsx
// Le scenario d'echec reel : une seule colonne perd un des deux faits. Une
// demande complete dont le lien est revoque s'affiche "complete", l'avocat
// croit que tout va bien et ne regenere pas -- alors que son client ne peut
// plus rien deposer.
it('shows a revoked link beside a complete status, not instead of it', () => {
  render(<RequestRow request={{ ...base, status: 'complete', link: { state: 'revoked' } }} />)
  expect(screen.getByText('Complète')).toBeInTheDocument()
  expect(screen.getByText('Lien révoqué')).toBeInTheDocument()
})
```

- [ ] **B1.2 — Le lancer, constater l'échec.** `pnpm -C frontend test`
- [ ] **B1.3 — Écrire `requests/api.ts`** : `listRequests(page)`, `getRequest(id)`,
      `createRequest(body)`, `regenerateLink(id, expiresInDays)`, `revokeLink(id)`, tous par
      `apiRequest` de `src/api/client.ts`. Aucun `fetch` direct dans une page.
- [ ] **B1.4 — Écrire `status-badge.tsx`** avec la recette `badge` d'E1. `pending` → neutre,
      `complete` → success (`#12AC64` sur `#D9FFED`), `expired` → danger (`#FF4C4C` sur `#FFD0D0`).
      **Aucune couleur écrite dans le composant** : uniquement des tokens.
- [ ] **B1.5 — Écrire `requests-page.tsx`.** Pagination, la plus récente d'abord.
- [ ] **B1.6 — Lancer, vérifier le vert. Commit** : `feat(dashboard): list the lawyer's deposit requests`
- [ ] **B1.7 — Test : `originalName` est échappé.** Point ouvert laissé par B4.

```tsx
// Le nom vient du client. React echappe par defaut, mais le test fige la regle :
// il echouera le jour ou quelqu'un atteint dangerouslySetInnerHTML pour
// "afficher proprement" un nom de fichier.
it('renders a hostile file name as text, never as markup', () => {
  render(<ItemRow item={{ ...base, file: { originalName: '<img src=x onerror=alert(1)>' } }} />)
  expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument()
  expect(document.querySelector('img')).toBeNull()
})
```

- [ ] **B1.8 — Écrire `request-detail-page.tsx`** : pièces dans l'ordre `position`, chaque pièce
      reçue portant nom, type, taille et date, plus un lien de téléchargement pointant sur
      `GET /requests/:id/items/:itemId/file` (piste A, Tâche A4). Le lien peut être écrit avant que
      la route existe : il rendra 404 jusqu'au merge, et c'est visible.
- [ ] **B1.9 — Lancer, vérifier le vert. Commit** : `feat(dashboard): show a request's expected and received pieces`
- [ ] **B1.10 — Formulaire de création** : intitulé, liste de pièces (ajout/retrait),
      `expiresInDays`. Les bornes du backend (1–20 pièces, 200 caractères, 1–90 jours) sont
      **rappelées dans l'UI** mais restent appliquées côté serveur — l'UI guide, elle ne protège pas.
- [ ] **B1.11 — Remise du lien + PIN, avec copie en un clic.**

```tsx
// Le PIN n'apparait qu'ici, une seule fois : il est stocke en argon2id et ne se
// reaffiche pas, il se remplace en regenerant le lien. L'ecran doit le dire, ou
// l'avocat fermera l'onglet en croyant pouvoir y revenir.
```

  Bouton « Copier le lien », bouton « Copier le PIN », et un avertissement explicite. Test : le
  PIN disparaît de l'écran après navigation et n'est **jamais** redemandé à l'API.
- [ ] **B1.12 — Reveal au scroll**, reporté d'E1 : `opacity` + `translateY`, via
      `IntersectionObserver`. La liste est le premier écran qui défile. Respecter
      `prefers-reduced-motion` — sinon l'animation est une gêne d'accessibilité, pas un détail de
      charte.
- [ ] **B1.13 — Vérification au navigateur** (`pnpm -C frontend dev -- --port 5174`, API de la
      piste A sur `:21610`) : les cinq couleurs de la charte, le survol inversé du bouton primaire,
      les cartes sans ombre bordure `#E9E9E9`, aucun décalage d'un pixel au survol.
- [ ] **B1.14 — `pnpm -C frontend test && pnpm -C frontend lint`. Commit** :
      `feat(dashboard): create a request and hand over its link and pin once`

## Tâche B2 — C3 : progression client

**Démarre quand la Tâche A3 est fusionnée** (les routes publiques répondent). Écrite contre les
signatures gelées, donc l'attente ne porte que sur la vérification au navigateur.

- [ ] **B2.1 — Test : aucun autre dossier n'est joignable**

```tsx
// Le scenario d'echec reel : la page client rendue avec le meme composant que
// le tableau de bord avocat afficherait la liste complete du cabinet a un
// inconnu qui detient un lien.
it('renders only the pieces of the unlocked request', () => { /* ... */ })
```

- [ ] **B2.2 — Écrire `pages/deposit-page.tsx`**, route `/deposit/:token`. Trois états :
      saisie du PIN, dossier déverrouillé, écran d'impasse.
- [ ] **B2.3 — Écran d'impasse unique** pour lien expiré / révoqué / inconnu / PIN faux : le
      backend renvoie une réponse unique, l'interface doit en faire autant. **Un message différent
      côté client réinstaurerait l'oracle que C1 vient de fermer.**
- [ ] **B2.4 — Vue « n/m pièces déposées »**, état par pièce, dépôt par pièce (`input type=file`
      accepté sur `.pdf,.jpg,.jpeg,.png`), erreurs 413 et 415 rendues en français lisible.
- [ ] **B2.5 — Vérification au navigateur, largeur mobile comprise** — c'est le contexte d'usage
      réel du parcours client.
- [ ] **B2.6 — `pnpm -C frontend test && lint`. Commit** : `feat(deposit): let the client unlock, deposit and follow their progress`

## Tâche B3 — Revue et fusion de la piste B

- [ ] Revue du diff complet, findings par gravité.
- [ ] `ai-plans/2026-08-10-b5-ecrans-avocat.md` et `2026-08-10-c3-progression-client.md`.
- [ ] Rebase sur `main`, merge.

---

# Piste C — observabilité, durcissement, livrables (worktree `../wt-f1`)

G4 → F1 → F2 → A8 → H1. **≈ 5 h.** Propriétaire exclusif de `infra/`, `install.sh`, `.env.example`,
`README.md`.

## Tâche C1 — G4 : Content-Security-Policy

**30 min, aucune dépendance, et à faire en premier** parce que la politique retenue doit être
documentée dans H1.

- [ ] **C1.1 — Poser la politique dans `infra/nginx/server-hardening.conf`**, donc appliquée aux
      **trois** blocs `server` (clair, TLS, et le bloc port 80 du calque TLS). C'est déjà l'endroit
      de `Referrer-Policy` et `X-Robots-Tag`.
- [ ] **C1.2 — Mesurer avant de promettre.** `default-src 'self'` doit passer : la police est
      auto-hébergée et E1 a mesuré 40 requêtes au chargement, toutes sur l'origine. Ouvrir la
      console du navigateur et **compter les violations**, ne pas supposer.
- [ ] **C1.3 — Le point dur est `style-src`.** Chakra v3 injecte ses styles à l'exécution, ce qui
      demande `'unsafe-inline'` sur les styles ; un nonce supposerait une page rendue par un
      serveur, ce que le SPA statique n'est pas. **Écrire dans le README que `'unsafe-inline'` sur
      `style-src` ne couvre pas l'injection de style**, plutôt que laisser croire à une CSP stricte.
- [ ] **C1.4 — Piège nginx à ne pas rouvrir** : un `add_header` ajouté plus tard dans un `location`
      annule **tous** ceux hérités, sans erreur au démarrage. Vérifier les en-têtes sur `/`, sur
      `/api/v1/requests` et sur `/deposit/<token>`, pas seulement sur `/`.
- [ ] **C1.5 — Assertion dans `scripts/test-bare-machine.sh`** : `Content-Security-Policy` présent
      sur `/`. Commit : `feat(nginx): declare a content security policy on all three server blocks`

## Tâche C2 — F1 : métriques Prometheus

### Comparatif — la bibliothèque

| Option | Pour | Contre | Verdict |
|---|---|---|---|
| **`prom-client` directement** | La bibliothèque de référence, aucune couche d'indirection, un `MetricsModule` de 60 lignes | Il faut écrire le contrôleur `/metrics` et l'intercepteur de latence | **Retenu** — c'est 60 lignes qu'on maîtrise contre une dépendance de plus |
| `@willsoto/nestjs-prometheus` | Décorateurs `@InjectMetric` | Enrobage tiers sur une bibliothèque déjà simple, une version de plus à suivre | Écarté |

**Fichiers :** créer `backend/src/metrics/{metrics.module.ts,metrics.service.ts,metrics.controller.ts,http-metrics.interceptor.ts}`,
`infra/prometheus/prometheus.yml` ; modifier `infra/docker-compose.yml`, `infra/nginx/portal-locations.conf`.

- [ ] **C2.1 — Test : `/metrics` est fermé de l'extérieur**

```ts
// Le scenario d'echec reel : publie, /metrics dit a un inconnu combien de
// demandes existent, quand les depots ont lieu et quelle dependance est en
// panne. Meme raisonnement que le `deny all` de /api/v1/health.
it('is denied by nginx like the health probe', () => { /* assertion 403 */ });
```

- [ ] **C2.2 — Écrire `MetricsService`** avec les cinq métriques et les quatre méthodes du
      § Interfaces gelées. Un `Registry` dédié, `collectDefaultMetrics` activé.
- [ ] **C2.3 — Justifier chaque métrique dans un commentaire d'une ligne** — c'est ce que le README
      devra reprendre (F2 l'exige explicitement).

  | Métrique | Ce qu'elle sert à décider |
  |---|---|
  | `deposits_total{outcome}` | Le produit fait-il son seul travail ? Un pic de `rejected_type` = allowlist mal comprise par les clients |
  | `unlock_attempts_total{outcome}` | Un pic d'`failure` est la signature d'un brute force sur 10 000 combinaisons — **c'est le signal qui remplace G1**, coupé du périmètre |
  | `expired_link_hits_total` | Des clients arrivent trop tard : la durée par défaut est trop courte |
  | `upload_bytes` | Dimensionner le bucket et repérer un abus |
  | `http_request_duration_seconds` | Latence par route, la base de toute alerte de disponibilité |

- [ ] **C2.4 — `@Public()` sur `/metrics`, `deny all` dans `portal-locations.conf`** (exact-match
      `location = /api/v1/metrics`, comme la sonde de santé). Ajouter `/api/v1/metrics` à la liste
      des quatre fichiers qui figent le préfixe (§ Ports and API prefix de `CLAUDE.md`).
- [ ] **C2.5 — Service `prometheus` dans le compose**, sur le réseau interne, **aucun port publié**.
      `infra/prometheus/prometheus.yml` scrape `backend:21610/api/v1/metrics`.
- [ ] **C2.6 — `pnpm -C backend test && lint`. Commit** : `feat(metrics): expose business and http metrics on a closed endpoint`

## Tâche C3 — F2 : Grafana et alertes

- [ ] **C3.1 — Grafana conteneurisé, dashboard provisionné** — pas cliqué à la main :
      `infra/grafana/provisioning/{datasources,dashboards}/` plus le JSON du dashboard. Un dashboard
      cliqué disparaît avec le volume, et rien ne le dit.
- [ ] **C3.2 — Quatre alertes**, chacune avec son seuil justifié :
      API injoignable ; taux d'échec d'upload > 10 % sur 5 min ; **plus de 20 PIN erronés sur
      5 min pour un même processus** (brute force) ; MinIO injoignable (la sonde `/health` répond
      déjà 503 dans ce cas).
- [ ] **C3.3 — Accès Grafana.** Il expose une UI d'administration sur une machine partagée avec
      d'autres candidats : **pas de port publié**, accès par `location /grafana/` dans nginx,
      derrière le mot de passe admin généré par `install.sh`. Le mot de passe rejoint la règle des
      trois fichiers.
- [ ] **C3.4 — Commit** : `feat(grafana): provision the portal dashboard and its four alerts`

## Tâche C4 — A8 : fermer le dernier critère + brancher les compteurs

- [ ] **C4.1 — `SERVICES` dans `install.sh`** passe à `db minio backend frontend proxy prometheus grafana`.
      Sans ça le script rend la main avant que Grafana réponde, ce qui casse son contrat : « sortie 0
      veut dire que le portail répond ».
- [ ] **C4.2 — Vérifier que `prometheus` et `grafana` ont un `healthcheck` avec `start_interval: 1s`**,
      comme les cinq autres — sinon la boucle d'attente perd un intervalle complet par service.
- [ ] **C4.3 — Brancher les compteurs de la piste A** (après merge de C2) : cinq appels
      `metrics.recordDeposit(...)` / `recordUnlock(...)` / `recordExpiredLinkHit()` dans
      `public.service.ts` et `deposits.service.ts`. Un fichier de la piste A, touché **une seule
      fois, après sa fusion** — c'est ce qui a évité le conflit pendant tout le sprint.
- [ ] **C4.4 — `pnpm test:bare-machine`** : exit 0, `/` → 200, `/api/v1/health` → 403,
      `/api/v1/metrics` → 403, `.env` en 600, jeton absent des journaux du proxy **et** du frontend.
      Noter la durée mesurée.
- [ ] **C4.5 — Commit** : `feat(install): wait for prometheus and grafana before reporting success`

## Tâche C5 — H1 : README complet

Écrit en dernier, quand tout est mesuré. **Chaque chiffre du README est une mesure, pas une
estimation.**

- [ ] URL HTTPS du sous-domaine, identifiants de démo (compte avocat + lien et PIN seedés).
- [ ] Setup : `git clone`, `./install.sh`, attendre. Les durées mesurées.
- [ ] Architecture et choix justifiés : le **pas de Next.js**, GHCR plutôt que Docker Hub, MinIO
      derrière l'API S3, Vitest côté front et Jest côté back, le flux plutôt que l'URL pré-signée.
- [ ] Modèle de données, avec les quatre décisions contre-intuitives d'A2.
- [ ] Stratégie de tests : les trois étages (unitaire, e2e contre un vrai Postgres, intégration
      contre un vrai MinIO), et **ce qu'aucun étage ne traverse** — nginx et le rendu réel.
- [ ] Périmètre d'observabilité et justification de chaque métrique (le tableau de C2.3).
- [ ] **Limites connues**, nommées et non enfouies :
      `linux/amd64` uniquement ; la production épingle un tag mutable, pas un digest ; **pas de rate
      limiting sur `/public/:token/unlock`** (G1 coupé — ce que la métrique
      `unlock_attempts_total` permet de détecter sans l'empêcher) ; pas d'antivirus (C4 coupé) ;
      `style-src 'unsafe-inline'` imposé par Chakra ; une seule langue ; jsdom ne calcule aucun
      style, donc trois défauts de charte peuvent passer sous une suite verte (D5).
- [ ] **Commit** : `docs(readme): document setup, architecture, data model, tests and limits`

---

## Sécurité — les risques résiduels de ce sprint

Chaque plan de ce dépôt nomme ce qu'il laisse ouvert. Voici la liste pour ce sprint, à reprendre
telle quelle dans H1.

| Risque | Ce qui le borne aujourd'hui | Ce qui reste ouvert |
|---|---|---|
| Brute force du PIN (10 000 combinaisons) | argon2id (67 ms par essai), réponses indistinguables | **Aucune limite de débit** (G1 coupé). Détectable par `unlock_attempts_total`, pas empêché. À dire dans le README |
| Session client survivant à une révocation | `ClientSessionGuard` **relit le lien** à chaque requête | Rien : c'est fermé par construction |
| Jeton avocat utilisé comme session client | `typ: 'client'` vérifié, `sub` exigé côté avocat, deux tests dans les deux sens | Rien |
| Fichier hostile déposé | Magic bytes, allowlist de trois formats, 20 Mo, `Content-Disposition` échappé | **Pas d'antivirus** (C4 coupé). Un PDF malveillant *valide* passe |
| Jeton de dépôt dans les journaux | `log-redact.conf`, `-L` sur `serve`, `Referrer-Policy: no-referrer` | La carte de masquage doit suivre D6 — c'est l'objet de la Tâche A1.4, et l'assertion négative de `test-bare-machine.sh` l'attrape |
| Dépendance frontend compromise | CSP `default-src 'self'` | `style-src 'unsafe-inline'`, imposé par Chakra v3 |
| `/metrics` et Grafana exposés | `deny all` nginx, aucun port publié, mot de passe généré | Grafana derrière un simple mot de passe admin |

---

## Chronologie

| Heure | Piste A (principal) | Piste B (`wt-b5`) | Piste C (`wt-f1`) |
|---|---|---|---|
| 0:00 | Mise en place des worktrees (15 min, ensemble) | | |
| 0:15 | A1 — D6 | B1 — B5 liste + détail | C1 — G4 CSP |
| 0:45 | A2 — C1 unlock | ↓ | C2 — F1 métriques |
| 2:15 | A3 — C2 dépôt | B1 — création + remise du lien | ↓ |
| 2:45 | ↓ | ↓ | C3 — F2 Grafana |
| 4:15 | **merge A2+A3** → A4 B4b | B2 — C3 progression client | C4 — A8 + branchement compteurs |
| 5:15 | **merge A4** | **merge B** | C5 — H1 README |
| 6:15 | Tâches Z (ensemble) | | |
| 6:45 | Fin | | |

---

## Tâches Z — clôture, toutes pistes fusionnées

- [ ] **Z1 — Vérification de bout en bout.** `./install.sh` sur machine propre, puis le parcours
      complet **à la main, au navigateur** : login avocat → création d'une demande → copie du lien
      et du PIN → ouverture du lien en navigation privée → saisie du PIN → dépôt de trois fichiers →
      retour au tableau de bord, statut **complète** → téléchargement d'une pièce. C'est le seul
      test qui traverse nginx, et aucun étage automatisé ne le couvre.
- [ ] **Z2 — `issue_backlog.md` et `CLAUDE.md`, en une seule passe.** Cocher les critères
      réellement tenus, **décocher ce qui ne l'est pas**, et écrire pour chaque issue coupée
      pourquoi elle l'a été. Une case cochée à tort coûte plus cher qu'une case ouverte.
- [ ] **Z3 — H4** : vérifier qu'il existe un `ai-plans/2026-08-10-*.md` par issue livrée.
- [ ] **Z4 — H3** : `/export` de toutes les sessions dans `ai-logs/`, puis **relecture de
      caviardage** — clés d'API, mots de passe, `.env` collés dans une réponse, données
      personnelles. À faire ligne à ligne : c'est le livrable le plus facile à polluer.
- [ ] **Z5 — Publier les images** (`IMAGE_TAG` 0.4.0) et vérifier que la production **tire** bien la
      version publiée : `IMAGE_TAG=sha-<court> docker compose -f infra/docker-compose.yml --env-file .env up -d`.
      Une image reconstruite localement n'est pas l'artefact déployé.
- [ ] **Z6 — Revue de code finale du diff `main` avant/après sprint**, findings par gravité.

---

## Auto-relecture

**Couverture du périmètre annoncé :** D6→A1, C1→A2, C2→A3, B4b→A4, B5→B1, C3→B2, G4→C1, F1→C2,
F2→C3, A8→C4, H1→C5, H2 déjà tenu par le seed de B1 (à cocher en Z2), H3→Z4, H4→Z3. Aucune issue
annoncée sans tâche.

**Cohérence des types :** `PublicItemView` / `PublicRequestView` / `DepositedFileView` /
`ClientSessionPayload` sont définis une fois au § Interfaces gelées et utilisés sous ces noms
exacts en A2, A3 et B2. `recordDeposit` / `recordUnlock` / `recordExpiredLinkHit` /
`observeUploadBytes` sont définis en C2 et appelés en C4.3, sous les mêmes noms.

**Point de vigilance restant :** la Tâche A3.9 modifie `request.types.ts`, fichier que B4 a livré et
que la piste B lit à travers l'API. Le changement est **compatible en surface** — `received` reste
un booléen — donc la piste B n'a rien à ajuster. C'est la seule modification transverse du sprint,
et elle est volontairement placée dans la piste propriétaire du backend.
