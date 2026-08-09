import {
  Controller,
  Get,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Public } from '../auth/public.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';

export enum HealthStatus {
  Ok = 'ok',
  Error = 'error',
}

export enum HealthState {
  Up = 'up',
  Down = 'down',
}

export interface HealthReport {
  status: HealthStatus;
  db: HealthState;
  storage: HealthState;
}

/**
 * API health probe.
 *
 * It performs a real SQL round-trip and a real call to the object storage, not
 * an object inspection: an instantiated service proves nothing, both
 * connections are lazy. A probe answering 200 while nothing can be stored would
 * be worse than no probe at all -- this is what the docker `healthcheck`
 * consumes, and later the Grafana alerts (F2).
 */
// @Public() on the whole controller: the probe's callers hold no session and
// never will -- the backend's own docker healthcheck, and Prometheus later
// (F1). Behind the global guard it would answer 401, docker would declare the
// container unhealthy, and it would restart in a loop. What keeps the probe
// from being public on the INTERNET is a different mechanism entirely: the
// `deny all` rule in infra/nginx/portal-locations.conf.
@Public()
@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  @Get()
  async check(): Promise<HealthReport> {
    // Both checks always run, even when the first one fails: a report naming
    // only the database would send whoever reads it after one of the two
    // problems.
    const [db, storage] = await Promise.all([
      this.checkDatabase(),
      this.storage.ping(),
    ]);

    const report: HealthReport = {
      status: db && storage ? HealthStatus.Ok : HealthStatus.Error,
      db: db ? HealthState.Up : HealthState.Down,
      storage: storage ? HealthState.Up : HealthState.Down,
    };

    if (report.status === HealthStatus.Error) {
      throw new ServiceUnavailableException(report);
    }

    return report;
  }

  private async checkDatabase(): Promise<boolean> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return true;
    } catch (error) {
      // Log the real cause server-side, but do not return it to the client:
      // a Postgres driver error message contains the host, the port, the
      // database and sometimes the user.
      this.logger.error('Health probe: the database is unreachable', error);
      return false;
    }
  }
}
