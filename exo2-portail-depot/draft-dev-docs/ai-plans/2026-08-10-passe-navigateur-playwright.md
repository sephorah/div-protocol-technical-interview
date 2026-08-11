# Passe navigateur pilotée par Playwright — 10 août 2026

## Pourquoi

Deux endroits du backlog nommaient le même trou. « 512 tests verts ne disent rien du rendu » :
jsdom ne calcule aucun style, et trois défauts de charte étaient déjà passés sous une suite verte.
Et **D5** laissait ouverte la décision entre Vitest en mode navigateur et un bout-en-bout piloté par
navigateur, « qui couvrirait aussi le parcours à travers nginx — aujourd'hui la seule chose
qu'aucun étage de tests ne traverse ».

Périmètre retenu : **une passe jouée, pas une suite versionnée**. Elle n'est donc pas rejouable —
c'est le coût assumé, et D5 reste ouverte sur son volet « décider du moyen ». La liste de contrôle
suivie est `docs/tests-manuels.md`, qui a servi de référence en plus du backlog.

## Comment

Chromium piloté par les outils MCP Playwright, contre la pile de production en marche
(`127.0.0.1:21600`, donc **à travers nginx**). `DOMAIN` étant vide, la pile répond en clair et
`PUBLIC_BASE_URL=http://127.0.0.1:21600` : le lien client émis est directement ouvrable par le
navigateur piloté.

**Le parcours client a été joué dans un contexte navigateur séparé**, créé par
`browser.newContext()`, c'est-à-dire l'équivalent d'une fenêtre privée. `docs/tests-manuels.md`
appelle ce point « le piège qui invalide la moitié des cases » : un onglet ordinaire emporte le
cookie de l'avocat, et l'écran testé n'est plus le parcours anonyme. Le contexte a été vérifié
vierge (zéro cookie) avant chaque parcours.

Fixtures jetables, hors dépôt : un PDF minimal de 193 o, un ELF de 4 ko renommé `.pdf`, un fichier
de 22 020 105 o (au-dessus du plafond de 20 Mio), et un PDF valide de 8 Mo pour observer la
progression.

## Ce qui a été vérifié, avec les valeurs mesurées

### L'inversion au survol — le critère que D5 portait à la main

| | avant | pendant le survol |
|---|---|---|
| fond | `#5100FF` | `#F7F6FF` |
| texte | `#FFFFFF` | `#5100FF` |
| contour | `none` | `#5100FF 0 0 0 1px **inset**` |
| boîte du bouton | 643.69, 565.14 — 152.63 × 40 | **identique** |
| rectangle du libellé | 668.69, 575.14 — 102.63 × 20 | **identique** |

Le libellé ne bouge pas d'un centième de pixel : l'anneau est bien un `box-shadow: inset`, aucune
bordure n'apparaît. C'est la mesure que la vérification manuelle affirmait sans la chiffrer.

### Le parcours, de bout en bout à travers nginx

- `/` redirige vers `/dashboard` puis `/login` pour un visiteur anonyme.
- Connexion avec le compte de démonstration → `/dashboard`.
- Cookies : `portail_auth` (chemin `/`, 15 min) et `portail_refresh` (chemin **`/api/v1/auth`**,
  7 jours), tous deux `HttpOnly`, **sans `Secure`** — correct en HTTP local, et le confinement du
  cookie de rafraîchissement est conforme à la conception.
- Création d'une demande de trois pièces : date d'expiration recalculée juste (10 + 14 = 24 août),
  lien et PIN affichés une fois. **Après rechargement, ni le PIN ni le jeton ne réapparaissent.**
- Écran client, contexte vierge : **zéro requête vers `/auth/`** — la régression que le backlog
  décrit (un visiteur anonyme déclenchant `/auth/me` puis `/auth/refresh`) ne se reproduit pas.
- PIN faux → « Ce lien n'est pas accessible. Il a peut-être expiré ou été révoqué, ou le code saisi
  n'est pas le bon. » Refus **indistinguable**, conforme à C1.

| dépôt | HTTP | écran client | compteur |
|---|---|---|---|
| PDF valide 193 o | **201** | ✓ `piece-valide.pdf · PDF · 193 o` | 1 sur 3 |
| ELF renommé `.pdf` | **415** | ⚠ « Format refusé. PDF, JPG ou PNG uniquement. » | reste 1 sur 3 |
| 22 020 105 o | **413** | ⚠ « Fichier trop volumineux (20 Mo maximum). » | reste 1 sur 3 |

Le refus porte donc sur les magic bytes, pas sur l'extension, et une pièce refusée n'est jamais
comptée reçue. Complété à 3 sur 3, l'écran affiche « Toutes les pièces ont été déposées ».

- **Barre de progression** : débit montant bridé à 150 kio/s par CDP, `aria-valuenow` relevé toutes
  les 500 ms sur un fichier de 8 Mo → **1 → 3 → 30 → 32 → 56 → 58** sur 30 s. C'est une progression
  d'octets réelle, pas une animation.
- Téléchargement de la pièce par l'API, à travers nginx : **SHA-256 identique** à l'octet près
  (`794abaa4…`), `Content-Type: application/pdf`, `Content-Disposition` en RFC 5987.
- Refus anonymes : `401` sur la liste des demandes **et** sur le téléchargement d'une pièce ;
  `403` sur `/api/v1/health` et `/api/v1/metrics` à travers le proxy.

### Rendu, sécurité, densité

- **Zéro violation CSP** sur les six écrans (login, tableau de bord, création, détail, PIN client,
  pièces client), relevées par l'événement `securitypolicyviolation` et non par la console, plus
  fiable. Zéro erreur console hors les 401/415/413 attendus.
