import { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { PG_CONTAINER_KEY } from './global-setup';

export default async (): Promise<void> => {
  const container = (globalThis as Record<string, unknown>)[
    PG_CONTAINER_KEY
  ] as StartedPostgreSqlContainer | undefined;
  // Absent when globalSetup itself failed: stopping nothing must not bury the
  // real error under a second one.
  await container?.stop();
};
