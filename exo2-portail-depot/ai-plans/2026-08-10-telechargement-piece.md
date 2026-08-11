# Téléchargement d'une pièce déposée — plan d'implémentation

> **Pour un agent exécutant :** SOUS-SKILL REQUISE — `superpowers:executing-plans` pour dérouler ce
> plan tâche par tâche. Les étapes sont en cases à cocher.
>
> **À la première étape de l'exécution, copier ce fichier dans
> `ai-plans/2026-08-10-telechargement-piece.md`** : c'est la convention du dépôt, et le plan fait
> partie du livrable.

**Objectif :** donner à l'avocat un bouton qui télécharge une pièce déposée, depuis l'écran de
détail d'une demande.

**Architecture :** l'API existe déjà et fonctionne (`GET /requests/:id/items/:itemId/file`, vérifié
octet pour octet à travers nginx). Tout le travail est côté frontend : une fonction de
téléchargement dans la couche API qui **réutilise le renouvellement de session**, un utilitaire qui
déclenche l'enregistrement du fichier, et un bouton branché sur la prop `action` que `ItemRow`
expose déjà.

**Pile :** React 19, Chakra v3, Vitest 4 + Testing Library, oxlint type-aware.

## Contexte — pourquoi ce changement

La passe navigateur du 10/08 a trouvé que **l'avocat ne peut pas récupérer les pièces de son
client**, ce qui est la finalité du produit. L'écran de détail affiche les pièces reçues avec leur
nom et leur taille, mais n'a ni bouton, ni lien, ni le mot « télécharger » — ses seuls boutons sont
« Se déconnecter », « Régénérer le lien », « Révoquer l'accès ».

L'issue **B4b** était cochée P0 « fait » : exact sur ses critères, qui portent tous sur l'API, et
faux au niveau du produit. C'est l'angle mort typique — les tests e2e appellent la route
directement, donc aucune suite ne voit qu'aucun écran n'y mène.

## Contraintes globales

- **Interface en français, sans accents dans les libellés écrits en dur** — c'est la convention des
  fichiers existants (`'Regenerer le lien'`, `'Depot echoue'`). Le **code, les commentaires et les
  tests sont en anglais**.
- **Aucune couleur, police ou rayon écrit dans un écran** : tout vient du thème.
- Les deux lints sont **bloquants** (`--deny-warnings` côté frontend). Un avertissement fait échouer
  `pnpm lint`.
- `frontend/scripts/verify-type-aware.sh` tourne avant chaque lint : `no-floating-promises` est
  actif, donc toute promesse non attendue doit être `void`-ée explicitement.
- **Rien ne s'ajoute au `href`** : `originalName` vient d'un client anonyme.

## Structure des fichiers

| Fichier | Rôle |
|---|---|
| `frontend/src/api/client.ts` | **modifier** — extraire `sendWithRenewal`, ajouter `filenameFromDisposition` et `apiDownload` |
| `frontend/src/api/client.test.ts` | **créer si absent, sinon compléter** — tests du parseur de nom |
| `frontend/src/api/requests.ts` | **modifier** — ajouter `downloadItemFile` |
| `frontend/src/save-blob.ts` | **créer** — déclenche l'enregistrement, isolé pour être remplaçable en test |
| `frontend/src/pages/request-detail-page.tsx` | **modifier** — le bouton, via la prop `action` d'`ItemRow` |
| `frontend/src/pages/request-detail-page.test.tsx` | **modifier** — trois cas |

**`ItemRow` n'est pas modifié.** Il porte déjà `action?: ReactNode`, documentée
« The client's deposit control (C3). The lawyer's screens pass nothing. » — c'est exactement le
point d'insertion prévu.

## Les deux décisions de conception, et ce qu'elles coûtent

**1. On télécharge par `fetch` + blob, pas par un `<a href="/api/...">`.**

