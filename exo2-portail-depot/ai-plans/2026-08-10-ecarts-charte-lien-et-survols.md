# Trois écarts de charte relevés en test manuel : lien généré, survols, bouton de dépôt

**Date :** 10/08/2026 — **Issue :** E1 (thème DIV) — **Branche :** `fix/charte-lien-genere-et-survols`

## D'où vient la tâche

Pas d'une issue du backlog, d'un **test manuel de l'application**. Trois endroits ne rendaient pas ce
que dessine `ai-plans/assets/uikit.png` :

1. le bloc « lien généré » était **deux objets** — un champ bordé au texte noir, puis un bouton à
   contour gris posé à côté — là où le kit dessine **une seule boîte** portant l'URL violette et
   l'action « Copier » à l'intérieur ;
2. le survol d'un bouton secondaire ne changeait **que le fond** ; le texte et la bordure restaient
   gris ;
3. le bouton « Déposer un fichier » de l'écran client était secondaire, alors que le kit dessine
   « Deposer » en primaire.

## Ce qui a décidé les valeurs

**Les couleurs ont été mesurées sur les captures de référence, pas estimées à l'œil**
(`magick "image.png" -crop 1x18+160+0 txt:`). C'est ce qui a évité d'inventer une nuance :

| Élément | Mesuré | Jeton existant |
|---|---|---|
| Fond de la boîte du lien | `#F7F6FF` | `bg.subtle` |
| Bordure de la boîte | 1 px `#E9E9E9` | `border` |
| URL et « Copier » | `#5100FF` | `brand.fg` |
| Anneau au survol d'un secondaire | `#DDD0FF` | `border.accent` (`#DBCDFF`) |

Aucune couleur nouvelle n'a été ajoutée : les quatre existaient déjà dans `tokens.ts` et
`semantic-tokens.ts`. Le travail était de les câbler.

## Décisions

- **L'étiquette « Lien a envoyer au client » est conservée**, alors que le kit n'en montre pas.
  Le kit dessine le lien isolé ; l'écran réel affiche deux secrets côte à côte, le lien et le code
  PIN. Sans étiquette, les deux blocs se ressemblent trop.
- **« Déposer » n'est primaire que sur les pièces en attente.** « Remplacer le fichier » reste
  secondaire. Tout passer en violet plein rendrait une liste de vingt pièces illisible : plus rien
  n'y ressortirait, ce qui est l'inverse de ce que le primaire sert à dire.
- **Le champ du lien reste un `<input readOnly>`, il n'est pas remplacé par un texte.** Quand le
  presse-papier refuse, `CopyField` sélectionne son contenu, ce qui transforme « recopiez à la
  main » en un seul Ctrl+C — sur une valeur affichée exactement une fois. C'est donc la boîte
  autour qui porte la bordure, le fond et le rayon, et le champ qui devient transparent.
- **Deux variantes de thème plutôt que des styles dans la page** (`input: bare`, `button: link`),
  parce que la règle du projet est qu'un composant manquant se crée dans le thème.
- **Aucun test unitaire de thème ajouté.** `docs/tests-manuels.md` acte que les 35 cas du dossier
  `theme/` ont été retirés parce qu'ils relisaient des jetons sans rien prouver — jsdom ne calcule
  aucun style. En rajouter un ici referait l'erreur documentée. Quatre cases ont été ajoutées à la
  liste manuelle à la place.

## Un piège trouvé en écrivant

**`size` est déclaré après `variant` dans la recette de bouton, donc il l'emporte.** Les 13 px et la
marge nulle de la variante `link`, écrits dans la variante, étaient écrasés par `md` (16 px, marge
24×14) **en silence**. D'où la taille `inline`, qui n'existe que pour ça. C'est le même piège que
celui déjà consigné pour le titre de carte en E1, dans l'autre sens : là c'était une variante de
Chakra, ici c'est la nôtre.

## Ce que la relecture du diff a corrigé

- **Commentaires en français** dans `button.ts` et `field.ts`, alors que tout le code du dépôt est
  en anglais. Réécrits.
- **Double anneau de focus.** `_focusWithin` sur la boîte se déclenche aussi quand c'est le bouton
  « Copier » *à l'intérieur* qui prend le focus : la boîte dessinait son anneau violet et le bouton
  le sien par-dessus. Restreint au champ (`&:has(input:focus-visible)`), et les deux états vérifiés
  au navigateur — champ au clavier : la boîte s'allume ; bouton au clavier : la boîte reste éteinte,
  seul le bouton porte son anneau.

## Vérification

`pnpm -C frontend lint` (typegen + canari type-aware + oxlint), `npx tsc -b` et
`pnpm -C frontend test` : **19 fichiers, 124 tests, tout vert**, sans qu'un seul test ait eu besoin
d'être modifié — ils ciblent des rôles et des noms accessibles, que la restructuration conserve.

**La vérification qui compte est au navigateur**, jsdom ne calculant aucun style. Parcours joué dans
un Chrome isolé (profil temporaire, la session ouverte de l'utilisateur n'a pas été touchée) :
connexion, création d'une demande, écran du lien émis, tableau de bord, puis écran client avec
**dépôt réel d'un PDF**. Styles lus par `getComputedStyle`, pas jugés à l'œil :

| Vérifié | Mesuré |
|---|---|
| Boîte du lien | fond `rgb(247,246,255)`, bordure `1px solid rgb(233,233,233)`, rayon `8px` |
| URL | `rgb(81,0,255)`, JetBrains Mono 13 px |
| « Copier » dans la boîte | `rgb(81,0,255)`, 13 px 600, sans fond ni anneau |
| Survol secondaire | texte `rgb(81,0,255)`, fond `rgb(247,246,255)`, anneau `rgb(219,205,255)` |
| Gabarit au survol | 131×36 avant **et** après — le libellé ne bouge pas |
| Secondaire désactivé, survolé | inchangé, `opacity` 0,5 |
| « Deposer un fichier » | fond `rgb(81,0,255)`, texte blanc |
| « Remplacer le fichier » après dépôt | `rgb(88,88,88)` sur blanc, anneau gris |

## Ce qui n'a pas pu être vérifié comme prévu, et pourquoi

**La pagination désactivée n'existait pas à l'écran** : le compte de démonstration n'a qu'une page de
demandes. Plutôt que de fabriquer une dizaine de demandes dans la base de développement, l'état a été
obtenu en posant `disabled` sur un autre bouton secondaire dans le DOM. La condition `_disabled` de
Chakra cible `:disabled`, donc c'est **la même règle CSS** que celle que rend React sur
« Précédent » — mais ce n'est pas le composant réel, et la case de `docs/tests-manuels.md` reste
donc à rejouer sur un jeu de données à deux pages.

## Relevé au passage, hors périmètre

`CLAUDE.md` écrit la route client `/depot` ; la valeur réelle est **`/deposit`**
(`backend/src/requests/public-url.ts`). `infra/nginx/log-redact.conf` est bien aligné sur `/deposit`,
donc le masquage du jeton dans les journaux fonctionne — c'est **la prose de `CLAUDE.md` qui a
dérivé**, pas le code. À corriger là-bas, pas ici.
