# B5 — Écrans avocat (liste, création, détail)

> **Pour l'exécutant :** SOUS-SKILL REQUISE — `superpowers:executing-plans`, tâche par tâche.
> Les étapes sont des cases à cocher (`- [ ]`).

**But :** livrer les trois écrans authentifiés du portail — liste des demandes, création d'une
demande avec remise du lien et du PIN, détail d'une demande — sur le thème DIV livré par E1 et
branchés sur les routes réelles de B2/B3/B4.

**Architecture :** le SPA reste un client HTTP mince. Une couche `src/api/requests.ts` typée qui
double à la main les vues du backend, un hook `useResource` de ~40 lignes pour l'état
chargement/erreur/données, des composants de présentation qui ne lisent que les tokens du thème.
Aucun état global : chaque écran possède ses données.

**Stack :** React 19, react-router 7, Chakra UI v3 (thème `src/theme/`), Vitest 4 + Testing Library
+ jsdom. **Aucune dépendance nouvelle.**

---

## Changements depuis la première version du plan

### 1. Les trois états d'écran deviennent une obligation, pas une intention

Nouvelle section « Les trois états que chaque écran doit savoir rendre », avec un tableau
chargement / vide / erreur pour chacun des trois écrans. Quatre règles s'y ajoutent : les fantômes de
chargement ont la **hauteur du contenu réel** (un spinner de 24 px remplacé par une carte de 140 px
fait sauter la page) ; **vide et erreur ne se confondent jamais** — « Aucune demande en cours » sur un
`GET` en échec affirme faussement que l'avocat n'a pas de dossier ; toute erreur porte un bouton
`Reessayer` qui appelle `reload()` et non un rechargement de page ; chaque état est annoncé aux
lecteurs d'écran (`role="status"` / `role="alert"`).

Un composant nouveau les porte : `src/components/screen-state.tsx` — `LoadingSkeleton`, `EmptyState`,
`ErrorPanel` dans un seul fichier, parce qu'ils sont mutuellement exclusifs et se lisent ensemble.
Aucune animation de pulsation sur les fantômes : elle attire l'œil sur ce qui n'est pas encore là.

### 2. La progression d'upload et son échec sont traités, et situés

Nouvelle section. Elle établit d'abord que **la barre à 62 % du kit est côté CLIENT** (C2 pour la
route d'upload, C3 pour l'écran de suivi) : l'avocat ne téléverse rien, il constate, et une barre de
progression sur son écran n'aurait rien à mesurer.

Ce que B5 fait à la place : un composant `src/components/item-row.tsx` qui porte **quatre** états —
`pending`, `uploading`, `received`, `failed` — alors que la page n'en calcule aujourd'hui que deux.
Les quatre sont testés dès maintenant. La raison est mesurable : `GET /requests/:id` n'expose pas
`UploadedFile.status` (`ReceivedFileView` porte nom, type, taille et date, rien d'autre) et
`received` vaut « un fichier est attaché » quel que soit son statut. Trancher ici le sens de « reçue »
face à un `failed` serait le trancher à l'aveugle, rien ne pouvant encore en écrire un. Le jour de C2,
l'écran avocat change **une ligne** : le calcul de l'état.

Trois règles de comportement en découlent : un dépôt échoué n'est jamais silencieux (pastille
`Depot echoue`, et un texte qui dit **quoi faire**) ; un échec ne cache pas le nom du fichier, qui est
ce qui permet de dire au client lequel recommencer ; et la progression est **indicative** — une barre
à 100 % ne veut pas dire « enregistré », le contrôle des *magic bytes* de C2 pouvant encore refuser le
fichier après. D'où « envoi en cours » puis « verification », jamais « termine » avant la réponse du
serveur.

### 3. La densité est chiffrée et devient vérifiable

Nouvelle section « Densité constante, et le mobile ». Elle fixe une **échelle d'espacement fermée**
(`4 / 8 / 12 / 16 / 24 / 32 px`) valable à toutes les tailles, **deux points de rupture et pas trois**
(`base` / `md` = 768 px), des tailles de texte fixes, et une seule colonne jusqu'à `maxW="1040px"`
— une grille à deux colonnes sur grand écran doublerait la densité du desktop, ce que le critère
interdit.

Deux principes s'y ajoutent : **les paddings ne rétrécissent pas au mobile** (seule la gouttière de
page varie, 24 px → 16 px), et **aucune information n'est retirée** — ce qui change est la
*direction* d'un empilement. C'est ce qui impose des cartes plutôt qu'un tableau sur la liste : un
tableau à cinq colonnes n'a pas de version mobile honnête, il en cache.

Une exception est assumée et à signaler au README : le bouton primaire passe en pleine largeur sous
768 px, contre la règle d'E1 qui veut qu'il épouse son libellé — une cible tactile de 153 px sur un
écran de 375 px est inconfortable.

### 4. La vérification navigateur passe de onze à douze relevés

Deux relevés nouveaux en tâche 8. **Les trois états provoqués un par un** : backend arrêté →
encart d'erreur et surtout *pas* d'état vide ; demande seedée supprimée → état vide ; réponse
ralentie → fantômes, et relevé de la position du premier titre avant/après pour prouver que la page
ne saute pas. Et **la densité mesurée à 375 px et à 1440 px** : padding de carte, gouttière, écart
entre cartes, taille de police du corps — identiques partout sauf la gouttière et la largeur du
bouton.

### 5. Le kit est situé, et les deux actions sur le lien sont justifiées par écrit

Nouvelle sous-section « Le kit fixe le style, pas la liste des fonctions ». `uikit.png` est une
planche de composants (« BOUTONS », « CARTES », « ETAT VIDE ») : s'y limiter supprimerait aussi la
pagination, l'écran de détail et l'écran de connexion d'E1. Le fil conducteur reste le parcours de
l'énoncé, que les trois écrans couvrent de bout en bout.

**Régénérer et révoquer sont conservés**, et leur justification devient un livrable du README, parce
que l'énoncé dit regarder comment on justifie son découpage. Régénérer *répare un état sans issue* —
un onglet fermé avant la copie laisse une demande valide dont personne ne connaît le PIN — et
remplace le « Copier le lien » que le kit dessine mais qui est **impossible**, le jeton n'existant en
clair qu'à l'émission. Révoquer est un ajout franc : un lien parti par courriel échappe à tout
contrôle, et il rend actionnable la pastille `Lien revoque` que B4 impose d'afficher.

### 6. Contraintes globales et structure de fichiers

Trois contraintes ajoutées à la liste qui s'applique à toutes les tâches : l'échelle d'espacement
fermée, les deux points de rupture, et « aucun écran blanc ». Deux fichiers ajoutés au tableau de
structure (`screen-state.tsx`, `item-row.tsx`), la tâche 4 passant de treize à seize étapes. La
tâche 8 gagne une obligation : noter dans **C2** que l'écran avocat sait déjà afficher `uploading` et
`failed`, et dans **D5** ce que la campagne navigateur a coûté en temps.

### 7. La couverture du kit devient explicite, et un panneau change de mot

Section nouvelle « Couverture du kit : neuf panneaux, deux côtés », avec le tableau de qui vit où.
Elle établit que la légende du kit (« Voici les composants du portail […] c'est le rendu qu'on
attend ») déclare attendu **le rendu**, tandis que « les composants **du portail** » impose une
**couverture** à vérifier en H1 — un plancher, pas un plafond. Preuve : trois panneaux et demi sur
neuf sont côté client anonyme (C1, C2, C3), que B5 ne touche pas.

Deux effets concrets. La **pastille de comptage** (`badgeRecipe` variante `neutral`) n'avait **aucun
consommateur** depuis E1 ; elle est branchée sur l'en-tête du détail (`[ 4 pieces ]`), sans quoi le
kit reste couvert à huit panneaux sur neuf et E1 a livré une variante morte. Et les **cases du PIN**
sont notées comme changeant de rôle entre les deux côtés — dessinées en *saisie* par le kit (c'est
C1), réutilisées en *affichage* par B5 ; `pinDigit` devient la base commune plutôt qu'un doublon.

L'action **« Copier le lien »** de la carte garde sa position, son alignement et sa couleur, et perd
son mot : **« Gerer le lien »**, un `Link` vers `/requests/:id`. Le libellé était le vrai risque, avec
un scénario d'échec précis désormais écrit dans le plan — l'avocat qui veut recoller un lien déjà
envoyé cliquerait « Copier », arriverait sur un écran dont la seule action rendant un lien est
« Régénérer », et **casserait le lien que son client utilise**. Redirection plutôt que modale : le
détail porte déjà l'état et la confirmation, une modale dupliquerait une action dangereuse.

### 8. La sécurité est classée et chiffrée

Sous-section nouvelle « Ce qui protège réellement un dépôt, par ordre de poids » : jeton de 256 bits,
expiration, révocation, hachage au repos, puis le PIN. Avec le chiffre qui manquait — **10 000
candidats à 67 ms ≈ 11 minutes** pour casser un PIN hors ligne, donc le hachage argon2id du PIN est
de la défense en profondeur et **non un rempart** ; ce qui rend un vol de base inexploitable est le
hachage du **jeton**.

Deux formulations y sont fixées pour le README : l'affichage unique **n'est pas une protection** mais
la conséquence du hachage, et régénérer en est la réparation — le gain tient en *jeton haché* et
*révocation*, le reste est le prix ergonomique. Et le PIN **ne protège pas contre qui lit le
courriel**, puisque lien et code partiront vraisemblablement dans le même message. D'où deux boutons
« Copier » séparés et **aucun `mailto:` prérempli**.

### Ce qui n'a pas bougé

- **Les quatre décisions validées** : hook maison `useResource` plutôt que TanStack Query, route
  dédiée `/requests/new` plutôt qu'une modale, régénération et révocation sur le détail, vérification
  navigateur manuelle avec D5 laissée ouverte.
- **Les trois écrans et leurs maquettes** : liste, création en deux temps, détail — inchangés.
- **Le découpage en huit tâches**, leur ordre et leurs commits.
- **Les tâches 1, 2, 3, 5 et 6** — thème, couche API et formatage, `useResource`, écran liste, écran
  de création — dans leur intégralité, code et tests compris.
- **Aucune dépendance npm nouvelle**, et **aucun changement backend**.
- **La section sécurité** et ses risques résiduels (pas de CSP, presse-papiers lisible par la page,
  jeton dans le chemin).

---

## Contexte — pourquoi cette issue

Le backend de l'espace avocat est complet depuis B4 : créer une demande (`POST /requests`), la lister
(`GET /requests`), la détailler (`GET /requests/:id`), régénérer ou révoquer son lien
(`POST` / `DELETE /requests/:id/link`). **Rien ne les appelle.** Le seul écran authentifié est
`dashboard-placeholder.tsx`, qui affiche l'adresse e-mail de l'avocat et un bouton de déconnexion.

E1 a livré le thème et l'écran de connexion, et a laissé deux points explicitement reportés ici :
le **reveal au défilement** (l'écran de connexion tient dans une hauteur de fenêtre, il n'y avait
rien à révéler) et l'**échappement de `originalName`** à l'affichage.

Résultat attendu : un évaluateur qui lance `./install.sh`, se connecte avec le compte de démo, voit
sa demande, en crée une seconde, copie le lien et le PIN, et ouvre le détail — sans jamais toucher à
`curl`.

---

## Une contrainte à connaître avant de lire la maquette

Le kit (`uikit.png`) dessine sur la carte de demande une action **« Copier le lien »**. **Elle ne
peut pas exister telle quelle**, et ce n'est pas un oubli de B4 :

- le jeton est stocké en **SHA-256** (A2), le PIN en **argon2id** ;
- ils n'existent en clair qu'à **deux instants** : la réponse de `POST /requests` et celle de
  `POST /requests/:id/link` (`IssuedLink`, `backend/src/requests/request.types.ts`) ;
- `GET /requests` et `GET /requests/:id` renvoient un `LinkView` qui ne porte que `state` et
  `expiresAt` — **jamais d'URL**.