Le lien simple est plus économe : il diffuse le flux sans rien mettre en mémoire, et le navigateur
prend le nom dans l'en-tête `Content-Disposition` que le serveur produit déjà. Il a un défaut qui
le disqualifie : **il ne passe pas par le renouvellement de session**. `apiRequest` rejoue une
requête après un 401 en rafraîchissant le jeton ; un `<a>` ne le fait pas. Le jeton d'accès vit
**15 minutes** — mesuré ce soir : `portail_auth` expire à 15 min, et le rafraîchissement fonctionne.
Un avocat qui laisse l'écran d'un dossier ouvert vingt minutes puis clique téléchargerait donc
l'erreur JSON de Nest à la place de sa pièce. Ce n'est pas un cas limite, c'est l'usage normal d'un
écran de consultation.

Ce qu'on échange contre ça : **le fichier est mis en mémoire en entier**. C2 plafonne à 20 Mio, donc
c'est borné. À dire dans les limites du README si le plafond monte un jour.

**2. Le nom du fichier est relu dans `Content-Disposition`, pas reconstruit depuis `originalName`.**

Un blob n'a pas d'en-têtes : avec cette approche, c'est l'attribut `download` qui nomme le fichier,
donc le frontend doit fournir un nom. Deux façons, et une seule est bonne :

- ~~`safeFileName(file.originalName)`~~ — **non** : cet utilitaire est fait pour l'affichage, il
  **tronque à 40 caractères avec des points de suspension** (`format.ts:61`). Il enregistrerait
  `contrat-de-ba….pdf`.
- **Relire l'en-tête que le serveur envoie déjà**, en forme RFC 5987
  (`filename*=UTF-8''piece-valide.pdf`, vérifié ce soir). La règle d'encodage vit déjà dans le
  contrôleur et un test e2e la couvre ; la relire garde **une seule définition** du nom. Une
  deuxième règle côté client serait libre de diverger de la première sans qu'aucun test ne le voie.

**Le bouton n'apparaît que si `item.received` vaut vrai.** Depuis la correction récente de
`request.types.ts`, `received` signifie `file.status === 'complete'` — exactement ce que la route
accepte de servir, un fichier `failed` répondant 404. Aucun changement d'API n'est donc nécessaire,
et il n'y a pas de bouton qui mènerait à un refus.

---

### Tâche 1 : la couche API — renouvellement partagé, nom du fichier, téléchargement

**Fichiers :**
- Modifier : `frontend/src/api/client.ts`
- Test : `frontend/src/api/client.test.ts`

**Interfaces produites :**
- `filenameFromDisposition(header: string | null): string`
- `apiDownload(path: string): Promise<{ blob: Blob; filename: string }>`

- [ ] **Étape 1 : écrire les tests du parseur de nom**

```ts
import { describe, expect, it } from 'vitest'
import { filenameFromDisposition } from './client'

describe('filenameFromDisposition', () => {
  it('reads the RFC 5987 name the backend sends', () => {
    expect(filenameFromDisposition("attachment; filename*=UTF-8''piece-valide.pdf")).toBe(
      'piece-valide.pdf',
    )
  })

  it('decodes the percent-encoding, so an accented name is not saved mangled', () => {
    expect(filenameFromDisposition("attachment; filename*=UTF-8''pi%C3%A8ce%20d%27identit%C3%A9.pdf")).toBe(
      "pièce d'identité.pdf",
    )
  })

  // A header we cannot read must not throw in the middle of a download: the
  // lawyer gets a dull name rather than no file at all.
  it('falls back when the header is absent or undecodable', () => {
    expect(filenameFromDisposition(null)).toBe('piece')
    expect(filenameFromDisposition("attachment; filename*=UTF-8''%E0%A4%A")).toBe('piece')
  })
})
```

- [ ] **Étape 2 : lancer le test, vérifier qu'il échoue**

Lancer : `pnpm -C frontend test client`
Attendu : ÉCHEC — `filenameFromDisposition is not a function`.

- [ ] **Étape 3 : extraire `sendWithRenewal` sans changer le comportement**

