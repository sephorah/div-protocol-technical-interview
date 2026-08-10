# Portail dépôt

Un avocat monte un dossier et doit récupérer des pièces chez son client. Aujourd'hui cela se passe
par courriel, en pièces jointes, sans traçabilité. Ce portail remplace ça.

**Côté avocat** (authentifié) : il crée une demande de dépôt, génère un lien public expirable protégé
par un code PIN, l'envoie à son client, et suit dans un tableau de bord l'état de chaque demande — en
attente, complète, expirée.
**Côté client** (anonyme) : il ouvre le lien sans compte, saisit le PIN, dépose ses pièces et voit sa
progression.

Déployé sur https://sephorah-aniambossou.stage2-div.rayan-drissi.com

---

## Démarrage

```bash
./install.sh
```

C'est tout. Le script installe ce qui manque — jusqu'à `curl` et Docker eux-mêmes — génère la
configuration et ses secrets, **tire les images publiées**, monte la pile, applique les migrations,
et n'affiche les URLs qu'une fois que **le portail répond**. Il imprime alors les identifiants de
démonstration, le lien client et son PIN.

Le portail est sur **http://127.0.0.1:21600**, Grafana sur **/grafana/**.

| Situation | Durée mesurée |
|---|---|
| machine nue, installation de Docker comprise | ~2 min |
| Docker présent, images à tirer | 35 s |
| tout en cache | 15 s |

Ce parcours est rejouable en une commande : `pnpm test:bare-machine` le refait dans un conteneur
`ubuntu:24.04` où **rien** n'est préinstallé, et vérifie que le portail répond vraiment à la fin.

Les secrets sont générés **une seule fois**, au premier lancement : les régénérer casserait la base
au second passage. **Systèmes couverts : Linux avec bash** ; macOS et Alpine ne le sont pas, et le
script ne prétend pas le contraire.

HTTPS s'active en renseignant `DOMAIN` dans `.env`, **jamais par un drapeau** : un drapeau devrait
être retapé à chaque redéploiement, et l'oublier une fois ferait retomber le portail en clair sans
bruit. → `docs/exploitation.md`

Le développement au quotidien n'utilise pas ce script : `pnpm db:up && pnpm dev`.

---

## Architecture, en une page

```
navigateur ──▶ nginx (seul port publié) ──┬──▶ frontend  (SPA Vite + React 19 + Chakra v3)
                                          └──▶ backend   (NestJS 11)
                                                  ├──▶ PostgreSQL 17 (Prisma 7)
                                                  └──▶ MinIO (S3)
                                        prometheus ──▶ grafana (sous /grafana/)
```

nginx est le **seul point d'entrée publié**, sur `127.0.0.1` uniquement — la machine est partagée
avec d'autres candidats, et un bind sur `0.0.0.0` exposerait tout le portail, base comprise via
`/api`. Frontend et API étant servis depuis la même origine, **il n'y a aucun CORS à configurer**.

**Délibérément pas de Next.js.** NestJS fournit déjà l'étage serveur ; Next ajouterait un second
runtime Node dont le seul vrai travail serait de relayer. Le rendu côté serveur et le référencement
sont d'ailleurs indésirables : c'est un portail privé qui ne doit pas être indexé. Le SPA se compile
en fichiers statiques, et il reste **un seul processus applicatif** à exploiter. Ce que ça coûte : un
premier affichage qui attend le JavaScript — sans conséquence à quelques visites par dossier.

**Deux populations, deux sessions, deux clés.** L'avocat a un JWT court (15 min) dans un cookie
httpOnly, plus un jeton de rafraîchissement opaque, tourné à chaque usage, révocable. Le client
anonyme a une session de dépôt signée par une **clé différente** — l'API refuse de démarrer si les
deux sont égales, sans quoi un jeton de dépôt présenté au garde avocat passerait la vérification de
signature (RFC 8725 § 3.8).

**Toute route est fermée par défaut** : le garde est global, `@Public()` est la seule sortie, donc un
nouveau contrôleur naît protégé.

**Aucun composant ne contacte de tiers** : la police est auto-hébergée, Grafana a ses analytics et
son préchargement de greffons coupés. Sur un produit dont l'argument est la traçabilité d'un dossier,
c'est une position, pas un détail.

→ Le détail et les options écartées : **`docs/architecture.md`**
→ Le déploiement, le proxy, TLS, le registre d'images : **`docs/exploitation.md`**

---

## Modèle de données

Cinq entités : `Lawyer` → `DepositRequest` → (`RequestedItem` → `UploadedFile`, `PublicLink`).

Quatre décisions ne se devinent pas en lisant les champs :

