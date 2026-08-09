import { join } from 'node:path';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module';
import { validateEnv } from './config/env.validation';
import { HealthModule } from './health/health.module';
import { LawyersModule } from './lawyers/lawyers.module';
import { PrismaModule } from './prisma/prisma.module';
import { RequestsModule } from './requests/requests.module';
import { StorageModule } from './storage/storage.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // `.env` lives at the repository root, one level above backend/: it is
      // the very file docker compose reads, so that a single source of truth
      // exists. In the container it is absent and the variables come from the
      // environment, which ConfigModule handles.
      //
      // The path derives from __dirname, not from the working directory: a
      // relative `../.env` means the parent of the cwd, hence the parent of the
      // repository as soon as the API is started from the root rather than from
      // backend/. The API then refused to start on "DATABASE_URL missing" with
      // the file sitting right next to it. __dirname is backend/src in
      // development and backend/dist once compiled: two levels up reaches the
      // root either way.
      envFilePath: [join(__dirname, '..', '..', '.env')],
      validate: validateEnv,
    }),
    PrismaModule,
    StorageModule,
    HealthModule,
    LawyersModule,
    // Carries the global authentication guard (APP_GUARD): importing it makes
    // EVERY route of the application protected by default, @Public() being the
    // only way out. A new controller is therefore born closed.
    AuthModule,
    RequestsModule,
  ],
})
export class AppModule {}