Dans `frontend/src/api/client.ts`, sortir les six lignes de renouvellement d'`apiRequest` :

```ts
/**
 * One renewal, one replay. Extracted from apiRequest because the download path
 * needs exactly the same rule: without it, a lawyer whose 15-minute access
 * token expired while the screen sat open would download Nest's 401 body.
 */
const sendWithRenewal = async (path: string, init: RequestInit): Promise<Response> => {
  const response = await send(path, init)
  if (response.status !== 401 || isNeverRenewed(path)) return response

  const renewed = await send(REFRESH_PATH, { method: 'POST' })
  return renewed.ok ? await send(path, init) : response
}
```

Puis remplacer le début d'`apiRequest` par `const response = await sendWithRenewal(path, init)`, et
supprimer le bloc `if (response.status === 401 && ...)` ainsi que le `let`.

- [ ] **Étape 4 : ajouter le parseur et le téléchargement**

```ts
/** Nothing in the product is called that, so a fallback name is recognisable. */
const FALLBACK_FILENAME = 'piece'

/**
 * The name the server put in Content-Disposition, RFC 5987 form. Read back
 * rather than rebuilt from originalName: the encoding rule already lives in
 * the controller and an e2e case covers it, so a second rule here would be
 * free to disagree with it. safeFileName is NOT usable — it truncates at 40
 * characters for display and would save "contrat-de-ba….pdf".
 */
export const filenameFromDisposition = (header: string | null): string => {
  const match = /filename\*=UTF-8''([^;]+)/i.exec(header ?? '')
  if (match === null) return FALLBACK_FILENAME
  try {
    const decoded = decodeURIComponent(match[1])
    return decoded === '' ? FALLBACK_FILENAME : decoded
  } catch {
    // A malformed percent-sequence throws; it must not abort the download.
    return FALLBACK_FILENAME
  }
}

/**
 * A binary answer, with the same session handling as apiRequest. Separate from
 * it because parse() demands JSON: a 200 that is not JSON is how that function
 * detects a drifted /api prefix, and a PDF would trip exactly that check.
 */
export const apiDownload = async (
  path: string,
): Promise<{ blob: Blob; filename: string }> => {
  const response = await sendWithRenewal(path, { headers: { accept: '*/*' } })

  if (!response.ok) {
    const raw = await response.text().catch(() => '')
    throw apiErrorFor(response.status, response.headers.get('content-type') ?? '', raw)
  }

  return {
    blob: await response.blob(),
    filename: filenameFromDisposition(response.headers.get('content-disposition')),
  }
}
```

- [ ] **Étape 5 : relancer toute la suite frontend**

Lancer : `pnpm -C frontend test`
Attendu : les nouveaux cas passent, **et aucun test existant ne casse** — l'extraction de
`sendWithRenewal` touche le chemin de toutes les requêtes, c'est ce que cette étape contrôle.

- [ ] **Étape 6 : commit**

```bash
git add frontend/src/api/client.ts frontend/src/api/client.test.ts
git commit -m "feat(api): download a binary answer through the session renewal"
```

---

### Tâche 2 : déclencher l'enregistrement, et l'appel typé

**Fichiers :**
- Créer : `frontend/src/save-blob.ts`
- Modifier : `frontend/src/api/requests.ts`

**Interfaces consommées :** `apiDownload` (tâche 1).
**Interfaces produites :**
- `saveBlob(blob: Blob, filename: string): void`
- `downloadItemFile(requestId: string, itemId: string): Promise<{ blob: Blob; filename: string }>`

- [ ] **Étape 1 : écrire `save-blob.ts`**

Pas de test unitaire ici : la fonction n'est que des appels au navigateur, et un test la
réimplémenterait en assertions. Elle est **isolée dans son fichier précisément pour être remplacée
par un espion** dans le test de la tâche 3.

