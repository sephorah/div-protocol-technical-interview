import { join } from 'node:path';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { validateEnv } from './config/env.validation';
import { HealthModule } from './health/health.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // `.env` vit a la racine du depot, un cran au-dessus de backend/ :
      // c'est le meme fichier que lit docker compose, pour qu'il n'existe
      // qu'une seule source de verite. En conteneur il est absent et les
      // variables viennent de l'environnement, ce que ConfigModule gere.
      //
      // Chemin derive de __dirname et non du repertoire courant : un
      // `../.env` relatif designe le parent du cwd, donc le parent du depot
      // des que l'API est lancee depuis la racine plutot que depuis backend/.
      // L'API refusait alors de demarrer sur « DATABASE_URL absente » avec le
      // fichier juste a cote. __dirname vaut backend/src en developpement et
      // backend/dist une fois compile : deux crans menent a la racine dans
      // les deux cas.
      envFilePath: [join(__dirname, '..', '..', '.env')],
      validate: validateEnv,
    }),
    PrismaModule,
    HealthModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
