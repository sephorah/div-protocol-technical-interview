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
 * API health probe.
 *
 * It performs a real SQL round-trip, not an object inspection: an instantiated
 * PrismaService proves nothing, the connection is lazy. A probe answering 200
 * with a downed database would be worse than no probe at all -- this is what
 * the docker `healthcheck` consumes, and later the Grafana alerts (F2).
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
      // Log the real cause server-side, but do not return it to the client:
      // a Postgres driver error message contains the host, the port, the
      // database and sometimes the user.
      this.logger.error('Health probe: the database is unreachable', error);
      throw new ServiceUnavailableException({
        status: 'error',
        db: 'down',
      } satisfies HealthReport);
    }

    return { status: 'ok', db: 'up' };
  }
}