```ts
/**
 * Hands a blob to the browser as a download.
 *
 * The anchor is created and removed rather than rendered: React would have to
 * keep an element whose only purpose is to be clicked once.
 */
export const saveBlob = (blob: Blob, filename: string): void => {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  // Revoked on the next tick, not straight away: a browser that has not yet
  // started reading the URL would cancel the download.
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
```

- [ ] **Étape 2 : ajouter l'appel typé dans `requests.ts`**

À la suite de `revokeLink`, en important `apiDownload` depuis `./client` :

```ts
/**
 * The bytes of a deposited piece. Only ever called for an item whose `received`
 * is true: since request.types.ts counts `complete` alone as received, that is
 * exactly the set the route agrees to serve — a `failed` file answers 404.
 */
export const downloadItemFile = (
  requestId: string,
  itemId: string,
): Promise<{ blob: Blob; filename: string }> =>
  apiDownload(
    `/requests/${encodeURIComponent(requestId)}/items/${encodeURIComponent(itemId)}/file`,
  )
```

- [ ] **Étape 3 : vérifier que tout compile et que le lint passe**

Lancer : `pnpm -C frontend build && pnpm -C frontend lint`
Attendu : succès, **zéro avertissement**.

- [ ] **Étape 4 : commit**

```bash
git add frontend/src/save-blob.ts frontend/src/api/requests.ts
git commit -m "feat(api): expose the deposited file of an item to the lawyer"
```

---

### Tâche 3 : le bouton sur l'écran de détail

**Fichiers :**
- Modifier : `frontend/src/pages/request-detail-page.tsx`
- Test : `frontend/src/pages/request-detail-page.test.tsx`

**Interfaces consommées :** `downloadItemFile`, `saveBlob`, la prop `action` d'`ItemRow`.

- [ ] **Étape 1 : écrire les trois tests**

À ajouter dans `request-detail-page.test.tsx`, qui a déjà les fabriques `received()`, `pending()`,
`detail()` et `stubSequence()`. Le module d'enregistrement est espionné — c'est la raison d'être de
son fichier séparé :

```ts
vi.mock('../save-blob', () => ({ saveBlob: vi.fn() }))
```

```ts
it('offers no download on a piece nobody has deposited yet', async () => {
  stubSequence([() => jsonResponse(detail({ items: [pending("Piece d'identite")] }))])
  renderDetail()

  expect(await screen.findByText("Piece d'identite")).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /Telecharger/ })).not.toBeInTheDocument()
})

it('saves the file the API returns, under the name the API names', async () => {
  const { saveBlob } = await import('../save-blob')
  const fetchMock = stubSequence([
    () => jsonResponse(detail({ items: [received('contrat.pdf')] })),
    () =>
      new Response(new Blob(['%PDF-1.4']), {
        status: 200,
        headers: {
          'content-type': 'application/pdf',
          'content-disposition': "attachment; filename*=UTF-8''contrat.pdf",
        },
      }),
  ])
  renderDetail()

  await userEvent.click(await screen.findByRole('button', { name: /Telecharger/ }))

  expect(fetchMock.mock.calls[1][0]).toBe(
    '/api/v1/requests/r1/items/Contrat de bail signe/file',
  )
  expect(saveBlob).toHaveBeenCalledWith(expect.any(Blob), 'contrat.pdf')
})

// The file can vanish between the page load and the click -- the request may
// have been deleted in another tab. The screen must say so, not fail silently.
it('shows a message when the piece can no longer be served', async () => {
  stubSequence([
    () => jsonResponse(detail({ items: [received('contrat.pdf')] })),
    () => jsonResponse({ message: 'Not Found' }, 404),
  ])
  renderDetail()

  await userEvent.click(await screen.findByRole('button', { name: /Telecharger/ }))

  expect(await screen.findByText(/introuvable/i)).toBeInTheDocument()
})
```

Si `renderDetail()` n'existe pas comme fonction locale dans ce fichier, reprendre littéralement le
bloc `renderWithTheme(...)` des tests voisins plutôt que d'en inventer un.