Donc : on copie le lien **au moment où il est émis**, création ou régénération. Ailleurs, l'action
qui rend le lien à l'avocat s'appelle **« Régénérer le lien »**, et elle révoque le précédent. C'est
exactement ce que B3 a consigné : « un PIN perdu ne se réaffiche pas, il se remplace ».

À écrire dans le README (§ limites connues) et dans `issue_backlog.md` en clôturant B5.

### Le kit fixe le style, pas la liste des fonctions

`uikit.png` est une **planche de composants** — ses cartes s'appellent « BOUTONS », « CARTES »,
« CHAMP DE SAISIE », « STATUTS DE DEMANDE », « ETAT VIDE ». Elle fixe couleurs, radius, inversion au
survol et tonalités de pastille. Elle ne décrit **aucun écran complet** : s'y limiter supprimerait
aussi la pagination, l'écran de détail et l'écran de connexion d'E1.

Le fil conducteur reste donc le **parcours de l'énoncé** : l'avocat crée une demande, génère un lien
expirable protégé par un PIN, l'envoie, et suit le statut de chaque demande sur un tableau de bord.
Les écrans de B5 le couvrent de bout en bout.

Deux actions dépassent ce que le kit dessine, et l'énoncé encadre justement sa liste de routes par
« à titre indicatif […] le découpage exact est ton choix, **on regardera comment tu le justifies** ».
Leur justification est donc un livrable, à écrire dans le README :

- **Régénérer** *répare un état sans issue*. Le PIN n'apparaît qu'une fois ; un onglet fermé avant la
  copie laisse une demande valide dont **personne ne connaît le code**. Sans cette action, elle meurt
  à la seconde où elle naît et l'avocat doit tout retaper. C'est aussi ce qui remplace le
  « Copier le lien » impossible ci-dessus.
- **Révoquer** est un ajout franc : rien dans l'énoncé ne demande de couper un accès avant son
  échéance. Ce qui le justifie est le produit lui-même — un lien parti par courriel échappe à tout
  contrôle, et « le lien expire » n'aide pas un avocat dont le client a transféré le message. Il rend
  aussi actionnable la pastille `Lien revoque` que B4 impose d'afficher.

### Couverture du kit : neuf panneaux, deux côtés

La légende du kit dit « Voici **les composants du portail**, rendus dans la charte. C'est **le rendu**
qu'on attend. » Le sujet de la seconde phrase est *le rendu* — c'est la conformité visuelle qui est
déclarée attendue. Mais « les composants **du portail** » crée une obligation réelle d'une autre
nature : **une couverture**, à vérifier à la livraison (H1), et non une borne du périmètre de B5.

Ce qui le prouve : la planche couvre **les deux côtés du portail**. Trois panneaux et demi sur neuf
sont côté client anonyme, que B5 ne touche pas. Une planche mélangeant les deux côtés ne peut pas
être la spécification d'un écran.

| Panneau du kit | Où il vit | Issue | État |
|---|---|---|---|
| BOUTONS | partout | E1 | fait |
| STATUTS DE DEMANDE — les trois pastilles | tableau de bord | **B5** | tâche 5 |
| STATUTS DE DEMANDE — pastille de comptage « 3 pieces » | en-tête du détail | **B5** | tâche 7 |
| CARTE DE DEMANDE | tableau de bord | **B5** | tâche 5 |
| LIEN GENERE | création + régénération | **B5** | tâches 4, 6, 7 |
| ETAT VIDE | tableau de bord | **B5** | tâches 4, 5 |
| CHAMP DE SAISIE — « Intitule du dossier » | création | **B5** | tâche 6 |
| CHAMP DE SAISIE — « Code PIN », 4 cases | **saisie** du PIN, côté client | **C1** | à venir |
| ZONE DE DEPOT | dépôt, côté client | **C2/C3** | à venir |
| FICHIER DEPOSE — barre de progression | suivi, côté client | **C3** | à venir |

Trois conséquences pour cette issue :

- **La pastille de comptage n'a aujourd'hui aucun consommateur.** La variante `neutral` de
  `badgeRecipe` (primary à 6 %) a été livrée par E1 et **aucun écran ne l'utilise** — le tableau de
  bord écrit « 2 pieces sur 4 » en texte, comme la carte du kit. Sa place est l'en-tête du détail
  (« 4 pieces »). Sans ce branchement, E1 a livré une variante morte et le kit est couvert à
  huit panneaux sur neuf.
- **Les cases du PIN changent de rôle entre les deux côtés.** Le kit les dessine en **saisie** — c'est
  C1. B5 les réutilise en **affichage**, dans la carte « LIEN GENERE ». Réutilisation volontaire, à
  noter dans `CLAUDE.md` : C1 devra en faire un vrai champ, et la recette `pinDigit` sert de base
  commune plutôt que d'être dupliquée.
- **Un panneau ne peut pas être honoré tel quel** — voir la section suivante.

### « Copier le lien » : la place est gardée, le mot change

La carte de demande du kit porte en bas à droite une action **« Copier le lien »**. On garde sa
**position**, son alignement et sa couleur ; on change le **libellé**, parce que le mot décrit une
action impossible (le jeton n'existe en clair qu'à l'émission).

**Le libellé est le vrai risque, pas la place.** Scénario d'échec concret : l'avocat a déjà envoyé le
lien à son client, il veut le recoller dans un second courriel, il clique « Copier le lien » — et
arrive sur un écran dont la seule action rendant un lien est **« Régénérer »**, qui **invalide celui
que le client est en train d'utiliser**. Le bouton l'a conduit à casser exactement ce qu'il voulait
copier.

Retenu : **« Gerer le lien »**, qui mène au détail. Pas une modale : le détail porte déjà l'état, la
date d'expiration et la confirmation, et une modale dupliquerait une action dangereuse en deux
endroits — deux chemins à tenir en cohérence pour un écran de plus.

---

## Comment l'UI va se présenter

Trois écrans, une coquille commune, tout au thème DIV : fond blanc, cartes bordées 1 px `#E9E9E9`
sans ombre, radius 12 px, Inter, bouton primaire violet qui **s'inverse au survol**.

### La coquille (`AppShell`)

Une barre haute pleine largeur, hairline en bas, contenu centré à `maxW="1040px"`.

```
┌──────────────────────────────────────────────────────────────────────┐
│  Portail de depot                       avocat@example.com  [Se deconnecter] │
└──────────────────────────────────────────────────────────────────────┘
```

`Se deconnecter` est le bouton `secondary` `sm` (fond blanc, contour intérieur, texte gris),
déjà défini par la recette d'E1. Le titre à gauche est un lien vers `/dashboard`.

### 1. `/dashboard` — la liste

C'est **le premier écran qui défile**, donc celui qui porte le reveal.

```
  Mes demandes                                        [ Creer une demande ]
  3 demandes

  ┌────────────────────────────────────────────────────────────────────┐
  │ Dossier Martin, pieces 2026                  [En attente] [Lien actif] │
  │ Creee le 12 mars 2026 · expire le 26 mars 2026                     │
  │ ──────────────────────────────────────────────────────────────────  │
  │ 2 pieces sur 4                                      Gerer le lien →  │
  └────────────────────────────────────────────────────────────────────┘

  ┌────────────────────────────────────────────────────────────────────┐
  │ Succession Dubois                             [Complete] [Lien revoque] │
  │ Creee le 2 mars 2026 · a expire le 9 mars 2026                     │
  │ ──────────────────────────────────────────────────────────────────  │
  │ 3 pieces sur 3                                      Gerer le lien →  │
  └────────────────────────────────────────────────────────────────────┘

                        [ Precedent ]  Page 1 sur 2  [ Suivant ]
```

**`Gerer le lien` occupe la place du « Copier le lien » du kit sans en porter le mot** — voir
« Copier le lien : la place est gardée, le mot change ». C'est un `Link` react-router vers
`/requests/:id`, et non un bouton : l'avocat doit pouvoir l'ouvrir dans un onglet.

**Deux pastilles, jamais une.** Le statut (`En attente` ambre / `Complete` vert / `Expiree` rouge)
et l'état du lien (`Lien actif` / `Lien revoque`) sont **indépendants** — B4 le dit : une demande
peut être **complète et coupée**. Une colonne unique en perdrait un, et l'avocat ne saurait pas s'il
doit régénérer.

**Reveal au défilement :** chaque carte entre à `opacity 0` et `translateY(12px)`, et passe à
`opacity 1` / `translateY(0)` en 320 ms quand elle croise le bas de la fenêtre. Décalage de 60 ms
par carte pour que la liste se pose de haut en bas. Sous `prefers-reduced-motion: reduce`, ou si le
navigateur n'a pas d'`IntersectionObserver`, **tout est visible d'emblée** — jamais l'inverse.

**État vide** (le kit, « ETAT VIDE ») : carte centrée, `+` dans un rond `#F7F6FF`, « Aucune demande
en cours », sous-titre, et le bouton primaire. Aucun écran blanc sans explication.

**Chargement :** trois cartes fantômes à la bonne hauteur, fond `#F7F6FF` — pas de spinner, la
page ne saute pas quand les données arrivent.

### 2. `/requests/new` — la création, puis la remise du lien

Un seul écran, **deux temps**. Tant que la demande n'est pas créée :

```
  ← Retour au tableau de bord

  ┌──── NOUVELLE DEMANDE ─────────────────────────────────────────────┐
  │                                                                    │
  │  Intitule du dossier                                               │
  │  ┌──────────────────────────────────────────────────────────────┐  │
  │  │ Dossier Martin, pieces 2026                                  │  │
  │  └──────────────────────────────────────────────────────────────┘  │
  │                                                                    │
  │  Pieces attendues                                    2 sur 20      │
  │  ┌────────────────────────────────────────────────┐ ┌───┐          │
  │  │ Piece d'identite                               │ │ × │          │
  │  └────────────────────────────────────────────────┘ └───┘          │
  │  ┌────────────────────────────────────────────────┐ ┌───┐          │
  │  │ Contrat de bail signe                          │ │ × │          │
  │  └────────────────────────────────────────────────┘ └───┘          │
  │  + Ajouter une piece                                               │
  │                                                                    │
  │  Validite du lien                                                  │
  │  ┌──────────┐ jours   (1 a 90) — expire le 26 mars 2026            │
  │  │    14    │                                                      │
  │  └──────────┘                                                      │
  │                                                                    │
  │                            [ Annuler ]   [ Creer la demande ]      │
  └────────────────────────────────────────────────────────────────────┘
```

La date d'expiration se recalcule **sous le champ** à chaque frappe : `expiresInDays` est un entier,
et l'avocat raisonne en dates.

Une fois créée, le formulaire est **remplacé** par la carte « LIEN GENERE » du kit :

```
  ┌──── LIEN GENERE ──────────────────────────────────────────────────┐
  │                                                                    │
  │  Dossier Martin, pieces 2026                        [En attente]   │
  │                                                                    │
  │  Lien a envoyer au client                                          │
  │  ┌──────────────────────────────────────────────┐  ┌──────────┐    │
  │  │ https://…/depot/8f3a2c1b…                    │  │ Copier   │    │
  │  └──────────────────────────────────────────────┘  └──────────┘    │
  │                                                                    │
  │  Code PIN                                                          │
  │  ┌───┐ ┌───┐ ┌───┐ ┌───┐                           ┌──────────┐    │
  │  │ 4 │ │ 8 │ │ 1 │ │ 6 │                           │ Copier   │    │
  │  └───┘ └───┘ └───┘ └───┘                           └──────────┘    │
  │                                                                    │
  │  ⚠ Ce code n'est affiche qu'une fois. Il n'est pas conserve en     │
  │    clair : si vous le perdez, il faudra regenerer le lien, ce qui  │
  │    invalidera celui-ci.                                            │
  │                                                                    │
  │              [ Voir la demande ]   [ Creer une autre demande ]     │
  └────────────────────────────────────────────────────────────────────┘
```

Le lien est en **monospace tronqué** (`text-overflow: ellipsis`) et le champ est en lecture seule,
sélectionnable. Un clic sur `Copier` remplace le libellé par `Copie ✓` pendant 2 s. Si l'API
presse-papiers refuse (contexte non sécurisé), le champ se **sélectionne** et le libellé devient
`Copiez avec Ctrl+C` — jamais un échec silencieux.

L'avertissement est un encart `#FFEDCA` / texte `#DA9705` : c'est le seul endroit du produit où une
information disparaît définitivement.

### 3. `/requests/:id` — le détail

```
  ← Retour au tableau de bord

  Dossier Martin, pieces 2026                    [En attente] [Lien actif]
  Creee le 12 mars 2026                                       [ 4 pieces ]

  ┌──── LIEN PUBLIC ──────────────────────────────────────────────────┐
  │  Expire le 26 mars 2026, protege par un code a 4 chiffres.          │
  │  L'adresse et le code ne sont pas conservees en clair : les         │
  │  regenerer emet un nouveau lien et invalide l'actuel.               │
  │                                                                     │
  │  [ Regenerer le lien ]   [ Revoquer l'acces ]                       │
  └─────────────────────────────────────────────────────────────────────┘

  ┌──── PIECES ATTENDUES ─────────────────────────────────────────────┐
  │  ✓  Contrat de bail signe                                          │
  │     contrat-signe.pdf · PDF · 2,4 Mo · recu le 14 mars 2026        │
  │  ─────────────────────────────────────────────────────────────────  │
  │  ·  Piece d'identite                                    En attente  │
  │  ─────────────────────────────────────────────────────────────────  │
  │  ·  Facture EDF                                         En attente  │
  └─────────────────────────────────────────────────────────────────────┘
```

- **`Regenerer le lien`** demande confirmation (le lien actuel cessera de fonctionner), rouvre le
  champ « validité en jours », puis **affiche la même carte « LIEN GENERE »** que la création — même
  composant, même avertissement.
- **`Revoquer l'acces`** demande confirmation et, en cas de succès, la pastille passe à
  `Lien revoque` ; le bouton disparaît, seul `Regenerer` reste.
- **`originalName` est traité comme une donnée hostile** : React échappe le HTML, mais **pas les
  caractères de contrôle bidirectionnels**. Un fichier nommé `facture‮fdp.exe` s'affiche
  `facturexe.pdf` dans n'importe quel navigateur. On les retire avant affichage, on tronque à 80
  caractères, et le nom n'entre **jamais** dans un attribut `href` ou `download` (B4b tranchera le
  téléchargement).
