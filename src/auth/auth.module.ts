import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RolesGuard } from './roles.guard';
import { OptionalJwtAuthGuard } from './optional-jwt-auth.guard';

/**
 * Kimlik doğrulama altyapısı.
 *
 * @Global(): guard birden çok özellik modülünde kullanılır; her birinde
 * AuthModule'ü tekrar import etmek yerine tek yerden sağlanır.
 *
 * Kasıtlı olarak Passport kullanılmadı — tek bir HMAC doğrulaması için
 * strateji/serializer katmanı taşıma maliyeti olurdu.
 */
@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
        signOptions: { expiresIn: '7d' },
      }),
    }),
  ],
  providers: [JwtAuthGuard, RolesGuard, OptionalJwtAuthGuard],
  exports: [JwtAuthGuard, RolesGuard, OptionalJwtAuthGuard, JwtModule],
})
export class AuthModule {}