- [ ] **Étape 2 : lancer les tests, vérifier qu'ils échouent**

Lancer : `pnpm -C frontend test request-detail-page`
Attendu : ÉCHEC — aucun bouton nommé `Telecharger` n'est trouvé.

- [ ] **Étape 3 : ajouter les libellés**

Dans l'objet `TEXT` de `request-detail-page.tsx` :

```ts
  download: 'Telecharger',
  // Every row would otherwise expose the same accessible name, and a screen
  // reader would announce a list of identical buttons.
  downloadAria: (label: string) => `Telecharger ${label}`,
  downloading: 'Telechargement...',
```

- [ ] **Étape 4 : ajouter l'état et le gestionnaire**

Dans le composant, à côté des états existants :

```ts
  const [downloading, setDownloading] = useState<string | null>(null)

  const onDownload = async (itemId: string) => {
    setDownloading(itemId)
    setActionError(null)
    try {
      const { blob, filename } = await downloadItemFile(id, itemId)
      saveBlob(blob, filename)
    } catch (caught) {
      setActionError(messageFor(caught))
    } finally {
      setDownloading(null)
    }
  }
```

Imports à ajouter : `downloadItemFile` depuis `../api/requests`, `saveBlob` depuis `../save-blob`.

`messageFor` est réutilisé tel quel : il traduit déjà `notFound` en « Demande introuvable. », ce que
le test de l'étape 1 attend.

- [ ] **Étape 5 : brancher le bouton sur la prop `action`**

Remplacer le `<ItemRow>` existant par :

```tsx
                    <ItemRow
                      key={item.id}
                      label={item.label}
                      state={item.received ? 'received' : 'pending'}
                      file={item.file}
                      action={
                        item.received ? (
                          <Button
                            variant="secondary"
                            // Same rule as the client's deposit control: sm is
                            // 40px, and a finger wants more than that.
                            size={{ base: 'md', md: 'sm' }}
                            aria-label={TEXT.downloadAria(item.label)}
                            disabled={downloading !== null}
                            onClick={() => void onDownload(item.id)}
                          >
                            {downloading === item.id ? TEXT.downloading : TEXT.download}
                          </Button>
                        ) : undefined
                      }
                    />
```

Le commentaire « THE line C2 will change » au-dessus reste valable : il porte sur le calcul de
`state`, qui ne bouge pas.

- [ ] **Étape 6 : relancer les tests et les deux lints**

Lancer : `pnpm -C frontend test && pnpm -C frontend lint`
Attendu : tout est vert, zéro avertissement. Si `no-floating-promises` proteste, c'est que le
`void` devant `onDownload` a sauté.

- [ ] **Étape 7 : commit**

```bash
git add frontend/src/pages/request-detail-page.tsx frontend/src/pages/request-detail-page.test.tsx
git commit -m "feat(dashboard): let the lawyer download a piece their client deposited"
```

---

### Tâche 4 : vérifier dans un vrai navigateur, puis fermer l'issue

**Rien de tout ce qui précède ne prouve que ça marche en production.** Trois choses ne se voient
qu'au navigateur, et une leçon a déjà été payée aujourd'hui : **jsdom n'implémente pas
`URL.createObjectURL`**, la CSP n'existe pas en test, et la pile sert une **image**, pas les
sources.

- [ ] **Étape 1 : reconstruire l'image du frontend, sinon la vérification ment**

```bash
docker compose -f infra/docker-compose.yml -f infra/docker-compose.build.yml --env-file .env build frontend
docker compose -f infra/docker-compose.yml --env-file .env up -d frontend
curl -s http://127.0.0.1:21600/ | grep -oE 'assets/index-[A-Za-z0-9_-]+\.js'
```

Attendu : une empreinte **différente** de `index-Cpw9AE4p.js`. Si elle est identique, l'image n'a
pas été reconstruite et tout ce qui suit teste l'ancien écran.

- [ ] **Étape 2 : jouer le téléchargement avec Playwright, et récupérer le fichier**