- **Le statut n'est pas une colonne.** « Expirée » dépend de l'horloge : une colonne serait fausse
  entre l'instant d'échéance et le passage d'un travail de fond, et le tableau de bord mentirait. Il
  est dérivé à la lecture — tout reçu → *complète*, sinon échéance dépassée → *expirée*, sinon *en
  attente*. **Une demande complète le reste après la date limite** : un dossier abouti ne doit pas
  ressembler à un dossier abandonné. Le statut décrit le dossier, le lien décrit l'accès : un lien
  expiré reste fermé même sur une demande complète.
- **`PublicLink` est une table, pas trois colonnes.** Régénérer, c'est révoquer puis insérer, donc un
  ancien PIN ne peut structurellement pas survivre. L'invariant tient à un **index unique partiel
  écrit à la main** dans la migration — Prisma ne sait pas exprimer un index conditionnel.
- **Aucun secret n'est stocké en clair, le jeton compris** : SHA-256 pour le jeton (256 bits ne se
  devinent pas, et un hachage rapide reste indexable), argon2id aux paramètres OWASP pour le PIN et
  le mot de passe. Conséquence : **le lien et le PIN n'existent en clair qu'une fois**, et un PIN
  perdu ne se réaffiche pas, il se **remplace**.
- **`RequestedItem.position` existe parce que `createdAt` ne peut pas ordonner** : les pièces d'une
  demande partagent leur horodatage à la milliseconde, et la liste du client se réordonnerait entre
  deux chargements.

---

## Stratégie de tests

**Le critère de conservation, appliqué dans cet ordre.** Un test ne reste que s'il peut échouer à
cause d'un changement plausible de *notre* code. Si la même règle est déjà affirmée à une autre
couche, on n'en garde qu'une — celle qui traverse le plus de code réel. **La sécurité ne s'élague
pas**, y compris en double si les deux couches testent des choses différentes.

| Commande | Ce que ça exerce | Docker | Mesuré |
|---|---|---|---|
| `pnpm -C backend test` | unités : validation de configuration, statut, primitives de hachage, rotation des jetons | non | 3 s — 239 cas |
| `pnpm -C frontend test` | Vitest + jsdom : client d'API, session, écrans | non | 12 s — 112 cas |
| `pnpm test:e2e` | l'API entière par HTTP, contre un **vrai PostgreSQL 17** | oui | 18 s — 98 cas |
| `pnpm test:integration` | `StorageService` contre un **vrai MinIO**, sous la policy restreinte | oui | 5 s — 10 cas |
| `pnpm test:bare-machine` | `./install.sh` sur `ubuntu:24.04` où rien n'est préinstallé | oui | ~2 min |

Les trois sujets que l'énoncé nomme :

- **expiration du lien** — `backend/src/requests/request-status.spec.ts` (la borne stricte : à
  l'instant exact de l'échéance le lien fonctionne encore) et le cas « dies as soon as the link
  expires » de `backend/test/public.e2e-spec.ts` ;
- **vérification du PIN** — le bloc *unlock* de `backend/src/public/public.service.spec.ts` et
  `backend/test/public.e2e-spec.ts` : les quatre refus (lien inconnu, révoqué, expiré, PIN faux)
  répondent la **même** chose, et le PIN est vérifié contre un hachage-leurre même quand le lien
  n'existe pas — sinon l'écart de temps redonnerait l'oracle que le message unique venait de retirer ;
- **transitions de statut** — `request-status.spec.ts` et `request.types.spec.ts` pour la règle,
  `dashboard.e2e-spec.ts` pour un cas de bout en bout qui prouve que la sélection SQL alimente bien
  la dérivation.

**Pourquoi une vraie base pour les e2e.** La doublure de Prisma écrite à la main ne pouvait rien
prouver : son `$transaction` n'annulait rien, et le test du 409 vérifiait qu'on traduisait une erreur
simulée, pas que la contrainte existe. Trois tests n'existent que grâce à la vraie base — l'index
refusant un second lien actif, ce même index acceptant les liens révoqués à côté, et la cascade. Le
premier a été vérifié de la seule façon qui vaille : en supprimant l'index de la migration, en
regardant ce test précis tomber, puis en restaurant. Ce que ça coûte, dit franchement : Docker
devient nécessaire, et la suite passe de 8,5 s à 18 s.

**Vitest côté frontend et pas Jest** : Vitest relit `vite.config.ts`, et Chakra v3 comme Ark UI ne
sont livrés qu'en modules ES — Jest demanderait une liste d'exceptions de transformation à maintenir.

### Ce qui n'est vérifié qu'au navigateur, et qu'il faut dire

**jsdom ne calcule aucun style.** Il dit qu'un bouton existe, jamais qu'il est violet, ni qu'il
s'inverse au survol, ni que la densité tient sur mobile. Trois défauts de la charte sont passés au
travers de tests verts et n'ont été vus qu'au navigateur.

