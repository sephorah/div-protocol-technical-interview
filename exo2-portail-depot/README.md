# Portail dépôt

Un avocat récupère des pièces chez son client sans passer par la messagerie : il crée une demande,
en tire un lien expirable protégé par un code PIN, et suit ce qui arrive. Le client dépose sans
compte.

Déployé sur **https://sephorah-aniambossou.stage2-div.rayan-drissi.com**

---

## Le produit

- L'avocat, authentifié, crée une demande en listant les pièces attendues, génère un lien public et un PIN à 4 chiffres à envoyer au client, suit l'état de chaque dossier (*en attente*, *complète*, *expirée*) et télécharge les pièces reçues.
- Le client, anonyme, ouvre le lien, saisit le PIN et dépose ses pièces.
- **Le lien se gère** : expire (1 à 90 jours), se révoque, se régénère si le lien ou le PIN est perdu.

---

## Démarrage

```bash
./install.sh
```

- **Installe** ce qui manque, jusqu'à `curl` et Docker eux-mêmes, génère les secrets, tire les images publiées et applique les migrations.
- **N'affiche les URLs qu'une fois que le portail répond.** Il imprime alors **les identifiants de démo, le lien client et son PIN** générés durant le lancement du script.
- Pour lancer la version de développement : `pnpm db:up && pnpm dev`.
- **Secrets générés une seule fois** : Postgres ne lit son mot de passe qu'à l'initialisation du volume, les régénérer casserait la pile au second lancement.
- **Fonctionne sur Linux avec bash.**

---

## Architecture

```
navigateur ──▶ nginx (seul port publié) ──┬──▶ frontend  (SPA Vite + React 19 + Chakra v3)
                                          └──▶ backend   (NestJS 11)
                                                  ├──▶ PostgreSQL 17 (Prisma 7)
                                                  └──▶ MinIO (S3)
                                        prometheus ──▶ grafana (sous /grafana/)
```

- **React a été préféré à Next.js** pour sa simplicité et le fait que le référencement SEO n'est pas utile pour cette application.
- **Base PostgreSQL** pour gérer les relations entre les entités et **Prisma ORM** pour le typage strict, son schéma unique et sa gestion des migrations.
- **Argon2id pour le hachage de mots de passe et du PIN** car contrairement à bcrypt, il n'est pas limité à 72 caractères et est "memory-hard" (exige une forte utilisation de la mémoire RAM), ce qui le protège mieux contre les attaques. Recommandé par OWASP.
- **Deux JWT (accès avocat, session client)** signés par deux clés distinctes, plus un jeton de rafraîchissement révocable. L'API refuse de démarrer si les deux clés de signature sont identiques.
- **Toute route est fermée par défaut** : garde global, `@Public()` est la seule sortie.
- **Aucun composant ne contacte de service tiers** : police auto-hébergée, analytics Grafana coupés.
- **Rien ne nomme MinIO** hors de l'endpoint, ce qui permet de migrer facilement vers S3.

---

## Modèle de données

`Lawyer` → `DepositRequest` → (`RequestedItem` → `UploadedFile`, `PublicLink`)

- Le **statut d'une demande** n'est pas stocké en base de données, mais dérivé par une fonction. Mettre à jour constamment une colonne qui dépend de l'horloge serait contraignant en plus de pouvoir donner de faux résultats.
- **`PublicLink` est une table** au lieu d'être dans `DepositRequest` étant donné que l'avocat peut révoquer et régénérer un lien. De plus, cela faciliterait l'implémentation d'un journal d'audit des accès à un lien public.
- **`RequestedItem.position`** existe pour garantir que l'ordre d'affichage des pièces reste le même.

---

## Sécurité

