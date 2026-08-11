# Lint type-aware sur le frontend

_2026-08-06_

## Besoin

Constat en relisant l'outillage : `oxlint` n'était pas un choix, il est arrivé avec le
template Vite 8 `react-ts` (`.oxlintrc.json` est la config par défaut du template au mot
près, et `frontend/README.md` est le README stock). Le backend, échafaudé depuis le template
NestJS, a gardé eslint.

Asymétrie qui en découlait : le backend avait les règles **type-aware** (c'est pour ça que
`no-floating-promises` remonte sur `main.ts:8`), le frontend non. Le template Vite recommande
lui-même de les activer « pour une application de production ».

Enjeu concret pour ce projet : un portail de dépôt est asynchrone de bout en bout — upload,
écriture, base. Un `await` oublié renvoie « fichier reçu » avant que le fichier soit écrit.
Ça passe en test avec un fichier de 2 ko, ça perd des pièces en production. Aucun lint
purement syntaxique ne peut voir ça : il faut les types.

## Décisions et justifications

**Activer le type-aware plutôt qu'unifier sur eslint.** Unifier aurait voulu dire réécrire
une config qui fonctionne et perdre la vitesse d'oxlint, sans rien gagner sur la qualité du
code. L'activation coûte une dépendance et trois lignes de config, et c'est la seule des deux
options qui change ce que le linter est capable de détecter.

**`oxlint-tsgolint` en devDependency.** C'est le moteur qui fournit l'information de type à
oxlint. Sans lui, `options.typeAware` ne produit rien.

**Activation par la config, pas par le drapeau `--type-aware`.** Le drapeau CLI existe, mais
le mettre dans le script `lint` de `package.json` le rendrait invisible aux éditeurs et aux
intégrations qui lisent `.oxlintrc.json` seulement. La config est la source de vérité.

## Étapes suivies

1. `pnpm add -D oxlint-tsgolint` dans `frontend/` (7.0.2001).
2. Ajout de `"options": { "typeAware": true }` dans `frontend/.oxlintrc.json`.
3. Note dans `CLAUDE.md` : la règle silencieuse en cas de retrait (voir Limites).

## Vérification

Un run propre ne prouve rien — il peut vouloir dire « aucune violation » comme « les règles
ne tournent pas ». D'où un **fichier cobaye** avec une promesse jetée, et un **témoin** :

| Commande, même fichier cobaye | Résultat |
|---|---|
| `oxlint --config <sans typeAware>` | rien |
| `oxlint` (config du projet) | `typescript(no-floating-promises)` levé |

Seule la config diffère : c'est bien elle qui active les règles. Cobaye supprimé après coup.

Sur le code réel du projet, `pnpm lint` remonte les **2 warnings préexistants** et rien de
plus — `react(only-export-components)` sur `color-mode.tsx:26` et `:39`, du code généré par
Chakra. Aucune violation type-aware : c'est un vrai résultat, pas une absence de contrôle.

Coût mesuré sur le projet entier : **1,17 s → 1,78 s**. Négligeable à cette taille.

## Code review

**1. `pnpm lint` sort en 0 malgré les warnings — à trancher avant la CI.** Vérifié : exit
code 0 avec 2 warnings. Tant que le lint est lancé à la main, ça se voit ; branché dans une
CI, ça passera au vert en laissant filer les warnings. Deux issues possibles selon
l'intention : `--deny-warnings` dans le script, ou passer les règles qui comptent en `error`
et assumer que le reste soit informatif. Pas décidé ici — ça dépend d'une CI qui n'existe pas
encore.

**2. Le couplage `oxlint` / `oxlint-tsgolint` n'est pas verrouillé.** Les deux sont en `^`, et
tsgolint suit un versionnage propre (7.0.2001) sans rapport avec celui d'oxlint (1.77). Rien
ne garantit qu'un `pnpm update` garde une paire compatible. Le lockfile protège tant qu'on ne
met pas à jour ; le jour où on le fait, il faut relancer le test du cobaye.

**3. Régression silencieuse.** C'est le vrai risque de ce changement : retirer la dépendance
ou l'option ne produit **aucune erreur**, juste moins de findings. Un lint vert ne distingue
pas « code propre » de « règles éteintes ». Documenté dans `CLAUDE.md`.

## Correctifs des findings

**1. Lint rendu bloquant.** Script `lint` du frontend → `oxlint --deny-warnings`. Les deux
warnings préexistants sur `color-mode.tsx` sont neutralisés par des commentaires
`oxlint-disable-next-line` **ciblés ligne à ligne**, avec la justification dans le fichier :
c'est un snippet généré par Chakra, le découper en deux fichiers ferait diverger du snippet
amont à chaque régénération, et la règle ne concerne que le Fast Refresh en dev. Un
`ignorePatterns` sur tout le fichier aurait aussi masqué de vrais problèmes futurs.

**2. Versions épinglées à l'exact.** `oxlint` 1.77.0 et `oxlint-tsgolint` 7.0.2001, sans `^`.
Les deux versionnages n'ont aucun rapport, donc rien ne garantissait qu'une plage `^` reste
sur une paire compatible.

**3. Garde-fou contre la régression silencieuse.** `scripts/verify-type-aware.sh` écrit un
cobaye avec une promesse jetée, vérifie que `no-floating-promises` remonte, et le supprime
(`trap`). Il est chaîné **avant** oxlint dans le script `lint` : le lint ne peut pas passer
sans avoir d'abord prouvé que ses règles sont vivantes.

### Deux pièges rencontrés en écrivant le garde-fou

Le cobaye ne peut pas être un fichier caché (`.type-aware-canary.ts`) : oxlint ignore les
fichiers commençant par un point. Et il ne peut pas être dans `.gitignore` — oxlint respecte
`.gitignore` et refuse alors de le lire. Le drapeau `--no-ignore` ne résout pas ce cas : il ne
couvre que `.eslintignore`, `--ignore-path` et `--ignore-pattern`. C'est donc le `trap` seul
qui garantit le nettoyage, et c'est écrit dans le script pour que personne ne « corrige »
l'absence d'entrée dans `.gitignore`.

### Vérification des correctifs

| Test | Résultat |
|---|---|
| `pnpm lint` nominal (frontend) | exit 0, aucun warning, cobaye nettoyé |
| `options.typeAware` retiré de la config | garde-fou en échec, exit 1 |
| Commentaires `oxlint-disable` retirés | les 2 warnings remontent, exit 1 — `--deny-warnings` bloque bien |
| Retour à l'état nominal | exit 0 |
| `pnpm lint` racine (backend + frontend) | exit 0 |
| `pnpm build` complet | exit 0 |
| `pnpm test` backend | 1/1 |

## Limites connues

- Les deux linters restent en place (eslint côté backend, oxlint côté frontend). Assumé :
  chacun est idiomatique à son template, et ils sont maintenant au même niveau de capacité.
- Le garde-fou ne couvre qu'**une** règle type-aware. Il détecte l'extinction globale du
  type-aware, pas la désactivation d'une règle particulière — ce qui est bien l'objet du risque
  visé (retrait de l'option ou de la dépendance).
