import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { LawyersModule } from '../lawyers/lawyers.module';
import { durationToMilliseconds } from '../config/duration';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RefreshTokenService } from './refresh-token.service';

@Module({
  imports: [
    LawyersModule,
    // registerAsync: the synchronous form would have to read process.env
    // directly, bypassing the startup validation.
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
        // In SECONDS: jsonwebtoken types expiresIn as a template literal, which
        // a value read from the environment is not. Going through the parser
        // the cookie already uses beats casting the type away -- the two
        // durations then cannot diverge.
        signOptions: {
          expiresIn:
            durationToMilliseconds(config.getOrThrow<string>('JWT_EXPIRES')) /
            1000,
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    RefreshTokenService,
    // From THIS module because a provider resolves its dependencies where it is
    // declared, and JwtService lives here; APP_GUARD still applies globally.
    // Not app.useGlobalGuards(), which instantiates outside the injection
    // container -- no JwtService, no Reflector.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
  exports: [AuthService],
})
export class AuthModule {}
