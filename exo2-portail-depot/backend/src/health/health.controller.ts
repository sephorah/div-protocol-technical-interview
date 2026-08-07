import {
  Controller,
  Get,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface HealthReport {
  status: 'ok' | 'error';
  db: 'up' | 'down';
}

/**
 * Sonde de sante de l'API.
 *
 * Elle execute un vrai aller-retour SQL, pas une inspection d'objet : un
 * PrismaService instancie ne prouve rien, la connexion est paresseuse. Une
 * sonde qui repondrait 200 avec une base tombee serait pire qu'absente —
 * c'est elle que consomment le `healthcheck` docker et, plus tard, les
 * alertes Grafana (F2).
 */
@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async check(): Promise<HealthReport> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch (error) {
      // Journalise la cause reelle cote serveur, mais ne la renvoie pas au
      // client : le message d'erreur d'un driver Postgres contient l'hote,
      // le port, la base et parfois l'utilisateur.
      this.logger.error('Sonde de sante : la base est injoignable', error);
      throw new ServiceUnavailableException({
        status: 'error',
        db: 'down',
      } satisfies HealthReport);
    }

    return { status: 'ok', db: 'up' };
  }
}