- La politique servie sur le portail est bien la stricte (`default-src 'self'`) ; celle qui autorise
  `unsafe-inline`/`unsafe-eval` est confinée à `location /grafana/`.
- **Aucune requête hors origine** : 6 requêtes au chargement, toutes sur `127.0.0.1:21600`, Inter
  servi depuis `/assets/`.
- **Aucun débordement horizontal** à 375 ni à 1440, sur aucun écran, et aucun texte tronqué.
- Densité : les hauteurs de composants sont **identiques** entre 375 et 1440 sur les écrans avocat ;
  seul le retrait latéral passe de 24 px à 16 px. Une exception côté client, ci-dessous.
- Parcours client rejoué **entièrement à 375 px**, dépôt réel compris.
- Journaux : **zéro occurrence** du jeton dans ceux du proxy et du frontend ; toutes les lignes
  `/deposit/` et `/api/v1/public/` affichent `[redacted]`. L'assertion est bien négative.

## Ce que la passe a trouvé

Par gravité. Aucun n'a été corrigé : la passe mesure, la réparation est une décision séparée.

1. **Le téléchargement d'une pièce n'est atteignable par aucun écran.** L'API répond correctement
   (200, octet pour octet), mais l'écran de détail n'offre ni bouton, ni lien, ni la moindre mention
   de téléchargement — ses seuls boutons sont « Se déconnecter », « Régénérer le lien », « Révoquer
   l'accès ». Conséquence : l'avocat ne peut pas récupérer les pièces que son client a déposées,
   ce qui est la finalité du produit. La case A9 de `docs/tests-manuels.md` (« Télécharger la pièce
   déposée depuis l'écran avocat ») ne peut pas être cochée.
2. **`docs/tests-manuels.md` annonce le mauvais violet.** Le document dit `#7B2CFF` (lignes 44 et
   148) ; le thème déclare `#5100FF` (`frontend/src/theme/tokens.ts:5`), le navigateur rend
   `rgb(81, 0, 255)`, et le pixel échantillonné dans `uikit.png` vaut `srgb(81,0,255)`. **C'est le
   document qui a tort.** Un évaluateur qui le suit compare à une couleur que la charte n'utilise
   pas.
3. **Le document annonce `SameSite=Lax`** ; les deux cookies sont posés en `SameSite=Strict`. Plus
   strict, donc sans risque, mais la case telle qu'écrite échoue à la lecture.
4. **Le document affirme que « les tests de recettes de thème ont été retirés ».** Ils sont là :
   `frontend/src/theme/theme.test.ts` et cinq fichiers de recettes (`badge`, `button`, `card`,
   `field`, `pin-digit`).
5. **Accentuation mélangée dans une même phrase, sur l'écran du client.** L'interface est écrite
   sans accents (« Depot echoue », « recu le »), mais les dates et les messages cités du serveur en
   portent : la ligne rendue est « `recu le 10 août 2026` », et la carte affiche « Format refusé »
   à côté de « Depot echoue ». Visible par le client final.
6. **Le pourcentage d'envoi n'est pas affiché.** Le kit UI montre « 62 % » en texte à côté de la
   barre ; l'application ne rend que la barre, la valeur n'existant que dans `aria-valuenow`.
7. **Cibles tactiles sous le minimum WCAG 2.2 AA (24 × 24 px)** : « Gerer le lien → » à **21 px** de
   haut sur chaque carte du tableau de bord, et « ← Retour au tableau de bord » à **18 px**. Les
   boutons (40 px) et les champs (42 px) passent l'AA mais restent sous les 44 px recommandés par
   les guides mobiles.
8. **Une différence de densité entre les deux tailles**, la seule relevée : le bouton de dépôt du
   client fait **190 × 40 à 375 px** contre **156 × 36 à 1440**. Elle va dans le bon sens (cible
   plus grande au doigt), mais elle contredit littéralement « même densité aux deux tailles ».

## Deux fausses pistes, écartées après vérification

Elles sont consignées parce que les rapporter aurait été pire que de les taire.

- **« Le tableau de bord tronque la liste sur mobile. »** Une capture pleine page à 375 px ne
  montrait que 3 cartes sur 8. Le comptage dans le DOM en montre **8 aux deux largeurs** : la
  capture avait été prise avant la fin du rendu.
- **« Il manque la pagination. »** Elle existe (`dashboard-page.tsx`), et ne s'affiche que si
  `totalPages > 1`. Avec 8 demandes pour une page de 20, elle est simplement invisible.

## Hygiène

Les deux liens créés pendant la passe ont été **révoqués** (204) : leur jeton et leur PIN figurent
dans la transcription, destinée à l'export de H3. Le mot de passe du compte de démonstration y
figure aussi, une fois — il est à caviarder, ou à changer.

Les demandes créées (« Dossier Martin, pieces 2026 — passe navigateur », « Passe mobile 375 »)
restent en base avec leurs pièces : elles documentent la passe. Le jeu de démonstration n'a pas été
touché.

## Ce que la passe ne couvre pas

- **Elle n'est pas rejouable.** La prochaine régression de charte repassera sous la suite verte
  comme les trois précédentes.
- **Chromium seul.** Rien n'est dit de Firefox ni de WebKit.
- **HTTPS n'est pas traversé** : `DOMAIN` est vide sur cette machine. Le bloc TLS et la redirection
  depuis le port 80 ne sont pas exercés.
- **Grafana n'a pas été ouvert** : les 11 panneaux et les 4 règles d'alerte de B2 restent à vérifier
  à l'œil.