- La pastille `[ 4 pieces ]` est la variante `neutral` de `badgeRecipe` (primary à 6 %), livrée par
  E1 et **sans aucun consommateur jusqu'ici**. C'est le dernier panneau du kit que B5 peut couvrir ;
  sans ce branchement, E1 a livré une variante morte. La progression chiffrée reste dans la carte de
  liste (« 2 pieces sur 4 »), comme le kit la dessine.
- Le téléchargement d'une pièce **n'est pas ici** : c'est B4b, qui dépend de C2. Aucun bouton mort.

---

## Les trois états que chaque écran doit savoir rendre

**Aucun écran n'a le droit d'être blanc.** C'est la ligne du kit (« ETAT VIDE — ne laisse jamais un
ecran blanc sans explication ») et c'est aussi le seul moyen de distinguer trois situations qu'un
écran vide confond : *ça charge*, *il n'y a rien*, *ça a échoué*. Les trois se ressemblent à l'œil et
appellent trois actions opposées de la part de l'avocat — attendre, créer, réessayer.

| Écran | Chargement | Vide | Erreur |
|---|---|---|---|
| `/dashboard` | 3 cartes fantômes à la hauteur réelle, fond `#F7F6FF`, sans animation de pulsation | Carte centrée : `+`, « Aucune demande en cours », sous-titre, bouton primaire | Encart `role="alert"` fond `#FFD0D0`, message, bouton `Reessayer` |
| `/requests/new` | *(aucun)* — le formulaire ne charge rien | *(aucun)* — une ligne de pièce vide au départ | Encart sous le formulaire, **le formulaire reste rempli** |
| `/requests/:id` | Squelette : titre, deux pastilles, 3 lignes de pièces | *(aucun)* — une demande a toujours au moins une pièce (B2) | 404 → « Demande introuvable » + retour ; autre → encart + `Reessayer` |

Quatre règles qui valent pour les trois écrans :

- **Les fantômes ont la hauteur du contenu réel.** Un spinner de 24 px suivi d'une carte de 140 px
  fait sauter la page ; un fantôme à la bonne hauteur ne bouge rien quand les données arrivent.
- **Vide et erreur ne se confondent jamais.** « Aucune demande en cours » sur un `GET` qui a échoué
  est un **mensonge** : il affirme que l'avocat n'a pas de dossier. Un test le vérifie
  (tâche 5, « distinguishes a failed load from an empty list »).
- **Toute erreur porte une sortie.** `Reessayer` appelle `reload()` — jamais un rechargement de page,
  qui referait `/auth/me` et le tour de renouvellement pour rien.
- **Le message vient de la couche API**, qui distingue déjà `unauthorized` / `notFound` /
  `badRequest` / `server` / `network` (`src/api/client.ts`). Ne pas réécrire ces textes : « Serveur
  injoignable » et « API introuvable » disent deux pannes différentes, et l'écran de connexion les
  sépare déjà.
- **Chaque état est annoncé aux lecteurs d'écran** : `role="status"` sur le chargement,
  `role="alert"` sur l'erreur. Sans quoi la page ne change pas *audiblement* et l'avocat qui n'y voit
  pas reste sur un écran muet.

---

## La progression d'un dépôt, et ce qui se passe quand il échoue

