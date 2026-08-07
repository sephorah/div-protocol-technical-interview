import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Sans ce branchement, Nest n'appelle JAMAIS onModuleDestroy sur SIGTERM :
  // le $disconnect() de Prisma ne s'execute pas et les connexions restent
  // ouvertes cote Postgres jusqu'a leur expiration. `init: true` dans compose
  // garantit que le signal arrive au processus ; c'est cette ligne qui
  // garantit qu'il sert a quelque chose.
  app.enableShutdownHooks();

  await app.listen(process.env.PORT ?? 3000);
}
// Pas de `void bootstrap()` : ca ferait taire la regle sans rien traiter. Un
// echec au demarrage (port occupe, module mal cable) sortirait alors en
// unhandled rejection, avec une stack brute et un code de sortie subi. Ici le
// message est explicite et le code de sortie vaut 1 — ce que `restart:
// unless-stopped` et les logs de `docker compose` savent exploiter.
bootstrap().catch((err) => {
  console.error("Echec du demarrage de l'API", err);
  process.exit(1);
});