- **Aucun secret en clair, le jeton compris** : SHA-256 pour le jeton et argon2id pour le PIN et le mot de passe.
- **Le lien et le PIN n'existent en clair qu'une fois** : un PIN perdu ne se réaffiche pas, il se remplace, d'où le fait qu'un avocat puisse régénérer un lien.
- **Les quatre refus répondent la même chose** (lien inconnu, révoqué, expiré, PIN faux) afin de ne pas donner d'indice à un attaquant.
- **404 plutôt que 403** sur la ressource d'un autre : un 403 confirmerait son existence, donc permettrait d'énumérer les dossiers d'un autre avocat.
- Le type d'un fichier est validé en lisant les octets.
- L'URL de dépôt contient un jeton qui l'identifie : ce jeton est masqué dans les journaux nginx et `Referrer-Policy: no-referrer` empêche qu'une ressource tierce le reçoive.

---

## Stratégie de tests

| Commande | Ce que ça exerce | Docker |
|---|---|---|
| `pnpm -C backend test` | unités : configuration, statut, hachage, rotation des jetons | non |
| `pnpm -C frontend test` | Vitest + jsdom : client d'API, session, écrans | non |
| `pnpm test:e2e` | l'API entière par HTTP, contre un **vrai PostgreSQL 17** | oui |
| `pnpm test:integration` | `StorageService` contre un **vrai MinIO** | oui |
| `pnpm test:bare-machine` | `./install.sh` sur `ubuntu:24.04` vierge | oui |

- **Expiration du lien** : `backend/src/requests/request-status.spec.ts` et `backend/test/public.e2e-spec.ts`.
- **Vérification du PIN** : `backend/src/public/public.service.spec.ts` et `public.e2e-spec.ts`.
- **Transitions de statut** : `request-status.spec.ts`, `request.types.spec.ts`, `backend/test/dashboard.e2e-spec.ts`.

---

## Observabilité

| Métrique | Ce qui est surveillé |
|---|---|
| `portal_deposits_total{outcome}` | le nombre de fichiers déposés sur la plateforme, pour vérifier si le produit fonctionne bien. |
| `portal_unlock_attempts_total{outcome}` | le nombre de tentatives de déverrouillage d'un lien, afin de détecter les bruteforce. |
| `portal_expired_link_hits_total` | le nombre d'arrivées sur un lien expiré, afin de savoir si la durée de vie d'un lien par défaut est assez longue. |
| `portal_requests_completed_total` | le nombre de dossiers qui aboutissent. |
| `portal_http_request_duration_seconds` | la latence par route, base de toute alerte de disponibilité, pour évaluer l'expérience utilisateur réelle  |

**Quatre alertes :**

- **API injoignable** : `up < 1` pendant 1 min, soit quatre scrapes ratés ; en dessous, chaque mise à jour d'image alerterait pour rien.
- **Échec de dépôt > 10 % sur 5 min, plancher de 5 dépôts** : sans le plancher, un fichier refusé sur trois donne 33 %, donc une alerte critique pour un client qui s'est trompé de fichier.
- **Plus de 20 PIN erronés en 5 min** : un vrai client se trompe une à trois fois ; au-delà on considère que c'est une tentative de bruteforce.
- **Dépendance injoignable** : 503 sur la sonde, qui couvre Postgres et MinIO. Si l'un de ces services n'est plus disponible, l'application ne peut plus fonctionner correctement.

---

## Limites connues

- **Pas de limitation de débit ni de blocage après N PIN erronés** : la force brute est détectée (alerte à 20 échecs) mais pas empêchée.
- **Pas d'antivirus** bien que l'application vérifie le type des fichiers déposés.
- **L'alerte de dépendance ne distingue pas Postgres de MinIO**.
- **Pas d'URL pré-signées** : les fichiers transitent par l'API.
- **Régénérer `.env` sur une machine déjà installée désaccorde les secrets et les volumes** : Postgres ne lit `POSTGRES_PASSWORD` qu'en initialisant un volume vide, donc le backend échoue en `P1000` ; et un `DOMAIN` redevenu vide éteint le HTTPS sans aucun message. Impossible sur une machine vierge, où `.env` et les volumes naissent ensemble. Pour régler le problème, restaurer l'ancien `.env`, ou de réaligner le rôle par `ALTER USER` sans perdre les données.
