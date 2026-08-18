import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../../generated/prisma/client';

/**
 * Prisma bağlantı yaşam döngüsünü Nest'in modül yaşam döngüsüne bağlar.
 *
 * Prisma 7'de driver adapter zorunludur: bağlantı havuzu artık Rust engine'de
 * değil, node-postgres tarafında yönetilir. prisma.config.ts yalnızca CLI'yi
 * (db push, generate) ilgilendirir; runtime client'ı adapter'ı ayrıca ister.
 *
 * Neon'a düz TCP ile bağlanılır (@prisma/adapter-neon değil): burada uzun ömürlü
 * bir sunucu var, edge/serverless ortamı değil. WebSocket tüneli her sorguya
 * karşılıksız gecikme eklerdi.
 */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor(config: ConfigService) {
    // Adapter super()'dan önce kurulmalı; bu yüzden this üzerinden okunamaz.
    // ConfigService kullanılır ki Joi doğrulaması çalışmış olsun.
    super({
      adapter: new PrismaPg({
        connectionString: config.getOrThrow<string>('DATABASE_URL'),
        // Havuz boyutu ölçümle belirlendi: 10 bağlantıda eşzamanlı yük altında
        // istekler kuyrukta bekliyordu. Üst sınırsız da bırakılamaz — yatayda
        // çoğaltılmış her instance kendi havuzunu tutar ve Neon'un bağlantı
        // limiti toplamda aşılır. `DB_POOL_MAX` ile instance sayısına göre
        // ayarlanabilir.
        max: config.get<number>('DB_POOL_MAX', 20),
        connectionTimeoutMillis: 5000,
        // Boşta kalan bağlantı kapatılır: trafik düştüğünde Neon tarafında
        // gereksiz bağlantı tutulmaz.
        idleTimeoutMillis: 30_000,
      }),
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
