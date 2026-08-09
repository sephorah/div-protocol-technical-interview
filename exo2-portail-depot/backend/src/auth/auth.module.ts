import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { LawyersModule } from '../lawyers/lawyers.module';
import { durationToMilliseconds } from './auth-cookie';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';

@Module({
  imports: [
    LawyersModule,
    // registerAsync, because the secret comes from the configuration and
    // ConfigService is only available through injection. The synchronous form
    // would have to read process.env directly, bypassing the startup
    // validation.
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
        // Configured once here: every token signed by this module carries the
        // same lifetime, and no call site can forget it.
        //
        // Passed in SECONDS rather than as the "2h" string: jsonwebtoken types
        // expiresIn as a template literal it recognises, which a value read
        // from the environment is not. Converting through the same parser the
        // cookie uses is better than casting the type away -- the two durations
        // then cannot diverge, and an unparseable value fails here at startup
        // rather than producing a token with no expiry.
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
    // Registered from THIS module and not from AppModule, deliberately: a
    // provider resolves its dependencies in the module that declares it, and
    // JwtService lives here. Registered as APP_GUARD it applies to the whole
    // application all the same.
    //
    // And APP_GUARD rather than app.useGlobalGuards(), which is not a matter of
    // taste: a guard registered that way is instantiated outside the injection
    // container and would receive neither JwtService nor Reflector.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
  exports: [AuthService],
})
export class AuthModule {}
