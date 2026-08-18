import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { ScheduleModule } from '@nestjs/schedule';
import { HealthModule } from './health/health.module';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { AuthModule } from './auth/auth.module';
import { LeaderboardModule } from './leaderboard/leaderboard.module';
import { RewardsModule } from './rewards/rewards.module';
import { IdentityModule } from './auth/identity.module';
import { PlayersModule } from './players/players.module';
import { envValidationSchema } from './config/env.validation';

/**
 * Üç veri deposu, üç net sorumluluk:
 *   PostgreSQL (Prisma)  → kimlik, cüzdan, ödül geçmişi (transactional)
 *   Redis (ioredis)      → canlı sıralama (Sorted Set)
 *   MongoDB (Mongoose)   → skor event log'ları (append-only)
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: envValidationSchema,
    }),
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        // Bağlantı adresi yalnızca .env'den okunur, koda gömülmez.
        uri: config.getOrThrow<string>('MONGO_URI'),
        // MONGO_URI'de veritabanı adı yok (path boş); belirtilmezse Mongoose
        // sessizce varsayılan "test" veritabanına yazar.
        dbName: 'leaderboard',
      }),
    }),
    // Haftalık ödül dağıtımı cron'u için.
    ScheduleModule.forRoot(),
    PrismaModule,
    RedisModule,
    HealthModule,
    AuthModule,
    LeaderboardModule,
    RewardsModule,
    IdentityModule,
    PlayersModule,
  ],
})
export class AppModule {}
