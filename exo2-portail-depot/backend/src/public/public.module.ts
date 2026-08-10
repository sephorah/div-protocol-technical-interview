import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { RequestsModule } from '../requests/requests.module';
import { CLIENT_SESSION_TTL_MS } from './client-session';
import { ClientSessionGuard } from './client-session.guard';
import { DepositsService } from './deposits.service';
import { PublicController } from './public.controller';
import { PublicService } from './public.service';

/**
 * The anonymous client's module. PrismaService is @Global, hence no import.
 *
 * The JwtModule registered HERE is what makes the two session types
 * cryptographically distinct: it is module-scoped, so PublicController and
 * ClientSessionGuard resolve this JwtService and not AuthModule's. Importing
 * AuthModule's instead would leave CLIENT_JWT_SECRET configured and unused,
 * with nothing to say so.
 */
@Module({
  imports: [
    RequestsModule,
    // registerAsync: the synchronous form would have to read process.env
    // directly, bypassing the startup validation.
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('CLIENT_JWT_SECRET'),
        // In SECONDS, from the constant the cookie's Max-Age also uses: the
        // token and the cookie then cannot expire at different moments.
        signOptions: { expiresIn: CLIENT_SESSION_TTL_MS / 1000 },
      }),
    }),
  ],
  controllers: [PublicController],
  // StorageService is @Global like PrismaService, hence no StorageModule import.
  providers: [PublicService, DepositsService, ClientSessionGuard],
})
export class PublicModule {}
