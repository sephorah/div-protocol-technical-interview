# install.sh — point d'entrée d'installation sur machine vierge

_2026-08-06_

## Besoin

`install.sh` existait en tant que fichier vide, désigné comme point d'entrée du projet.
Exigence exprimée : **« Je dois pouvoir lancer `./install.sh` sur une machine vierge et
avoir l'app qui tourne. »**

« Machine vierge » a été pris au sens fort : ni Node, ni npm, ni pnpm, ni nvm. Une première
version se contentait de vérifier la présence de Node et d'échouer sinon — insuffisant, elle
a été reprise pour installer elle-même sa toolchain.

## Décisions et justifications

**Bootstrap via nvm plutôt que le gestionnaire de paquets système.** `apt`/`dnf` demandent
les droits root et livrent des versions de Node arbitraires selon la distribution. nvm
s'installe dans `$HOME`, sans root, et permet d'épingler exactement Node 22 — version
imposée par pnpm 11, qui exige Node >= 22.13.

**Tag nvm épinglé (`v0.40.6`).** Un `curl | bash` sur une branche mouvante n'est pas
reproductible : le script installé pourrait changer entre deux exécutions.

**`PROFILE=/dev/null` sur l'installeur nvm.** Il n'écrit pas dans le `.bashrc` de
l'utilisateur ; le script charge nvm lui-même. Modifier le profil shell de quelqu'un sans
le lui demander est intrusif — et c'est exactement le genre de pollution qui a cassé nvm sur
la machine de développement (un `export PREFIX` hérité d'un toolchain croisé).

**`unset PREFIX NPM_CONFIG_PREFIX` + `set +u` autour du `source nvm.sh`.** `nvm.sh` lit des
variables non définies, incompatible avec `set -u` ; et `PREFIX` fait échouer `nvm use`.
Les deux problèmes ont été rencontrés pour de vrai avant d'être traités ici.

**`corepack enable --install-directory "$(dirname "$(command -v node)")"`.** Force le shim
pnpm à côté du node courant. Sans cela, un shim corepack système prioritaire dans le `PATH`
masque la version activée — cause de l'erreur `ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING`
rencontrée plus tôt dans le projet.

**corepack plutôt que `npm i -g pnpm`.** corepack respecte le champ `packageManager` des
manifestes ; l'installation globale livrerait une version non épinglée.

**`hash -r` après chaque installation.** bash met en cache le chemin des binaires : sans
cela, l'ancien `node` reste résolu dans le même shell.

**`exec pnpm run start` en fin de script.** Le `exec` remplace le processus : Ctrl+C arrête
les serveurs, et non seulement le script parent.

**Fallback `curl` → `wget` → erreur explicite.** Installer `curl` lui-même exigerait
`apt`/`dnf` et les droits root : hors périmètre d'un script projet, d'où un message
actionnable plutôt qu'une tentative.

**Drapeau `--build`.** Arrête après le build, pour la CI ou avant un `docker compose`.

## Correction annexe : collision de ports

Découverte au test : `pnpm start` ne pouvait pas fonctionner. Le backend (`node dist/main`,
port 3000) et le frontend (`serve -s dist -l 3000`) écoutaient le **même port**. Sans effet
sous Docker — chaque conteneur a son propre namespace réseau — mais collision garantie en
local, où les deux tournent sur le même hôte.

Le script `start` du frontend est passé à `:4000`. Choix du numéro : ni 5173 (vite dev), ni
4173 (vite preview, effectivement occupé par un processus résiduel pendant le test), ni 3000
(API). Le `Dockerfile` et `nginx.conf` conservent `:3000` — ils ne dépendent pas de ce
script.

## Étapes suivies

1. Écriture de `install.sh` : vérification Node → installation nvm + Node 22 si besoin →
   activation pnpm 11.20.0 via corepack → `pnpm run install:all` → `pnpm run build` →
   `exec pnpm run start`.
2. `chmod +x install.sh`.
3. Correction du port du script `start` de `frontend/package.json` (3000 → 4000).
4. Mise à jour de `CLAUDE.md` : entrée `install.sh` dans le layout, section Commands, et note
   sur la divergence de ports assumée entre le mode local et le mode Docker.

## Vérification

Conteneur **Debian 12**, utilisateur non-root, dépôt copié sans `node_modules` ni `dist` :

| Scénario | Résultat |
|---|---|
| Sans `curl` ni `wget` | échec propre : `curl ou wget est requis…` |
| Avec `curl`, `./install.sh --build` | nvm → Node v22.23.2 → pnpm 11.20.0 → install → build, exit 0 |
| Avec `curl`, run complet | `/` 200, `/depot/abc` 200 (fallback SPA), API `Hello World!` 200 |

Les ports étaient publiés vers l'hôte : les réponses proviennent bien du conteneur.

## Limites connues

- Prérequis restants sur l'hôte : **bash, et curl ou wget**.
- Le script n'installe pas Docker et ne lance pas la stack `docker compose` : c'est le chemin
  pnpm. Il n'y a donc **pas de reverse proxy** dans ce mode — front et API sont sur deux
  ports distincts, et les appels relatifs `/api/...` ne résolvent pas. Mode démo/développement,
  pas déploiement.
- Un Node installé par le script vaut pour cette exécution et pour les **nouveaux** terminaux,
  pas rétroactivement pour le shell courant (conséquence assumée de `PROFILE=/dev/null`).

## Code review

Relecture après coup. La vérification en conteneur ne couvrait qu'**un seul chemin** : Node
absent, donc installé par nvm dans `$HOME`. Les défauts ci-dessous sont tous sur les chemins
non couverts.

### 1. `corepack enable` échoue si Node est déjà installé au niveau système — bloquant

`install.sh:76` cible `--install-directory "$(dirname "$(command -v node)")"`. Si l'hôte a
déjà un Node 22 système (`/usr/bin/node` — le cas sur Debian trixie, Ubuntu 24.10+), `node_ok`
passe, puis corepack tente d'écrire dans `/usr/bin` sans droits root. Reproduit :

```
Internal Error: EACCES: permission denied, symlink '…/corepack/dist/pnpm.js' -> '/usr/bin/pnpm'
```

Le script meurt avant l'installation des dépendances. Ironie : la machine *vraiment* vierge
fonctionne, celle qui a déjà Node échoue. Correctif : ne pas viser le dossier de node quand
il n'est pas accessible en écriture — se rabattre sur un dossier utilisateur ajouté au `PATH`
pour la durée du script.

### 2. Le contrôle de version ne teste que la majeure — silencieux

`install.sh:23` compare `process.versions.node.split(".")[0]` à `22`. Or pnpm 11 exige
**>= 22.13**. Un hôte en Node 22.0–22.12 passe le contrôle, puis pnpm échoue plus loin avec
un message qui ne désigne pas la cause. Correctif : comparer la version complète.

### 3. Un argument inconnu est ignoré, après un build complet — mineur

`install.sh:88` ne teste `--build` qu'*après* `install:all` et `build`. Une faute de frappe
(`--biuld`) fait attendre tout le build puis démarre les serveurs, au lieu de s'arrêter.
Correctif : valider les arguments en tête de script.

### Points relus et jugés corrects

`set -euo pipefail` avec les contournements ciblés de `set -u` autour de `nvm.sh` ; les
`hash -r` après chaque installation ; `exec` en fin de script ; le fallback `curl` → `wget` →
message actionnable ; le `die` si `nvm.sh` reste introuvable après installation.

`curl | bash` reste une exécution de code distant, mais sur un tag épinglé — risque accepté,
noté ici plutôt que corrigé (une vérification de somme de contrôle demanderait de maintenir
le hash à la main à chaque bump de nvm).

## Correctifs appliqués

**1.** Le dossier du shim n'est plus imposé : `shim_dir` vaut le dossier de `node` s'il est
inscriptible, sinon `~/.local/bin` (créé, et mis en tête du `PATH` pour la durée du script),
avec un message expliquant à l'utilisateur comment le retrouver ensuite.

**2.** `NODE_MIN=22.13.0` remplace la comparaison sur la majeure. `node_ok()` compare les
trois composantes en JS. Le message du `step` affiche désormais le vrai minimum.

**3.** Les arguments sont validés en tête via un `case` : `--build` pose `BUILD_ONLY=1`,
`-h/--help` affiche `usage()`, tout le reste échoue immédiatement — y compris le cas « plus
d'un argument ». Le test `--build` en fin de script lit maintenant `BUILD_ONLY`.

### Vérification des correctifs

| Test | Résultat |
|---|---|
| `bash -n install.sh` | OK |
| `--help` | usage, exit 0 |
| `--biuld` | erreur immédiate (avant tout build), exit 1 |
| `--build extra` | erreur « un seul argument », exit 1 |
| Comparaison de version, min 22.13.0 vs Node 20.19.6 | KO (attendu) |
| Idem, min 20.19.6 / 20.19.7 | OK / KO — égalité et niveau patch discriminés |
| **`node:22-bookworm`, utilisateur non-root** (Node système dans `/usr/local/bin`, non inscriptible) | repli sur `/home/node/.local/bin`, pnpm 11.20.0 actif, build exit 0 — le scénario qui échouait en EACCES |
| **Debian 12 vierge + curl, non-root** (non-régression) | nvm → Node v22.23.2 → pnpm 11.20.0 → build exit 0 |
