import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
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
