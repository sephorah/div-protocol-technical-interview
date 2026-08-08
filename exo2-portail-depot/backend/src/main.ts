import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);

  // Toutes les routes vivent sous API_PREFIX (/api/v1). Attention : nginx ne
  // doit alors PAS retirer le prefixe — un `proxy_pass` avec barre finale
  // remplace la partie deja consommee et transformerait /api/v1/x en /x.
  app.setGlobalPrefix(config.getOrThrow<string>('API_PREFIX'));

  // Sans ce branchement, Nest n'appelle JAMAIS onModuleDestroy sur SIGTERM :
  // le $disconnect() de Prisma ne s'execute pas et les connexions restent
  // ouvertes cote Postgres jusqu'a leur expiration. `init: true` dans compose
  // garantit que le signal arrive au processus ; c'est cette ligne qui
  // garantit qu'il sert a quelque chose.
  app.enableShutdownHooks();

  // Deux arguments, et les deux comptent :
  //
  // - getOrThrow et non `?? 3000` : la machine est partagee et seule la plage
  //   21600-21699 nous est attribuee. Un repli en dur ferait ecouter l'API hors
  //   de cette plage sans que rien ne le signale.
  // - l'adresse est explicite : `app.listen(port)` ecoute sur 0.0.0.0. Sur la
  //   machine de staging, l'API serait alors joignable par tous, court-circuitant
  //   le proxy — donc la seule chose qui protege /health et limite la taille des
  //   requetes. En conteneur la valeur est 0.0.0.0, ce qui est sans risque : le
  //   reseau y est isole et aucun port n'est publie.
  await app.listen(
    config.getOrThrow<number>('PORT'),
    config.getOrThrow<string>('BIND_ADDRESS'),
  );
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
