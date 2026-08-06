# Lint backend bloquant et démarrage de l'API qui échoue proprement

_2026-08-06_

## Besoin

Suite directe de [`2026-08-06-lint-type-aware-frontend.md`](./2026-08-06-lint-type-aware-frontend.md).
Rendre le frontend bloquant avait inversé l'asymétrie : frontend à 0 warning et bloquant,
backend non bloquant et portant toujours son warning d'origine — `no-floating-promises` sur
le `bootstrap();` du template Nest (`main.ts:8`).

Rendre le backend bloquant supposait de traiter ce warning d'abord.

## Décisions et justifications

**`.catch` plutôt que `void bootstrap()`.** J'avais annoncé « une ligne, `void bootstrap()` ».
C'était le correctif minimal, mais c'est un correctif de linter, pas de code : il satisfait la
règle sans traiter ce qu'elle signale. La promesse jetée est réelle — si le démarrage échoue
(port occupé, module mal câblé, base injoignable plus tard), le rejet devient une
*unhandled rejection* : stack brute, message non qualifié, code de sortie subi.

```ts
bootstrap().catch((err) => {
  console.error("Echec du demarrage de l'API", err);
  process.exit(1);
});
```

Le message est nommé et le code de sortie vaut 1. C'est exactement ce que `restart:
unless-stopped` et `docker compose logs` savent exploiter — sans quoi un conteneur qui ne
démarre pas est un conteneur dont on ne sait pas pourquoi il ne démarre pas.

**`--max-warnings 0` sur eslint.** L'équivalent backend de `--deny-warnings`. Les deux apps
sont maintenant bloquantes, donc `pnpm lint` à la racine échoue au moindre warning des deux
côtés. C'est l'intention : un warning devient du travail à faire, pas une ligne de log.

## Étapes suivies

1. `backend/src/main.ts` : `bootstrap();` → `bootstrap().catch(...)`, avec le commentaire
   expliquant pourquoi ce n'est pas un `void`.
2. `backend/package.json` : ajout de `--max-warnings 0` au script `lint`.
3. Mise à jour de `CLAUDE.md`.

## Vérification

| Test | Résultat |
|---|---|
| `pnpm lint` racine (backend + frontend, tous deux bloquants) | exit 0 |
| `bootstrap();` réintroduit côté backend | `ESLint found too many warnings (maximum: 0)`, exit 1 |
| `pnpm build` | exit 0 |
| `pnpm test` (unitaires) / `test:e2e` | 1/1 et 1/1 |
| **Démarrage avec :3000 déjà occupé** | `Echec du demarrage de l'API Error: listen EADDRINUSE`, **exit 1** |

Le dernier test est celui qui compte : il vérifie le comportement à l'exécution, pas seulement
que le linter se tait.

## Limites connues

- `console.error` plutôt que le `Logger` de Nest : à ce stade du démarrage, l'application n'est
  pas nécessairement construite, donc son logger n'est pas garanti disponible. À revoir le jour
  où une configuration de logs structurés arrive (elle relève de la partie observabilité du
  livrable).
- `app.enableShutdownHooks()` n'est toujours pas posé. `init: true` dans compose donne la
  sortie du processus sur SIGTERM, pas la fin propre des requêtes en vol — distinct de ce
  correctif, et qui comptera au moment où les uploads existeront.