À dire d'emblée, parce que la maquette du kit induit en erreur : **la barre de progression à 62 %
du kit (« FICHIER DEPOSE ») est côté CLIENT, pas côté avocat.** C'est **C2** (la route d'upload) et
**C3** (l'écran de suivi). Ici, on est du côté avocat, et l'avocat ne téléverse rien : il *constate*.
Mettre une barre de progression sur son écran n'aurait rien à mesurer.

Ce que B5 doit faire, c'est **dessiner maintenant les états de la ligne de pièce**, pour que C2 et
C3 s'y branchent sans redessiner. Une ligne de pièce a **quatre** états, et le composant les porte
tous les quatre dès B5 :

```
  ✓  Contrat de bail signe                                        ← reçue
     contrat-signe.pdf · PDF · 2,4 Mo · recu le 14 mars 2026

  ⟳  Piece d'identite                                             ← en cours (C2)
     piece-identite.jpg · envoi en cours
     ▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░  62 %

  ⚠  Facture EDF                                       Depot echoue  ← échec (C2/C4)
     facture.pdf · le fichier n'a pas pu etre enregistre
     Le client doit le deposer a nouveau.

  ·  Attestation d'assurance                              En attente  ← rien reçu
```

**L'état d'échec est le seul des quatre qui compte vraiment pour B5**, et voici pourquoi :

- La colonne `UploadedFile.status` **existe déjà** en base (elle a été créée pour C4, l'antivirus) et
  peut valoir `failed`.
- Mais **`GET /requests/:id` ne l'expose pas** : `ReceivedFileView`
  (`backend/src/requests/request.types.ts`) porte `originalName`, `mimeType`, `sizeBytes`,
  `receivedAt` — pas `status`. Et `received` vaut aujourd'hui « un fichier est attaché », **quel que
  soit son statut**.
- Conséquence, notée telle quelle par B4 et par C2 : le jour où C2 écrira un `failed`, le tableau de
  bord affichera la demande **complète** alors qu'il manque une pièce, et l'avocat attendra un
  document qui n'arrivera jamais.

**Ce que B5 fait, et ne fait pas.** Il **ne change pas le backend** : trancher le sens de « reçue »
face à un `failed` appartient à C2, qui est la première à pouvoir en écrire un, et le décider ici
serait le décider à l'aveugle. Mais il **écrit le composant qui saura l'afficher** : `ItemRow` prend
un état `'pending' | 'uploading' | 'received' | 'failed'`, la page ne calcule aujourd'hui que
`received` / `pending`, et les deux autres branches sont couvertes par des tests de composant. Le
jour de C2, l'écran avocat n'a qu'une ligne à changer — le calcul de l'état — au lieu d'un dessin à
inventer sous pression.

Trois règles de comportement, à respecter dès maintenant :

- **Un dépôt échoué n'est jamais silencieux.** Il porte une pastille `Depot echoue`
  (`variant="expired"`, la tonalité danger), un texte qui dit **quoi faire** (« Le client doit le
  deposer a nouveau »), et il **ne compte pas** dans « n pièces sur m » quand le backend le dira.
- **Un échec ne cache pas le nom du fichier**, qui est ce qui permet à l'avocat de dire à son client
  lequel recommencer — assaini comme tous les autres.
- **La progression, quand elle viendra, est indicative.** Une barre à 100 % ne veut pas dire
  « enregistré » : le fichier est encore en train d'être écrit dans MinIO, et le contrôle des *magic
  bytes* de C2 peut encore le refuser après. Le libellé sera donc « envoi en cours » puis
  « verification », jamais « termine » avant la réponse du serveur. C'est le piège classique de la
  barre de progression et il se règle en nommant les étapes, pas en trichant sur le pourcentage.

---

## Densité constante, et le mobile

L'énoncé cite la densité parmi ses critères de design, et E2 la reprend : **mêmes espacements et
même densité d'information aux deux tailles**. Ce n'est pas « ça tient sur un téléphone » — c'est
« on ne perd pas d'information et on ne change pas de rythme visuel en changeant d'écran ».

Ce qui la garantit concrètement, et qui doit être respecté dans les trois écrans :

- **Une échelle d'espacement, et une seule** : `4 / 8 / 12 / 16 / 24 / 32 px`. Aucune valeur hors
  de cette liste, à aucune taille d'écran. Une marge de 18 px quelque part est le premier pas vers
  deux rythmes différents.
- **Les paddings ne rétrécissent pas au mobile.** Une carte est à `16px` partout, son en-tête à
  `16px / 8px` partout. Réduire à `8px` sur téléphone tasse le texte exactement là où l'écran est le
  plus petit — l'inverse de ce qu'il faut. Seule la **gouttière de page** varie : `24px` au-dessus
  de 768 px, `16px` en dessous.
- **Aucune information n'est retirée au mobile.** Pas de colonne masquée, pas de métadonnée coupée.
  Ce qui change est la **direction** : ce qui était côte à côte passe l'un sous l'autre. D'où des
  cartes plutôt qu'un tableau sur la liste — un tableau à cinq colonnes n'a pas de version mobile
  honnête, il en cache.
- **Les tailles de texte sont fixes** : 11 px (bandeau de section), 12 px (méta), 14 px (corps),
  16 px (bouton, champ), les titres par la recette `heading`. Pas de typographie fluide — deux
  tailles de police pour un même rôle, c'est déjà deux densités.
- **Une seule colonne à toutes les tailles**, y compris en 1440 px, bornée à `maxW="1040px"`. Une
  grille à deux colonnes sur grand écran doublerait la densité du desktop par rapport au mobile,
  ce qui est précisément ce que le critère interdit.

Les trois points de rupture, et eux seuls (`base` / `md` = 768 px) :

| | `base` (< 768 px) | `md` (≥ 768 px) |
|---|---|---|
| Barre haute | Titre sur une ligne, e-mail + bouton dessous | Tout sur une ligne, bouton à droite |
| En-tête de liste | Titre puis bouton dessous, pleine largeur | Titre à gauche, bouton à droite |
| Ligne de pièce | Libellé, puis méta du fichier dessous | Libellé à gauche, méta à droite |
| Gouttière de page | 16 px | 24 px |

**Une seule exception assumée** : le bouton primaire passe en pleine largeur (`w="100%"`) sur
`base`, alors qu'il épouse son libellé sur `md`. C'est un écart à la charte E1 (« le bouton épouse
son libellé »), et il est délibéré : une cible tactile de 153 px de large sur un écran de 375 px est
inconfortable. À signaler dans le README plutôt qu'à laisser passer pour un oubli.

### Responsive

Une seule colonne partout, selon le tableau ci-dessus. Vérifié à **375 px** et **1440 px** en
tâche 8, en relevant les espacements des deux côtés pour prouver qu'ils sont les mêmes.

### Langue et ton

Interface en français, formel et court, comme E1 (« Connectez-vous pour gerer vos demandes de
pieces. »). Chaînes groupées dans un objet `TEXT` en tête de chaque écran, comme
`login-page.tsx` — le produit est monolingue et une traduction ultérieure doit rester mécanique.
**Les routes avocat restent en anglais** (`/dashboard`, `/requests/new`, `/requests/:id`) ; `/depot`
n'est pas à nous (voir D6).

---

## Contraintes globales

Valeurs reprises telles quelles des issues fermées et de `CLAUDE.md` — elles s'appliquent à
**toutes** les tâches.

- **Aucune dépendance npm nouvelle.**
- **Aucune couleur, police, radius ni ombre écrits dans une page.** Ce qui manque se crée dans
  `src/theme/`, jamais dans l'écran (E1).
- **Les variantes livrées avec Chakra l'emportent sur le `base` d'une recette**, et un `textStyle`
  l'emporte sur un `fontSize` voisin. Toute valeur de charte doit être répétée dans les variantes
  susceptibles de l'écraser, et les tests de recette lisent la valeur **effective**.
- **`chakra typegen` doit être rejoué** après tout ajout de variante (`pnpm -C frontend build` le
  lance ; sans lui, la variante ne type-check pas).
- **`Stack` étire ses enfants** : un bouton qui doit garder son gabarit porte `alignSelf`.
- **`height: 'auto'`** est déjà dans les recettes bouton et champ ; ne pas le retirer.
- **Lint bloquant** : `pnpm -C frontend lint` échoue sur le moindre avertissement. Un fichier qui
  exporte à la fois un composant et une fonction casse le fast refresh → **on scinde**, on ne
  désactive pas la règle.
- **Identifiants, commentaires et tests en anglais** ; seule l'UI est en français.
- **Fonctions fléchées** (`const f = () => {}`), jamais `function f()`.
- **Bornes serveur à respecter côté client** : 1 à 20 pièces, 200 caractères par intitulé et par
  libellé, 1 à 90 jours, `pageSize` ≤ 100. Le client **guide**, le serveur **décide** : un refus 400
  affiche le message du serveur, jamais un message inventé.
- **Light only** : aucun `_dark`, aucun bascule de thème.
- **Échelle d'espacement fermée** : `4 / 8 / 12 / 16 / 24 / 32 px`, à toutes les tailles d'écran.
  Une valeur hors de cette liste est un bug de densité (voir § Densité constante).
- **Deux points de rupture, `base` et `md`** — jamais de troisième. Ce qui change entre eux est la
  **direction** d'un empilement, jamais la quantité d'information affichée.
- **Aucun écran blanc** : les trois états chargement / vide / erreur sont obligatoires partout où
  une donnée est chargée, et vide ne doit jamais être servi à la place d'erreur.
- **Chaque tâche se termine par un commit** en Conventional Commits, en anglais.

---

## Structure des fichiers

**Créés**

| Fichier | Responsabilité |
|---|---|
| `frontend/src/api/requests.ts` | Types de vue (miroir du backend) + les 5 appels API |
| `frontend/src/format.ts` | Dates, tailles, nom de fichier assaini, pluriels |
| `frontend/src/hooks/use-resource.ts` | Chargement / erreur / données / `reload` |
| `frontend/src/components/reveal.tsx` | Apparition au défilement |
| `frontend/src/components/copy-field.tsx` | Champ lecture seule + bouton Copier |
| `frontend/src/components/status-badge.tsx` | Pastille de statut et pastille d'état du lien |
| `frontend/src/components/screen-state.tsx` | `<LoadingSkeleton>`, `<EmptyState>`, `<ErrorPanel>` — les trois états, une fois pour toutes |
| `frontend/src/components/item-row.tsx` | La ligne de pièce et ses **quatre** états, dont l'échec de dépôt |
| `frontend/src/components/issued-link-card.tsx` | La carte « LIEN GENERE » (création ET régénération) |
| `frontend/src/components/app-shell.tsx` | Barre haute + conteneur centré |
| `frontend/src/pages/dashboard-page.tsx` | La liste |
| `frontend/src/pages/new-request-page.tsx` | Le formulaire puis la remise du lien |
| `frontend/src/pages/request-detail-page.tsx` | Le détail, régénération, révocation |
| `frontend/src/theme/recipes/pin-digit.ts` | Le chiffre encadré du kit |

**Modifiés**

| Fichier | Changement |
|---|---|
| `frontend/src/theme/tokens.ts` | Ajout de `fonts.mono` |
| `frontend/src/theme/text-styles.ts` | Ajout de `codeLink` |
| `frontend/src/theme/recipes/badge.ts` | Variante `revoked` (même tonalité que `expired`) |
| `frontend/src/theme/index.ts` | Enregistrement de la recette `pinDigit` |
| `frontend/src/app.tsx` | Trois routes, sous `RequireSession` |
| `frontend/src/test/setup.ts` | Bouchons `IntersectionObserver`, `matchMedia`, `clipboard` |

**Supprimé** : `frontend/src/pages/dashboard-placeholder.tsx` — remplacé, comme son commentaire
l'annonce.

---

## Tâche 1 — Le thème gagne ce qui lui manque

**Fichiers** — Modifier : `src/theme/tokens.ts`, `src/theme/text-styles.ts`,
`src/theme/recipes/badge.ts`, `src/theme/index.ts`. Créer : `src/theme/recipes/pin-digit.ts`,
`src/theme/recipes/pin-digit.test.tsx`. Test : `src/theme/recipes/badge.test.tsx` (existant).

**Interfaces produites** — `pinDigitRecipe` ; variante de badge `revoked` ; `textStyles.codeLink` ;
token `fonts.mono`.

- [ ] **Étape 1 : le test de la variante `revoked`**, ajouté à `src/theme/recipes/badge.test.tsx`
      (suivre le style des cas existants, qui lisent la valeur effective) :

```tsx
it('gives a revoked link the same tone as an expired request', () => {
  // Two facts, one tone: a revoked link and an expired request are both
  // "nobody gets in", and the charter has one danger surface.
  expect(system.getRecipe('badge')({ variant: 'revoked' })).toMatchObject({
    background: 'dangerSurface',
    color: 'danger',
  })
})
```

- [ ] **Étape 2 : lancer, constater l'échec.** `pnpm -C frontend test badge` → échec, la variante
      n'existe pas.

- [ ] **Étape 3 : ajouter la variante** dans `src/theme/recipes/badge.ts` :

```ts
// One constant for two variant names rather than two literals: a revoked link
// and an expired request are the same "nobody gets in" for the reader, and
// duplicating the pair is how the two would drift.
const DANGER_TONE = { bg: 'dangerSurface', color: 'danger' } as const

// ... dans variants.variant :
      expired: DANGER_TONE,
      revoked: DANGER_TONE,
```

- [ ] **Étape 4 : le test de `pinDigit`**, dans `src/theme/recipes/pin-digit.test.tsx` :

```tsx
import { describe, expect, it } from 'vitest'
import { system } from '..'

describe('pinDigit recipe', () => {
  it('draws the kit box: soft accent border, l2 radius, primary digit', () => {
    expect(system.getRecipe('pinDigit')({})).toMatchObject({
      borderColor: 'border.accent',
      borderRadius: 'l2',
      color: 'brand.fg',
    })
  })
})
```

- [ ] **Étape 5 : écrire la recette** `src/theme/recipes/pin-digit.ts` :

```ts
import { defineRecipe } from '@chakra-ui/react'

// The kit's "Code PIN": four boxed digits, not an input. It is a display, so
// no size variant of Chakra's can reach it -- unlike the button and the card,
// this one needs no defensive repetition.
export const pinDigitRecipe = defineRecipe({
  base: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '40px',
    height: '40px',
    borderWidth: '1px',
    borderColor: 'border.accent',
    borderRadius: 'l2',
    bg: 'bg.subtle',
    color: 'brand.fg',
    fontSize: '16px',
    fontWeight: 600,
    fontVariantNumeric: 'tabular-nums',
  },
})
```

- [ ] **Étape 6 : le token de police et le style de code.** Dans `tokens.ts`, sous `fonts` :

```ts
    mono: { value: "'JetBrains Mono', ui-monospace, 'SFMono-Regular', Menlo, monospace" },
```

Aucune police monospace n'est embarquée : la liste tombe sur celle du système. **Ne pas ajouter
`@fontsource`** — E1 a mesuré 40 requêtes toutes sur l'origine, et une seconde police coûterait du
poids pour un champ de lien.

Dans `text-styles.ts` :

```ts
  // The generated link, as the kit draws it: monospace, truncated, selectable.
  codeLink: {
    value: {
      fontFamily: 'mono',
      fontSize: '13px',
      lineHeight: '1.4',
      letterSpacing: '0',
    },
  },
```

- [ ] **Étape 7 : enregistrer la recette** dans `src/theme/index.ts` (`recipes: { …, pinDigit:
      pinDigitRecipe }`), puis rejouer `chakra typegen` : `pnpm -C frontend build`.

- [ ] **Étape 8 : vérifier.** `pnpm -C frontend test && pnpm -C frontend lint` → tout vert, zéro
      avertissement.

- [ ] **Étape 9 : commit.**

```bash
git add frontend/src/theme
git commit -m "feat(theme): add the pin digit box, the link text style and a revoked badge"
```

---

## Tâche 2 — La couche API et le formatage

**Fichiers** — Créer : `src/api/requests.ts`, `src/format.ts`, `src/format.test.ts`.

**Interfaces consommées** — `apiRequest`, `ApiError` (`src/api/client.ts`).

**Interfaces produites** — types `RequestStatus`, `LinkState`, `LinkView`, `RequestSummary`,
`RequestPage`, `ReceivedFile`, `DetailedItem`, `RequestDetail`, `IssuedLink`, `CreateRequestBody` ;
fonctions `listRequests`, `getRequest`, `createRequest`, `regenerateLink`, `revokeLink` ;
`formatDate`, `formatBytes`, `safeFileName`, `pluralize`, `expiryDateFrom`.

- [ ] **Étape 1 : écrire les tests de formatage**, `src/format.test.ts` :

```ts
import { describe, expect, it } from 'vitest'
import { expiryDateFrom, formatBytes, formatDate, safeFileName } from './format'

describe('formatDate', () => {
  it('renders a French long date from an ISO string', () => {
    expect(formatDate('2026-03-12T09:30:00.000Z')).toMatch(/12 mars 2026/)
  })

  // The API always answers ISO, but a truncated payload must not blank the
  // whole card with "Invalid Date".
  it('falls back to a dash on an unparsable date', () => {
    expect(formatDate('not-a-date')).toBe('—')
  })
})

describe('formatBytes', () => {
  it.each([
    [0, '0 o'],
    [2_411_724, '2,4 Mo'],
    [1024, '1 ko'],
  ])('renders %i as %s', (bytes, expected) => {
    expect(formatBytes(bytes)).toBe(expected)
  })
})

describe('safeFileName', () => {
  // The real attack the display has to survive: U+202E flips what follows, so
  // a browser shows "facturexe.pdf" for a file actually named ".exe".
  it('strips the right-to-left override that disguises an extension', () => {
    expect(safeFileName('facture‮fdp.exe')).toBe('facturefdp.exe')
  })

  it('strips control characters', () => {
    expect(safeFileName('bail signe.pdf')).toBe('bailsigne.pdf')
  })

  it('never returns an empty label', () => {
    expect(safeFileName('‮‮')).toBe('Fichier sans nom')
  })

  it('truncates a name long enough to break the layout', () => {
    expect(safeFileName('a'.repeat(200))).toHaveLength(80)
  })
})

describe('expiryDateFrom', () => {
  it('adds the days to the reference instant', () => {
    const at = expiryDateFrom(14, new Date('2026-03-12T09:00:00.000Z'))
    expect(formatDate(at.toISOString())).toMatch(/26 mars 2026/)
  })
})
```

- [ ] **Étape 2 : lancer, constater l'échec.** `pnpm -C frontend test format` → module introuvable.

- [ ] **Étape 3 : écrire `src/format.ts`.**

```ts
// Control characters and bidirectional overrides. React escapes HTML; it does
// NOT neutralise these, and U+202E reverses everything after it -- which is
// how "facture<RLO>fdp.exe" reads as "facturexe.pdf" on screen. originalName
// is supplied by an anonymous client (C2), so it is hostile input.
const CONTROL_OR_BIDI = /[ -‎‏‪-‮⁦-⁩]/g

const MAX_NAME_LENGTH = 80

const dateFormatter = new Intl.DateTimeFormat('fr-FR', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
})

export const formatDate = (iso: string): string => {
  const at = new Date(iso)
  return Number.isNaN(at.getTime()) ? '—' : dateFormatter.format(at)
}

const UNITS = ['o', 'ko', 'Mo', 'Go'] as const

export const formatBytes = (bytes: number): string => {
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024
    unit += 1
  }
  // No decimal on bytes and kilobytes: "2,4 o" says nothing "2 o" does not.
  const digits = unit >= 2 && value < 100 ? 1 : 0
  return `${value.toLocaleString('fr-FR', { maximumFractionDigits: digits })} ${UNITS[unit]}`
}

export const safeFileName = (name: string): string => {
  const cleaned = name.replace(CONTROL_OR_BIDI, '').trim()
  if (cleaned === '') return 'Fichier sans nom'
  return cleaned.length > MAX_NAME_LENGTH ? `${cleaned.slice(0, MAX_NAME_LENGTH - 1)}…` : cleaned
}

export const pluralize = (count: number, one: string, many: string): string =>
  `${count} ${count > 1 ? many : one}`

/** What the creation form shows under the "days" field, so the lawyer reads a date. */
export const expiryDateFrom = (days: number, from: Date = new Date()): Date =>
  new Date(from.getTime() + days * 24 * 60 * 60 * 1000)
```

- [ ] **Étape 4 : lancer, constater le vert.** `pnpm -C frontend test format`.

- [ ] **Étape 5 : écrire `src/api/requests.ts`.** Aucun test propre : ce sont cinq appels d'une
      ligne, exercés par les tests d'écran de la tâche 5 à 7.

```ts
import { apiRequest } from './client'

// Mirrors backend/src/requests/request.types.ts. Nothing generates it, so a
// field renamed there has to be renamed here by hand -- the same contract as
// LawyerProfile in src/auth/session.ts. Dates arrive as ISO strings: JSON has
// no Date, and typing them as Date would lie to every caller.
export type RequestStatus = 'pending' | 'complete' | 'expired'
export type LinkState = 'active' | 'revoked'

export type LinkView = { state: LinkState; expiresAt: string }

export type RequestSummary = {
  id: string
  title: string
  createdAt: string
  status: RequestStatus
  expectedCount: number
  receivedCount: number
  link: LinkView
}

export type RequestPage = {
  items: RequestSummary[]
  page: number
  pageSize: number
  total: number
  totalPages: number
}

export type ReceivedFile = {
  originalName: string
  mimeType: string
  sizeBytes: number
  receivedAt: string
}

export type DetailedItem = {
  id: string
  label: string
  received: boolean
  file: ReceivedFile | null
}

export type RequestDetail = RequestSummary & { items: DetailedItem[] }

/**
 * The link IN CLEAR. It exists at exactly two moments -- the creation response
 * and the regeneration response -- because the database holds a SHA-256 of the
 * token and an argon2id of the PIN. Whatever the lawyer does not copy here is
 * gone: a lost PIN is not redisplayed, it is REPLACED by regenerating.
 */
export type IssuedLink = { url: string; pin: string; expiresAt: string }

export type CreatedRequest = {
  id: string
  title: string
  createdAt: string
  status: RequestStatus
  items: { id: string; label: string; received: boolean }[]
  link: IssuedLink
}

export type CreateRequestBody = {
  title: string
  items: string[]
  expiresInDays: number
}

export const listRequests = (page: number): Promise<RequestPage> =>
  apiRequest<RequestPage>(`/requests?page=${String(page)}`)

export const getRequest = (id: string): Promise<RequestDetail> =>
  apiRequest<RequestDetail>(`/requests/${encodeURIComponent(id)}`)

const jsonBody = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

export const createRequest = (body: CreateRequestBody): Promise<CreatedRequest> =>
  apiRequest<CreatedRequest>('/requests', jsonBody(body))

export const regenerateLink = (id: string, expiresInDays: number): Promise<IssuedLink> =>
  apiRequest<IssuedLink>(`/requests/${encodeURIComponent(id)}/link`, jsonBody({ expiresInDays }))

export const revokeLink = (id: string): Promise<void> =>
  apiRequest<void>(`/requests/${encodeURIComponent(id)}/link`, { method: 'DELETE' })
```

- [ ] **Étape 6 : vérifier.** `pnpm -C frontend test && pnpm -C frontend lint`.

- [ ] **Étape 7 : commit.**

```bash
git add frontend/src/api/requests.ts frontend/src/format.ts frontend/src/format.test.ts
git commit -m "feat(api): type the lawyer request routes and sanitise displayed values"
```

---

## Tâche 3 — `useResource`

**Fichiers** — Créer : `src/hooks/use-resource.ts`, `src/hooks/use-resource.test.ts`.

**Interfaces produites** —
`useResource<T>(load: () => Promise<T>, deps: unknown[]) => { data: T | null; error: unknown; loading: boolean; reload: () => Promise<void> }`.

- [ ] **Étape 1 : écrire les tests**, `src/hooks/use-resource.test.ts` :

```ts
import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useResource } from './use-resource'

describe('useResource', () => {
  it('goes from loading to data', async () => {
    const { result } = renderHook(() => useResource(() => Promise.resolve('ok'), []))

    expect(result.current.loading).toBe(true)
    await waitFor(() => expect(result.current.data).toBe('ok'))
    expect(result.current.loading).toBe(false)
    expect(result.current.error).toBeNull()
  })

  it('exposes the rejection instead of throwing it at the screen', async () => {
    const boom = new Error('boom')
    const { result } = renderHook(() => useResource(() => Promise.reject(boom), []))

    await waitFor(() => expect(result.current.error).toBe(boom))
    expect(result.current.loading).toBe(false)
  })

  it('reloads on demand, which is what a mutation calls', async () => {
    const load = vi.fn().mockResolvedValueOnce('first').mockResolvedValueOnce('second')
    const { result } = renderHook(() => useResource(load, []))
    await waitFor(() => expect(result.current.data).toBe('first'))

    await act(async () => {
      await result.current.reload()
    })

    expect(result.current.data).toBe('second')
  })

  // The real failure this guards: the lawyer clicks page 2 while page 1 is
  // still in flight. Page 1 answers last and overwrites page 2 -- the list
  // then contradicts the "Page 2 sur 3" printed beside it.
  it('ignores an answer that a newer call has superseded', async () => {
    let releaseFirst: (value: string) => void = () => {}
    const load = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<string>((resolve) => {
            releaseFirst = resolve
          }),
      )
      .mockResolvedValueOnce('page 2')

    const { result, rerender } = renderHook(({ page }) => useResource(load, [page]), {
      initialProps: { page: 1 },
    })

    rerender({ page: 2 })
    await waitFor(() => expect(result.current.data).toBe('page 2'))

    await act(async () => {
      releaseFirst('page 1')
    })

    expect(result.current.data).toBe('page 2')
  })
})
```

- [ ] **Étape 2 : lancer, constater l'échec.** `pnpm -C frontend test use-resource`.

- [ ] **Étape 3 : écrire le hook.**

```ts
import { useCallback, useEffect, useRef, useState } from 'react'

export type Resource<T> = {
  data: T | null
  error: unknown
  loading: boolean
  reload: () => Promise<void>
}

/**
 * Loading, error and data for one endpoint, plus the reload a mutation needs.
 *
 * Deliberately not TanStack Query: three screens, no shared cache, no
 * background refetch. What a library would buy here is 13 kB and a provider.
 *
 * `deps` is passed as an array rather than read from the closure, because the
 * loader is rebuilt on every render -- taking it as a dependency would refetch
 * forever.
 */
export const useResource = <T,>(load: () => Promise<T>, deps: unknown[]): Resource<T> => {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [loading, setLoading] = useState(true)

  // Monotonic, not a boolean: two calls can be in flight, and only the answer
  // to the LAST one may be written. A plain "is mounted" flag lets a slow
  // first page overwrite the second one.
  const generation = useRef(0)
  const loadRef = useRef(load)
  loadRef.current = load

  const run = useCallback(async () => {
    generation.current += 1
    const mine = generation.current
    setLoading(true)
    try {
      const result = await loadRef.current()
      if (generation.current !== mine) return
      setData(result)
      setError(null)
    } catch (caught) {
      if (generation.current !== mine) return
      setError(caught)
    } finally {
      if (generation.current === mine) setLoading(false)
    }
  }, [])

  useEffect(() => {
    void run()
    return () => {
      // Bumping on unmount discards an answer nobody is waiting for.
      generation.current += 1
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deps is the caller's contract
  }, deps)

  return { data, error, loading, reload: run }
}
```

> Si `oxlint` refuse la ligne de désactivation (règle inconnue), la remplacer par un
> `useEffect(() => { void run() }, [run, ...deps])` **impossible ici** — préférer alors envelopper
> `deps` : `const key = JSON.stringify(deps)` et dépendre de `[key, run]`. Choisir la forme que le
> lint accepte, et **commenter laquelle et pourquoi**.

- [ ] **Étape 4 : lancer, constater le vert.** `pnpm -C frontend test use-resource`.

- [ ] **Étape 5 : vérifier le lint.** `pnpm -C frontend lint` — zéro avertissement.

- [ ] **Étape 6 : commit.**

```bash
git add frontend/src/hooks
git commit -m "feat(frontend): add a loading/error/reload hook for a single endpoint"
```

---

## Tâche 4 — Les composants partagés

**Fichiers** — Créer : `src/components/reveal.tsx`, `src/components/reveal.test.tsx`,
`src/components/copy-field.tsx`, `src/components/copy-field.test.tsx`,
`src/components/status-badge.tsx`, `src/components/issued-link-card.tsx`,
`src/components/app-shell.tsx`. Modifier : `src/test/setup.ts`.

**Interfaces consommées** — `IssuedLink`, `RequestStatus`, `LinkState` (tâche 2) ; `formatDate`
(tâche 2) ; `useSession` (`src/auth/session.ts`).

**Interfaces produites** — `<Reveal delay?>`, `<CopyField value label ariaLabel>`,
`<StatusBadge status>`, `<LinkStateBadge state>`, `<IssuedLinkCard link title onDone>`,
`<AppShell>`.

- [ ] **Étape 1 : les bouchons jsdom**, dans `src/test/setup.ts` (jsdom n'a ni
      `IntersectionObserver`, ni `matchMedia`, ni presse-papiers) :

```ts
// jsdom ships none of the three. Without the observer, every Reveal would
// throw on mount and take the whole screen suite with it.
class NoopObserver implements IntersectionObserver {
  readonly root = null
  readonly rootMargin = ''
  readonly thresholds: readonly number[] = []
  observe = () => {}
  unobserve = () => {}
  disconnect = () => {}
  takeRecords = () => []
}
vi.stubGlobal('IntersectionObserver', NoopObserver)

vi.stubGlobal(
  'matchMedia',
  (query: string) =>
    ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }) as unknown as MediaQueryList,
)
```

Le presse-papiers se bouchonne **par test** (tâche suivante), pas globalement : un test doit pouvoir
en simuler le refus.

- [ ] **Étape 2 : le test de `Reveal`**, `src/components/reveal.test.tsx` :

```tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Reveal } from './reveal'

describe('Reveal', () => {
  // The failure this guards is invisible content, which is worse than no
  // animation: a browser without IntersectionObserver, or a stubbed one that
  // never fires, must still show the list.
  it('shows its children when the observer never fires', () => {
    render(
      <Reveal>
        <p>Dossier Martin</p>
      </Reveal>,
    )
    expect(screen.getByText('Dossier Martin')).toBeVisible()
  })

  it('shows its children immediately when motion is reduced', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: true,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }))
    render(
      <Reveal>
        <p>Dossier Martin</p>
      </Reveal>,
    )
    expect(screen.getByText('Dossier Martin')).toBeVisible()
  })
})
```

- [ ] **Étape 3 : lancer, constater l'échec.**

- [ ] **Étape 4 : écrire `Reveal`.**

```tsx
import { Box } from '@chakra-ui/react'
import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)'

// Fires a little before the element reaches the fold, so the card is already
// settled when the eye gets there.
const ROOT_MARGIN = '0px 0px -10% 0px'

const prefersReducedMotion = (): boolean =>
  typeof matchMedia === 'function' && matchMedia(REDUCED_MOTION).matches

export const Reveal = ({ children, delay = 0 }: { children: ReactNode; delay?: number }) => {
  // The default is VISIBLE, and the state only ever goes to false when the
  // observer is actually going to run. Defaulting to hidden means a browser
  // without IntersectionObserver shows a blank page for ever.
  const [shown, setShown] = useState(true)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const node = ref.current
    if (node === null) return
    if (prefersReducedMotion() || typeof IntersectionObserver !== 'function') return

    setShown(false)
    const observer = new IntersectionObserver(
      (entries) => {
        // Once revealed, never hidden again: re-hiding on scroll-up makes the
        // page flicker on every direction change.
        if (entries.some((entry) => entry.isIntersecting)) {
          setShown(true)
          observer.disconnect()
        }
      },
      { rootMargin: ROOT_MARGIN },
    )
    observer.observe(node)
    return () => {
      observer.disconnect()
    }
  }, [])

  return (
    <Box
      ref={ref}
      opacity={shown ? 1 : 0}
      transform={shown ? 'translateY(0)' : 'translateY(12px)'}
      transitionProperty="opacity, transform"
      transitionDuration="320ms"
      transitionTimingFunction="ease-out"
      transitionDelay={`${String(delay)}ms`}
    >
      {children}
    </Box>
  )
}
```

- [ ] **Étape 5 : lancer, constater le vert.**

- [ ] **Étape 6 : le test de `CopyField`**, `src/components/copy-field.test.tsx` :

```tsx
import { ChakraProvider } from '@chakra-ui/react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { system } from '../theme'
import { CopyField } from './copy-field'

const renderField = (value = 'https://portail/depot/8f3a2c1b') =>
  render(
    <ChakraProvider value={system}>
      <CopyField label="Lien a envoyer au client" value={value} />
    </ChakraProvider>,
  )

describe('CopyField', () => {
  it('copies the value and confirms it', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
    renderField()

    await userEvent.click(screen.getByRole('button', { name: /copier/i }))

    expect(writeText).toHaveBeenCalledWith('https://portail/depot/8f3a2c1b')
    expect(await screen.findByText(/copie/i)).toBeInTheDocument()
  })

  // A refused clipboard must not look like a successful copy: the PIN is shown
  // once, and a lawyer who believes it is copied loses it.
  it('tells the lawyer to copy by hand when the clipboard refuses', async () => {
    vi.stubGlobal('navigator', {
      ...navigator,
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
    })
    renderField()

    await userEvent.click(screen.getByRole('button', { name: /copier/i }))

    expect(await screen.findByText(/ctrl\+c/i)).toBeInTheDocument()
  })
})
```

- [ ] **Étape 7 : lancer, constater l'échec, puis écrire `CopyField`.**

```tsx
import { Box, Button, Field, Input, Stack, Text } from '@chakra-ui/react'
import { useRef, useState } from 'react'

const TEXT = {
  copy: 'Copier',
  copied: 'Copie',
  manual: 'Copiez avec Ctrl+C',
}

type Feedback = 'idle' | 'copied' | 'manual'

const CONFIRMATION_MS = 2000

export const CopyField = ({ label, value }: { label: string; value: string }) => {
  const [feedback, setFeedback] = useState<Feedback>('idle')
  const inputRef = useRef<HTMLInputElement>(null)

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setFeedback('copied')
      setTimeout(() => setFeedback('idle'), CONFIRMATION_MS)
    } catch {
      // Not an error message: the value is right there, the lawyer only has
      // to take it. Selecting it is what makes Ctrl+C a one-key action.
      inputRef.current?.select()
      setFeedback('manual')
    }
  }

  return (
    <Field.Root>
      <Field.Label>{label}</Field.Label>
      <Stack direction="row" gap="8px" align="center" w="100%">
        <Box flex="1" minW="0">
          <Input
            ref={inputRef}
            readOnly
            value={value}
            textStyle="codeLink"
            textOverflow="ellipsis"
            onFocus={(event) => event.currentTarget.select()}
          />
        </Box>
        <Button variant="secondary" size="sm" flexShrink="0" onClick={() => void onCopy()}>
          {feedback === 'copied' ? TEXT.copied : TEXT.copy}
        </Button>
      </Stack>
      {feedback !== 'idle' ? (
        <Text role="status" color="fg.muted" fontSize="12px">
          {feedback === 'copied' ? `${TEXT.copied} ✓` : TEXT.manual}
        </Text>
      ) : null}
    </Field.Root>
  )
}
```

- [ ] **Étape 8 : lancer, constater le vert.**

- [ ] **Étape 9 : écrire `StatusBadge`** (`src/components/status-badge.tsx`) — deux composants, pas
      un, parce que ce sont **deux faits indépendants** (B4) :

```tsx
import { Badge } from '@chakra-ui/react'
import type { LinkState, RequestStatus } from '../api/requests'

const STATUS_LABEL: Record<RequestStatus, string> = {
  pending: 'En attente',
  complete: 'Complete',
  expired: 'Expiree',
}

const LINK_LABEL: Record<LinkState, string> = {
  active: 'Lien actif',
  revoked: 'Lien revoque',
}

export const StatusBadge = ({ status }: { status: RequestStatus }) => (
  <Badge variant={status}>{STATUS_LABEL[status]}</Badge>
)

/**
 * Beside the status, never instead of it: a request can be COMPLETE and its
 * link REVOKED, and one pill would drop whichever fact it did not carry --
 * leaving the lawyer unable to tell whether to regenerate.
 */
export const LinkStateBadge = ({ state }: { state: LinkState }) => (
  <Badge variant={state === 'active' ? 'info' : 'revoked'}>{LINK_LABEL[state]}</Badge>
)
```

- [ ] **Étape 10 : écrire `IssuedLinkCard`** (`src/components/issued-link-card.tsx`) : la carte
      « LIEN GENERE », partagée par la création et la régénération. En-tête `LIEN GENERE`, un
      `CopyField` pour l'URL, les quatre chiffres du PIN dans des boîtes `pinDigit` **plus** un
      `CopyField` masqué en `sr-only`… non : un bouton `Copier` à côté des chiffres, qui appelle la
      même logique. L'encart d'avertissement est en `warningSurface` / `warning`. Les libellés :

```ts
const TEXT = {
  eyebrow: 'Lien genere',
  linkLabel: 'Lien a envoyer au client',
  pinLabel: 'Code PIN',
  copyPin: 'Copier le code',
  expiry: (date: string) => `Ce lien expire le ${date}.`,
  warning:
    "Ce code n'est affiche qu'une fois. Il n'est pas conserve en clair : si vous le perdez, il faudra regenerer le lien, ce qui invalidera celui-ci.",
}
```

- [ ] **Étape 11 : écrire les trois états**, `src/components/screen-state.tsx`. Un seul fichier :
      les trois sont **mutuellement exclusifs** et se lisent ensemble.

```tsx
/**
 * The three states every loaded screen owes its reader, and the reason they
 * live in one file: an empty list and a failed load look identical on screen
 * and call for opposite actions -- create, or retry. Serving one for the other
 * is a lie, not a cosmetic slip.
 */

// Skeletons carry the height of the real thing. A 24px spinner replaced by a
// 140px card makes the page jump under the cursor the moment data lands.
export const LoadingSkeleton = ({ count = 3, height = '140px' }) => (
  <Stack gap="16px" role="status" aria-label="Chargement en cours">
    {Array.from({ length: count }, (_, index) => (
      <Box key={index} h={height} bg="bg.subtle" borderRadius="l3" />
    ))}
  </Stack>
)

export const EmptyState = ({ title, description, action }: EmptyStateProps) => (/* … */)

// role="alert" and not a plain paragraph: a screen reader must hear the
// failure, otherwise the page silently stops changing.
export const ErrorPanel = ({ message, onRetry }: ErrorPanelProps) => (/* … */)
```

Aucune animation de pulsation sur les fantômes : elle attire l'œil sur ce qui n'est pas encore là.

- [ ] **Étape 12 : le test d'`ItemRow`**, `src/components/item-row.test.tsx`. **Les quatre états
      sont testés dès maintenant**, même si la page n'en calcule que deux — c'est ce qui fait que C2
      n'aura qu'une ligne à changer :

```tsx
it('shows the file metadata of a received piece', async () => { /* … */ })

it('shows "En attente" and no metadata when nothing was deposited', () => { /* … */ })

// C2 will write this state. Drawn now so the lawyer screen does not have to be
// redesigned under pressure the day an upload can fail.
it('names a failed deposit, keeps the file name, and says what to do', () => {
  render(<ItemRow label="Facture EDF" state="failed" file={file('facture.pdf')} />)
  expect(screen.getByText(/depot echoue/i)).toBeInTheDocument()
  expect(screen.getByText('facture.pdf')).toBeInTheDocument()
  expect(screen.getByText(/deposer a nouveau/i)).toBeInTheDocument()
})

// A progress bar is INDICATIVE: 100 % means "sent", not "kept" -- the magic
// bytes check of C2 can still refuse the file afterwards. The label must never
// promise more than the server has confirmed.
it('reads progress as "envoi en cours", never as done', () => {
  render(<ItemRow label="Piece d'identite" state="uploading" progress={100} file={file('cni.jpg')} />)
  expect(screen.getByText(/envoi en cours/i)).toBeInTheDocument()
  expect(screen.queryByText(/termine/i)).not.toBeInTheDocument()
  expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100')
})
```

- [ ] **Étape 13 : lancer, constater l'échec, puis écrire `ItemRow`.** L'état est une union
      explicite, la page ne fournit aujourd'hui que deux de ses valeurs :

```tsx
/**
 * The four states of an expected piece. Only `pending` and `received` can occur
 * today: the API does not expose UploadedFile.status (ReceivedFileView carries
 * name, type, size and date, and nothing else), and `received` means "a file
 * hangs off the piece" whatever its status.
 *
 * The other two are drawn anyway. C2 is the first thing able to write a
 * `failed`, and deciding here what "received" means against one would be
 * deciding blind -- but the day it does, this screen changes ONE line, the
 * state computation, instead of inventing a design.
 */
export type ItemState = 'pending' | 'uploading' | 'received' | 'failed'
```

Rendu : `Stack` direction `{ base: 'column', md: 'row' }`, libellé à gauche, méta à droite ; le
nom passe par `safeFileName`, jamais dans un `href`.

- [ ] **Étape 14 : écrire `AppShell`** (`src/components/app-shell.tsx`) : barre haute, titre lien
      vers `/dashboard`, e-mail de l'avocat, bouton `secondary` `sm` « Se deconnecter » qui appelle
      `signOut()` puis navigue vers `/login`. Contenu en `maxW="1040px"`, `mx="auto"`,
      `px={{ base: '16px', md: '24px' }}` — la **seule** valeur d'espacement qui varie entre les
      deux points de rupture.

- [ ] **Étape 15 : vérifier.** `pnpm -C frontend test && pnpm -C frontend lint`.

- [ ] **Étape 16 : commit.**

```bash
git add frontend/src/components frontend/src/test/setup.ts
git commit -m "feat(frontend): add reveal, copy field, badges, the three screen states and the piece row"
```

---

## Tâche 5 — L'écran liste

**Fichiers** — Créer : `src/pages/dashboard-page.tsx`, `src/pages/dashboard-page.test.tsx`.
Modifier : `src/app.tsx`. Supprimer : `src/pages/dashboard-placeholder.tsx`.

**Interfaces consommées** — `listRequests`, `RequestPage` (tâche 2) ; `useResource` (tâche 3) ;
`Reveal`, `StatusBadge`, `LinkStateBadge`, `AppShell` (tâche 4) ; `formatDate`, `pluralize`
(tâche 2).

- [ ] **Étape 1 : écrire les tests**, `src/pages/dashboard-page.test.tsx`. Reprendre le harnais de
      `login-page.test.tsx` (`jsonResponse`, `vi.stubGlobal('fetch', …)`), en enveloppant dans
      `ChakraProvider` + `MemoryRouter` + `SessionProvider`.

```tsx
const summary = (over: Partial<RequestSummary> = {}): RequestSummary => ({
  id: 'r1',
  title: 'Dossier Martin, pieces 2026',
  createdAt: '2026-03-12T09:00:00.000Z',
  status: 'pending',
  expectedCount: 4,
  receivedCount: 2,
  link: { state: 'active', expiresAt: '2026-03-26T09:00:00.000Z' },
  ...over,
})

it('shows the empty state rather than a blank screen', async () => {
  stubFetch(page({ items: [], total: 0, totalPages: 0 }))
  renderDashboard()
  expect(await screen.findByText(/aucune demande/i)).toBeInTheDocument()
  expect(screen.getByRole('link', { name: /creer une demande/i })).toBeInTheDocument()
})

// The point B4 makes and a single column would lose: the two facts are
// independent, so a complete request whose link is cut must show both.
it('renders the status and the link state as two separate pills', async () => {
  stubFetch(page({ items: [summary({ status: 'complete', link: { state: 'revoked', expiresAt: '2026-03-26T09:00:00.000Z' } })] }))
  renderDashboard()
  expect(await screen.findByText('Complete')).toBeInTheDocument()
  expect(screen.getByText(/lien revoque/i)).toBeInTheDocument()
})

it('reads the progress off the counts', async () => {
  stubFetch(page({ items: [summary()] }))
  renderDashboard()
  expect(await screen.findByText(/2 pieces sur 4/i)).toBeInTheDocument()
})

it('asks for the next page and says which one it is showing', async () => {
  const fetchMock = stubFetch(page({ items: [summary()], page: 1, total: 25, totalPages: 2 }))
  renderDashboard()
  await userEvent.click(await screen.findByRole('button', { name: /suivant/i }))
  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('page=2'), expect.anything()),
  )
})

it('disables both arrows on a single page', async () => { /* … */ })

// A failed list must say so; the empty state would claim the lawyer has no
// request, which is a different and wrong statement.
it('distinguishes a failed load from an empty list', async () => {
  stubFetch(jsonResponse({}, 500))
  renderDashboard()
  expect(await screen.findByRole('alert')).toBeInTheDocument()
  expect(screen.queryByText(/aucune demande/i)).not.toBeInTheDocument()
})
```

- [ ] **Étape 2 : lancer, constater l'échec.**

- [ ] **Étape 3 : écrire `dashboard-page.tsx`.** Structure : `AppShell` → en-tête (titre + compte +
      bouton `Creer une demande` en `Link` react-router) → contenu selon l'état :
      `loading` (trois cartes fantômes) / `error` (encart `role="alert"` + bouton `Reessayer` qui
      appelle `reload`) / liste vide / liste. Chaque carte est enveloppée d'un `<Reveal delay={index * 60}>`.
      La pagination est deux boutons `secondary sm` et un texte `Page n sur m`, masquée quand
      `totalPages <= 1`.

- [ ] **Étape 4 : brancher les routes** dans `src/app.tsx` : `/dashboard` → `DashboardPage`,
      toujours sous `RequireSession`. Supprimer l'import de `DashboardPlaceholder` **et le fichier**.

- [ ] **Étape 5 : lancer, constater le vert.** `pnpm -C frontend test`.

- [ ] **Étape 6 : vérifier le lint.** `pnpm -C frontend lint`.

- [ ] **Étape 7 : commit.**

```bash
git add frontend/src/pages/dashboard-page.tsx frontend/src/pages/dashboard-page.test.tsx frontend/src/app.tsx
git rm frontend/src/pages/dashboard-placeholder.tsx
git commit -m "feat(dashboard): list the lawyer requests with status, link state and reveal"
```

---

## Tâche 6 — L'écran de création

**Fichiers** — Créer : `src/pages/new-request-page.tsx`, `src/pages/new-request-page.test.tsx`.
Modifier : `src/app.tsx`.

**Interfaces consommées** — `createRequest`, `CreatedRequest` (tâche 2) ; `IssuedLinkCard`
(tâche 4) ; `expiryDateFrom`, `formatDate` (tâche 2).

**Bornes à refléter** (constantes locales, commentées comme miroir du serveur) : `MAX_ITEMS = 20`,
`MAX_TITLE = 200`, `MAX_LABEL = 200`, `MIN_DAYS = 1`, `MAX_DAYS = 90`.

- [ ] **Étape 1 : écrire les tests**, `src/pages/new-request-page.test.tsx` :

```tsx
it('starts with one empty piece row, because a request needs at least one', async () => { /* … */ })

it('adds and removes piece rows, and stops at twenty', async () => {
  renderPage()
  for (let i = 0; i < 25; i += 1) {
    const add = screen.queryByRole('button', { name: /ajouter une piece/i })
    if (add === null) break
    await userEvent.click(add)
  }
  expect(screen.getAllByLabelText(/piece attendue/i)).toHaveLength(20)
  expect(screen.queryByRole('button', { name: /ajouter une piece/i })).not.toBeInTheDocument()
})

it('shows the expiry as a date, because the lawyer does not think in days', async () => { /* … */ })

// The client guides, the server decides: a 400 must show what the server said,
// never a message invented here that could contradict it.
it('shows the API message when the server refuses the body', async () => {
  stubFetch(jsonResponse({ message: ['Deux pieces attendues portent le meme libelle.'] }, 400))
  renderPage()
  await fillValidForm()
  await userEvent.click(screen.getByRole('button', { name: /creer la demande/i }))
  expect(await screen.findByRole('alert')).toHaveTextContent(/meme libelle/i)
})

it('replaces the form with the link and the PIN once created', async () => {
  stubFetch(jsonResponse(created))
  renderPage()
  await fillValidForm()
  await userEvent.click(screen.getByRole('button', { name: /creer la demande/i }))

  expect(await screen.findByDisplayValue(/depot\/8f3a2c1b/)).toBeInTheDocument()
  expect(screen.getByText('4')).toBeInTheDocument()
  expect(screen.getByText(/affiche qu'une fois/i)).toBeInTheDocument()
  // The form is gone: resubmitting would create a SECOND request, and the
  // first PIN would vanish with the screen.
  expect(screen.queryByRole('button', { name: /creer la demande/i })).not.toBeInTheDocument()
})

it('sends once on a double click', async () => { /* button disabled while in flight */ })
```

- [ ] **Étape 2 : lancer, constater l'échec.**

- [ ] **Étape 3 : écrire l'écran.** Deux points non évidents à traiter explicitement :

```tsx
// Rows carry a stable key of their own, not their index: React would otherwise
// reuse the DOM node of the removed row and the text of the row below it would
// jump into the field above.
type ItemRow = { key: string; label: string }

// class-validator answers `message` as a string OR an array of strings (one per
// broken rule). Rendering the array raw prints "a,b"; joining is what makes it
// readable.
const apiMessage = (caught: unknown): string | null => { /* … */ }
```

Le corps envoyé filtre les libellés vides (`items.map(trim).filter(Boolean)`) — un formulaire à
trois lignes dont deux sont vides doit créer une demande d'une pièce, pas un 400.

Le bouton `Creer la demande` est désactivé tant que l'intitulé est vide **ou** qu'aucune pièce n'est
saisie : c'est le seul contrôle client, tout le reste laisse répondre le serveur.

- [ ] **Étape 4 : brancher la route** `/requests/new` dans `src/app.tsx`, sous `RequireSession`.

- [ ] **Étape 5 : lancer, constater le vert.** `pnpm -C frontend test`.

- [ ] **Étape 6 : vérifier le lint.**

- [ ] **Étape 7 : commit.**

```bash
git add frontend/src/pages/new-request-page.tsx frontend/src/pages/new-request-page.test.tsx frontend/src/app.tsx
git commit -m "feat(requests): create a deposit request and hand over its link and PIN once"
```

---

## Tâche 7 — L'écran de détail

**Fichiers** — Créer : `src/pages/request-detail-page.tsx`, `src/pages/request-detail-page.test.tsx`.
Modifier : `src/app.tsx`.

**Interfaces consommées** — `getRequest`, `regenerateLink`, `revokeLink`, `RequestDetail` (tâche 2) ;
`useResource` (tâche 3) ; `IssuedLinkCard`, `StatusBadge`, `LinkStateBadge`, `ItemRow`,
`LoadingSkeleton`, `ErrorPanel` (tâche 4) ; `safeFileName`, `formatBytes`, `formatDate` (tâche 2).

La page **ne redessine aucune ligne de pièce** : elle calcule
`item.received ? 'received' : 'pending'` et passe la main à `ItemRow`. C'est cette ligne, et elle
seule, que C2 changera.

- [ ] **Étape 1 : écrire les tests**, `src/pages/request-detail-page.test.tsx` :

```tsx
// The open point B4 left, and the reason this test exists: originalName is
// supplied by an anonymous client. React escapes HTML, it does not neutralise
// U+202E -- which reverses the text after it and turns ".exe" into ".pdf" on
// screen.
it('strips the bidirectional override from a deposited file name', async () => {
  stubFetch(jsonResponse(detail({ items: [received('facture‮fdp.exe')] })))
  renderDetail()
  expect(await screen.findByText('facturefdp.exe')).toBeInTheDocument()
  expect(screen.queryByText(/‮/)).not.toBeInTheDocument()
})

it('shows both the status and the link state', async () => { /* … */ })

it('lists expected pieces in the order the API returns them', async () => { /* … */ })

it('shows file metadata for a received piece and "en attente" otherwise', async () => { /* … */ })

// Regeneration is the ONLY way back to a link in clear, so it must show it the
// same way the creation does -- warning included.
it('shows the new link and PIN after regenerating', async () => {
  const fetchMock = stubSequence([detailResponse, issuedResponse, detailResponse])
  renderDetail()
  await userEvent.click(await screen.findByRole('button', { name: /regenerer/i }))
  await userEvent.click(screen.getByRole('button', { name: /confirmer/i }))
  expect(await screen.findByDisplayValue(/depot\/newtoken/)).toBeInTheDocument()
  expect(screen.getByText(/affiche qu'une fois/i)).toBeInTheDocument()
})

it('asks for confirmation before revoking, and refreshes the state after', async () => {
  const fetchMock = stubSequence([detailResponse, emptyResponse204, revokedDetailResponse])
  renderDetail()
  await userEvent.click(await screen.findByRole('button', { name: /revoquer/i }))
  await userEvent.click(screen.getByRole('button', { name: /confirmer/i }))
  expect(await screen.findByText(/lien revoque/i)).toBeInTheDocument()
})

it('does not revoke when the confirmation is dismissed', async () => { /* … */ })

it('shows a 404 as "demande introuvable", not as a network error', async () => { /* … */ })
```

- [ ] **Étape 2 : lancer, constater l'échec.**

- [ ] **Étape 3 : écrire l'écran.** La confirmation est un panneau **inline** dans la carte du lien
      (deux boutons `Confirmer` / `Annuler`), pas un `window.confirm` : ce dernier n'est pas
      stylable, jsdom le renvoie `false` par défaut et il ne dit pas *ce que* l'action coûte. Le
      texte de confirmation nomme la conséquence : « Le lien actuel cessera de fonctionner
      immediatement. »

      Après une régénération réussie : afficher `IssuedLinkCard`, **et** appeler `reload()` pour que
      la nouvelle date d'expiration et l'état `active` soient relus du serveur plutôt que devinés.
      Après une révocation : `reload()`, et le bouton `Revoquer` disparaît (`link.state === 'revoked'`).

- [ ] **Étape 4 : brancher la route** `/requests/:id` dans `src/app.tsx`, sous `RequireSession`.
      **Attention à l'ordre** : `/requests/new` doit être déclarée **avant** `/requests/:id`, sinon
      `new` est lu comme un identifiant et l'écran de création devient inatteignable.

- [ ] **Étape 5 : lancer, constater le vert.** `pnpm -C frontend test`.

- [ ] **Étape 6 : vérifier le lint et la compilation.** `pnpm -C frontend lint && pnpm -C frontend build`.

- [ ] **Étape 7 : commit.**

```bash
git add frontend/src/pages/request-detail-page.tsx frontend/src/pages/request-detail-page.test.tsx frontend/src/app.tsx
git commit -m "feat(requests): detail a request, regenerate and revoke its public link"
```

---

## Tâche 8 — Vérification au navigateur, revue et clôture

C'est la tâche qui rattrape ce que jsdom ne voit pas. E1 a laissé trois dérives de charte sous 55
tests verts ; on ne recommence pas.

- [ ] **Étape 1 : monter la pile depuis les sources.**

```bash
./install.sh --from-source
```

Noter les identifiants et le lien de démo que le seed imprime.

- [ ] **Étape 2 : dérouler le parcours au navigateur** sur `http://127.0.0.1:21600`, via Playwright,
      et **relever les valeurs mesurées** (pas des adjectifs) :

  1. Connexion avec le compte de démo → arrivée sur `/dashboard`.
  2. La demande seedée s'affiche : `getComputedStyle` de la pastille de statut →
     `background-color` attendu `rgb(255, 237, 202)`, `color` `rgb(218, 151, 5)`.
  3. Carte : `box-shadow: none`, `border: 1px solid rgb(233, 233, 233)`, `border-radius: 12px`.
  4. Survol du bouton primaire : fond `rgb(247, 246, 255)`, texte `rgb(81, 0, 255)`, contour
     **inset**, et **même gabarit à la même position** avant/après (relever `getBoundingClientRect`).
  5. **Reveal** : recharger avec la fenêtre en haut, vérifier que les cartes hors écran sont à
     `opacity: 0` puis passent à `1` au défilement. Puis forcer `prefers-reduced-motion: reduce`
     (émulation Playwright) et vérifier qu'elles sont **toutes visibles d'emblée**.
  6. Créer une demande de 3 pièces à 14 jours → carte « LIEN GENERE ». Copier le lien, copier le
     PIN, vérifier le contenu du presse-papiers.
  7. Ouvrir le lien copié dans un onglet privé : le SPA doit répondre (route client absente jusqu'à
     C1 — **noter le comportement obtenu**, il alimente C1, et vérifier qu'il ne casse pas).
  8. Détail : régénérer → nouveau lien affiché, ancienne date remplacée. Révoquer → pastille
     `Lien revoque`, bouton `Revoquer` disparu.
  9. Insérer à la main un `UploadedFile` dont `originalName` contient `‮` et vérifier que
     l'écran affiche le nom **assaini** (aucune ligne `UploadedFile` ne peut naître autrement
     avant C2).
  10. **Les trois états, provoqués un par un** : couper le backend
      (`docker compose … stop backend`) et recharger `/dashboard` → encart d'erreur, pas d'état
      vide ; supprimer la demande seedée en base → état vide ; ralentir la réponse (Playwright
      `route.fulfill` différé) → fantômes à la bonne hauteur, et **relever que la page ne saute pas**
      quand les données arrivent (position du premier titre avant/après).
  11. **Densité, à 375 px et à 1440 px** : relever le padding d'une carte, la gouttière de page,
      l'écart entre deux cartes et la taille de police du corps aux deux tailles. Attendu :
      identiques partout **sauf** la gouttière (16 px / 24 px) et la largeur du bouton primaire.
      Aucun débordement horizontal (`document.documentElement.scrollWidth` ≤ `clientWidth`).
      Aucune information présente en 1440 px et absente en 375 px.
  12. **Journal du proxy** : `docker compose … logs proxy | grep depot` → `[redacted]`, jamais le
      jeton en clair.

- [ ] **Étape 3 : réparer ce que la vérification a trouvé**, un commit par correction, en nommant
      la valeur mesurée dans le message.

- [ ] **Étape 4 : revue de code du diff complet** — `superpowers:requesting-code-review`. Chercher
      en particulier : une couleur écrite en dur dans une page, un `originalName` passé dans un
      attribut, un état qui se met à jour après démontage, une route déclarée dans le mauvais ordre.

- [ ] **Étape 5 : compléter `ai-plans/2026-08-10-b5-ecrans-avocat.md`.** Le fichier **existe déjà** :
      c'est ce plan, copié dans le dépôt avant exécution. Y ajouter, à la suite, trois sections —
      **Écarts au plan** (ce qui a été fait autrement, et pourquoi), **Vérification** (les douze
      relevés chiffrés de l'étape 2, valeurs mesurées et non adjectifs), **Revue de code** (les
      findings et ce qu'ils ont corrigé). Ne pas réécrire les sections existantes : le plan tel
      qu'il a été suivi fait partie du livrable.

- [ ] **Étape 6 : mettre à jour `issue_backlog.md`** — cocher les cinq critères de B5, et **écrire
      noir sur blanc** que le « Copier le lien » du kit n'existe pas : le jeton n'est jamais relisible.
      Cocher aussi le reveal dans E1. Noter dans **D5** ce que la campagne navigateur a coûté en
      temps, puisque c'est l'entrée de sa décision. Et ajouter une ligne à **C2** : l'écran avocat
      sait déjà afficher `uploading` et `failed`, il attend seulement que l'API expose
      `UploadedFile.status` — la question ouverte sur le sens de « reçue » reste entière et se
      tranche là-bas.

- [ ] **Étape 7 : mettre à jour `CLAUDE.md`** — une section « Écrans avocat (B5) » : le hook
      `useResource` et sa garde de génération, la carte `IssuedLinkCard` partagée, l'ordre
      `/requests/new` avant `/requests/:id`, le `Reveal` dont le défaut est **visible**,
      l'assainissement de `originalName`, l'échelle d'espacement fermée avec ses deux points de
      rupture, et les deux états d'`ItemRow` que C2 activera (`uploading`, `failed`) en précisant
      que la seule ligne à changer est le calcul de l'état.

- [ ] **Étape 8 : vérification finale.**

```bash
pnpm test && pnpm lint && pnpm -C frontend build
```

- [ ] **Étape 9 : commit.**

```bash
git add issue_backlog.md CLAUDE.md ai-plans/2026-08-10-b5-ecrans-avocat.md
git commit -m "docs(b5): record the lawyer screens, their verification and what the kit could not have"
```

---

## Sécurité — ce que cette issue touche, et ce qu'elle laisse ouvert

### Ce qui protège réellement un dépôt, par ordre de poids

À écrire tel quel au README : la liste est souvent présentée comme quatre protections empilées, et
ce n'est pas exact.

1. **Le jeton de 256 bits non devinable.** C'est *lui* le contrôle d'accès. Rien d'autre n'approche.
2. **L'expiration.** Elle borne la fenêtre sans intervention humaine.
3. **La révocation.** Le seul moyen d'*arrêter* immédiatement un accès. Un lien parti par courriel
   échappe à tout contrôle — transfert, boîte compromise, mauvais destinataire — et « il expirera
   dans douze jours » ne répond pas à ça.
4. **Le hachage au repos.** Le jeton est stocké en **SHA-256**, pas absent de la base : elle en a
   besoin pour retrouver le lien qu'un client présente (on hache ce qui est présenté, on cherche par
   hachage). Un vol de base y trouve 64 caractères hexadécimaux inexploitables.
5. **Le PIN à 4 chiffres.** Le maillon faible, et il faut le chiffrer : 10 000 candidats à 67 ms
   mesurés font ≈ **11 minutes** pour casser **un** PIN hors ligne sur un cœur, quelques secondes en
   parallèle. Le hachage argon2id du PIN est de la défense en profondeur, **pas un rempart**. Ce qui
   rend un vol de base inexploitable est le hachage du **jeton**, pas celui du PIN.

Deux formulations à ne pas laisser dériver :

- **L'affichage unique n'est pas une protection**, c'est la **conséquence** du hachage : on ne
  réaffiche pas ce qu'on ne stocke pas en clair. Et **régénérer n'en est pas une non plus** : c'est
  la réparation que cette conséquence rend nécessaire. Le gain tient en deux mots — *jeton haché* et
  *révocation* ; l'affichage unique et la régénération en sont le **prix ergonomique**, assumé.
- **Le PIN ne protège pas contre qui lit le courriel.** L'avocat collera probablement le lien et le
  PIN dans le même message ; le PIN ne défend alors que contre celui qui trouve l'URL *sans* le
  message. Le dire, plutôt que laisser croire à une double authentification.

Conséquence d'interface, déjà prise dans la maquette : **deux boutons « Copier » séparés, jamais un
seul**, et **pas de `mailto:` prérempli** — les deux pousseraient à réunir les secrets dans un même
courriel.

**Traité ici**

| Risque | Traitement |
|---|---|
| `originalName` hostile (nom fourni par un client anonyme) | Retrait des caractères de contrôle et des surcharges bidirectionnelles, troncature à 80, jamais dans un attribut. Testé sur U+202E. |
| Le PIN affiché une seule fois, perdu par erreur | Avertissement explicite, `CopyField` qui **dit** quand la copie a échoué au lieu de faire croire au succès. |
| Le lien en clair qui traîne | Il n'existe que dans la réponse de création/régénération, jamais stocké dans le state global, jamais dans l'URL du SPA, jamais dans `localStorage`. Un rechargement le perd — c'est voulu. |
| Énumération des demandes d'un autre avocat | Rien à faire côté client : le backend répond **404** et non 403 (B3). L'écran affiche « Demande introuvable », le même message qu'un identifiant inexistant. |
| Révocation par mégarde | Confirmation inline nommant la conséquence. |

**Laissé ouvert, et pourquoi**

- **Aucune CSP** — c'est G4, et elle se pose dans nginx, pas ici. Cette issue **augmente** l'enjeu :
  le SPA affiche désormais un jeton de dépôt en clair, qu'une dépendance compromise pourrait
  exfiltrer. À dire dans le README plutôt qu'à laisser deviner.
- **Le presse-papiers est lisible par toute la page.** Copier le PIN le rend accessible à n'importe
  quel script du document. Mitigé par la même absence de tiers (aucune ressource hors origine,
  mesuré en E1) — et c'est un argument de plus pour G4.
- **Le jeton reste dans le chemin de l'URL** (B3) : masquage nginx en place, `Referrer-Policy:
  no-referrer` en place. Rien de neuf ici.
- **Pas de limitation de débit sur les routes avocat.** Elles sont authentifiées, et A7 a montré
  qu'une limite par IP est inopérante derrière le passthrough SNI. G1 reste par jeton de lien.

---

## Vérification de bout en bout

```bash
pnpm test                      # backend jest + frontend vitest
pnpm lint                      # les deux lints, bloquants
pnpm -C frontend build         # chakra typegen + tsc + vite
./install.sh --from-source     # la pile complete, images construites localement
```

Puis le parcours au navigateur de la tâche 8, avec ses douze relevés chiffrés — dont les trois
états provoqués un par un et la densité mesurée aux deux tailles d'écran.

**Ce que cette vérification ne couvre pas, et qu'il faut dire :** aucun test automatisé ne traverse
nginx ni ne calcule un style. Le rendu de la charte reste vérifié à la main — c'est exactement ce
que D5 doit trancher, et cette issue lui laisse ses constats en entrée plutôt que de préempter le
choix d'outillage.
