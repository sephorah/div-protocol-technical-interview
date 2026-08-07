// Configuration du CLI Prisma (generate, migrate).
//
// Volontairement en JavaScript et non en TypeScript : ce fichier est embarque
// dans l'image de production, ou l'entrypoint lance `prisma migrate deploy`.
// Un prisma.config.ts y exigerait un chargeur TypeScript, que `pnpm prune
// --prod` a justement supprime. Du CJS ordinaire n'a besoin de rien.
const { existsSync } = require('node:fs');
const { resolve } = require('node:path');
const { defineConfig } = require('prisma/config');

// Prisma 7 ne charge plus `.env` automatiquement des lors qu'un fichier de
// configuration existe. Le `.env` du projet vit a la racine du depot, un cran
// au-dessus de backend/ : c'est celui que docker compose lit aussi.
// En conteneur il est absent et les variables viennent de compose — d'ou le
// existsSync, qui evite un avertissement a chaque migration.
const rootEnv = resolve(__dirname, '..', '.env');
if (existsSync(rootEnv)) {
  require('dotenv').config({ path: rootEnv, quiet: true });
}

module.exports = defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    // Pas de valeur de repli : une DATABASE_URL absente doit faire echouer la
    // commande en la nommant, pas viser silencieusement une base par defaut.
    url: process.env.DATABASE_URL ?? '',
  },
});
