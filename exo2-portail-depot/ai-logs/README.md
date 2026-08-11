# Journaux de sessions IA

Les transcriptions des sessions Claude Code qui ont produit ce projet, exportées avec `/export`.
Le raisonnement mis au propre vit dans `ai-plans/` — un fichier par feature, avec le plan suivi, les
décisions et la relecture. Ce dossier-ci garde la trace brute : chaque essai, chaque impasse, chaque
correction demandée.

## Caviardage

Trois valeurs ont été remplacées avant publication. Elles sont signalées en clair dans le texte, pour
qu'un lecteur qui tombe dessus sache que c'est une substitution volontaire et pas un artefact
d'export :

| Remplacé par | Ce que c'était | Où |
|---|---|---|
| `JETON-CAVIARDE-43-CARACTERES-BASE64URL-xxxx` | un vrai jeton de lien de dépôt, produit contre la base de développement | `issue-B3.txt` |
| `candidat@exemple-caviarde.test` | l'adresse personnelle du compte Claude, affichée par la bannière d'accueil | `fix-dev-version.txt`, `div-theme-missing-components.txt`, `redactor-ai-logs.txt`, `remove-metrics.txt` |

Dans `remove-metrics.txt` l'adresse n'était pas dans une bannière : la session auditait les journaux
et **nommait en clair** l'adresse qu'elle demandait de remplacer ailleurs. Un caviardage qui se cite
lui-même reste un caviardage à faire.

Les substitutions font **exactement la longueur** de ce qu'elles remplacent : ces fichiers sont des
rendus de terminal, où des boîtes et des accolades s'alignent sur le texte.

Vérifié avant publication : aucune valeur du `.env` (mots de passe, `JWT_SECRET`, clés de stockage,
mot de passe Grafana) n'apparaît dans ce dossier, recherchée littéralement. Pas de `cat .env`, pas de
bannière du seed avec ses identifiants, pas de jeton JWT, pas de clé SSH ni de jeton d'API.

Le format machine des exports (`*.jsonl`) n'est pas versionné — signatures internes, identifiants de
requête, comptes de jetons. Le `.md` à côté est la même session, lisible.

## Quelle session pour quelle issue

| Fichier | Sujet |
|---|---|
| `2026-08-06-145032-…txt`, `2026-08-06-153058-…txt`, `2026-08-06-78a7f925-….md` | La première session : cadrage, échafaudage, `install.sh` |
| `2026-08-06-lint-backend-bloquant.txt` | Rendre le lint bloquant des deux côtés |
| `issue_backlog.txt`, `issue_backlog2.txt` | Le backlog dérivé de l'énoncé |
| `issue-A1.txt` | A1 — persistance PostgreSQL + Prisma |
| `issue-A2.txt` | A2 — modèle de données et primitives de chiffrement |
| `issue-A3-bis.txt` | A3 — stockage objet MinIO |
| `issue-A4.txt` | A4 — secrets externalisés |
| `issue-A5.txt` | A5 — réorganisation de `infra/` |
| `issue-A6.txt` | A6 — images construites et publiées sur GHCR |
| `issue-A7.txt` | A7 — HTTPS Let's Encrypt |
| `issue-A8-part1.txt`, `issue-A8-part2.txt` | A8 — installation en un clic sur machine vierge |
| `auth.txt` | Cadrage de l'authentification, à partir d'un projet antérieur |
| `issue-B1-auth-complete.txt` | B1 — authentification avocat et jetons de rafraîchissement |
| `issue-b2.txt` | B2 — création d'une demande de dépôt |
| `issue-B3.txt` | B3 — lien public, PIN, expiration |
| `issue-B4-conception.txt` | B4 — récapitulatif de B3, puis la forme des routes de lecture |
| `issue-B4.txt` | B4 — dashboard, et la charte avant les écrans |
| `issue-B5.txt` | B5 — écrans avocat |
| `final-sprint.txt`, `test-final-sprint.txt` | Le sprint final mené par agents parallèles, puis sa recette |
| `nettoyage-tests-commentaires.txt` | Élagage des tests et des commentaires, prose déplacée vers `docs/` |
| `remove-metrics.txt` | Réécriture du README d'après les consignes, retrait de métriques, et l'audit de caviardage de ce dossier |
| `div-theme-missing-components.txt`, `fix-buttons.txt` | Écarts à la charte relevés en testant l'application |
| `grafana.txt` | Recette de Prometheus et Grafana |
| `fix-dev-version.txt` | Un `ECONNREFUSED` en développement |
| `update-repo.txt` | Publication : push, tag GitHub, mise à jour de `.env.example` |
| `worktree.txt` | Comment paralléliser le travail avec des worktrees git |
| `ai-usage-eval.txt` | Relecture de ces journaux : qui pilote qui |

## Deux journaux réexportés après coup

`/export` écrase un fichier existant sans prévenir, et deux exports ont visé un nom déjà pris :
`issue-A6.txt` était parti dans `issue-A7.txt`, écrasé le soir même par la session A7 elle-même, et
la conception de B4 dans `issue-B4.txt`, écrasée par son implémentation. Les deux ont été retrouvées
dans les transcriptions locales et réexportées sous leur nom propre — d'où leur horodatage plus
tardif que celui des sessions qu'elles relatent.

Les sessions restées dehors ne portent rien de livrable : installation de plugins, dépannage système
hors sujet, questions d'outillage.