Les 35 cas du dossier `theme/` ont donc été **supprimés** : ils relisaient des jetons de style et
donnaient l'illusion de couvrir la charte. Deux ont été gardés, parce qu'ils portent un vrai piège
Chakra ou de l'accessibilité. La charte n'est vérifiée **que** par la passe navigateur, et
`docs/tests-manuels.md § B3` est la seule chose qui la décrive.

**Aucun test ne traverse nginx** : le parcours réel reste `./install.sh` puis
`docs/tests-manuels.md`, déroulé à la main.

---

## Observabilité

Sept métriques métier, **une question d'exploitation chacune** — une métrique sur laquelle personne
ne peut agir est une série à stocker pour toujours.

| Métrique | La question à laquelle elle répond |
|---|---|
| `portal_deposits_total{outcome}` | le produit fait-il son seul travail ? |
| `portal_unlock_attempts_total{outcome}` | une pointe de `failure` est la signature d'une force brute sur le PIN |
| `portal_expired_link_hits_total` | la durée de vie par défaut d'un lien est-elle trop courte ? |
| `portal_upload_bytes` | dimensionne le bucket ; une distribution qui se décale, c'est un abus |
| `portal_requests_completed_total` | combien de **dossiers** aboutissent — les autres comptent des fichiers |
| `portal_rejected_upload_bytes` | de **combien** les fichiers refusés dépassent, donc si 20 Mio est le bon plafond |
| `portal_http_request_duration_seconds` | la latence par route, base de toute alerte de disponibilité |

Quatre alertes provisionnées : API injoignable, taux d'échec de dépôt > 10 % (avec un plancher de
5 dépôts, sans lequel un seul fichier refusé sur trois donnerait 33 %), plus de 20 PIN erronés en
5 min, dépendance injoignable. `/api/v1/metrics` est en `deny all` derrière nginx : publié, il dirait
à qui scanne quand frapper.

→ Les seuils, leur justification et le **runbook** : **`docs/observabilite.md`**

---

## Limites connues

Sans euphémisme.

- **Pas de limitation de débit sur le PIN.** Une force brute est **détectée** (l'alerte à 20 échecs
  en 5 min) mais **pas empêchée** : ce qui borne le débit d'un attaquant est le coût d'argon2id,
  67 ms par essai. Une limite par IP serait ici une limite globale — derrière le passthrough SNI de
  la machine, toutes les requêtes portent la même adresse, et un attaquant enfermerait l'avocat
  dehors.
- **Pas d'antivirus.** La vérification de type est livrée (octets magiques, trois formats, 20 Mio) ;
  l'antivirus, l'autre moitié de ce bonus de l'énoncé, ne l'est pas.
- **`style-src 'unsafe-inline'`** est imposé par Chakra v3, qui injecte ses règles à l'exécution. La
  CSP borne donc l'exfiltration, **pas** la manipulation visuelle (surcouche qui déguise un bouton,
  faux formulaire de PIN).
- **Les alertes sont visibles, pas poussées** : la machine n'a pas de SMTP, et pointer vers un
  destinataire injoignable donnerait l'illusion d'une notification.
- **L'alerte de dépendance ne distingue pas Postgres de MinIO** : il faut lire le corps de la sonde.
- **La métrique de dépassement ne voit que 20 → 25 Mo** : nginx refuse au-delà, sur l'en-tête, avant
  que le backend ne voie la requête. On échange l'information contre la robustesse, en connaissance
  de cause.
- **`linux/amd64` uniquement** : émuler arm64 sous QEMU pour compiler `argon2` ferait passer le job
  de ~3 min à ~15 min, pour une plateforme sur laquelle personne ne déploie ici.
- **La production épingle un tag, qui est mutable** — seul un digest identifie un contenu.
- **Les URL pré-signées sont la voie de montée en charge, et elles ont été écartées** : elles
  mettraient un **second** justificatif d'accès dans une URL, donc une seconde règle de masquage dans
  les journaux — la protection dont l'échec est silencieux. Aujourd'hui les fichiers transitent par
  l'API, en flux, sans jamais toucher son disque.
- **`ai-logs/` n'est pas caviardé** ligne à ligne, et doit l'être avant le rendu.
- **Densité mobile** (E2) : ouverte, et vérifiable seulement au navigateur.

---

## Documentation

| Fichier | Contenu |
|---|---|
| `docs/architecture.md` | les choix backend / frontend / données, et ce qu'on a écarté |
| `docs/exploitation.md` | `install.sh`, compose, reverse proxy, TLS, registre d'images, pièges de déploiement |
| `docs/observabilite.md` | métriques, alertes, seuils, runbook |
| `docs/tests-manuels.md` | la recette : critères obligatoires et attendus, une commande par case |
| `issue_backlog.md` | le backlog dérivé de l'énoncé, et ce qui a été coupé |
| `ai-plans/` | un plan daté par fonctionnalité : décisions, vérifications, relecture |