Se connecter, ouvrir une demande ayant une pièce reçue, puis :

```js
const [download] = await Promise.all([
  p.waitForEvent('download'),
  p.getByRole('button', { name: /Telecharger/ }).first().click(),
])
await download.saveAs('/tmp/telecharge.pdf')
return { nom: download.suggestedFilename(), violationsCSP: await p.evaluate(() => window.__v) }
```

Attendu : `suggestedFilename()` est le nom d'origine de la pièce, **et `violationsCSP` est vide**.
C'est le point qui justifie cette étape : la politique servie est `default-src 'self'` **sans
`blob:`**, et c'est ici qu'on apprend si le navigateur s'en sert contre le téléchargement.

- [ ] **Étape 3 : comparer les octets**

```bash
sha256sum /tmp/telecharge.pdf
```

Attendu : identique à l'empreinte du fichier déposé. Un téléchargement qui rend un fichier
légèrement différent est pire que pas de bouton du tout.

- [ ] **Étape 4 : vérifier le chemin qui a motivé toute la conception**

Le renouvellement après expiration du jeton d'accès. Sans forcer une attente de 15 minutes :
supprimer le cookie d'accès, garder celui de rafraîchissement, puis cliquer.

```js
const cookies = await ctx.cookies();
await ctx.clearCookies();
await ctx.addCookies(cookies.filter(c => c.name === 'portail_refresh'));
```

Attendu : le téléchargement aboutit quand même. C'est exactement ce qu'un `<a href>` n'aurait pas
su faire, donc la seule preuve que la décision valait son coût.

- [ ] **Étape 5 : la pièce non reçue n'offre rien**

Sur la même demande, une pièce restée « En attente » ne doit porter aucun bouton.

- [ ] **Étape 6 : mettre le backlog à jour**

Dans `issue_backlog.md` : cocher `- [ ] **Une action de téléchargement sur chaque pièce reçue de
l'écran de détail**` sous B4b, retirer l'encadré « Rouvert le 10/08 », remettre le titre à
`— P0 — **fait**`, et retirer la ligne `| **B4b**, écran |` du tableau « Ce qui reste » en tête.

Cocher aussi, dans `docs/tests-manuels.md` § A9, la case « Télécharger la pièce déposée depuis
l'écran avocat, puis `cmp` → aucune différence », qui devient vraie.

- [ ] **Étape 7 : commit**

```bash
git add issue_backlog.md docs/tests-manuels.md ai-plans/2026-08-10-telechargement-piece.md
git commit -m "docs(backlog): close B4b now the lawyer can reach the download"
```

---

## Relecture du plan

- **Couverture** : le manque relevé est « aucun écran ne mène au téléchargement » ; les tâches 1 à 3
  le comblent, la tâche 4 le prouve sur la pile réelle.
- **Pas de trou** : `filenameFromDisposition`, `apiDownload`, `saveBlob`, `downloadItemFile` sont
  définies avec leur corps avant d'être utilisées ; `messageFor`, `setActionError`, `ItemRow.action`,
  `received()` et `stubSequence()` existent déjà dans le dépôt.
- **Noms cohérents** entre les tâches : `apiDownload` (t1) → `downloadItemFile` (t2) → `onDownload`
  (t3), et `{ blob, filename }` est la même forme partout.

## Hors périmètre, nommé plutôt que fait

- **Un dépôt refusé n'est pas montré à l'avocat.** `toRequestDetail` décrit le fichier même quand il
  n'est pas `complete`, en disant explicitement que « the lawyer can still see WHAT failed » — mais
  `ItemRow` n'affiche le fichier que dans l'état `received`, donc la ligne reste muette. L'intention
  du backend n'est pas réalisée à l'écran. C'est une issue à part, et elle demande d'exposer
  `status` dans `ReceivedFileView`.
- **Pas de téléchargement groupé** de toutes les pièces : ce serait une route et un format d'archive
  côté serveur, pas un bouton.
