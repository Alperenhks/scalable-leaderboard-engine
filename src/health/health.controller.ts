import { Controller, Get, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { HealthService, HealthReport } from './health.service';

/**
 * Sağlık uçları.
 *
 * İki ayrı soru vardır ve karıştırılmaları pahalıya mal olur:
 *
 *   Liveness  (`GET /`)        — "süreç ayakta mı?"
 *   Readiness (`GET /health`)  — "istek alabilir durumda mı?"
 *
 * Liveness bağımlılıklara BAKMAZ. Baksaydı, Postgres'in geçici bir kesintisi
 * tüm filoyu yeniden başlatırdı — oysa süreçlerde bir sorun yoktur ve yeniden
 * başlatmak durumu düzeltmez, yalnızca kesintiyi uzatır.
 *
 * Readiness ise bağımlılıklara bakar: bir instance Redis'e ulaşamıyorsa ona
 * trafik göndermek istekleri hataya sürükler; yük dengeleyici onu havuzdan
 * çıkarmalıdır.
 */
@Controller()
export class HealthController {
  constructor(private readonly health: HealthService) {}

  /**
   * Liveness probe — sıfır I/O.
   *
   * Kök yol, `main.ts`'te global `/api` önekinden muaf tutulur: konteyner
   * sağlık probu ve mevcut e2e testi burayı bekler.
   */
  @Get()
  liveness(): { status: 'ok'; uptimeSeconds: number } {
    return { status: 'ok', uptimeSeconds: Math.floor(process.uptime()) };
  }

  /**
   * Readiness probe — üç veri deposunu da yoklar.
   *
   * Bağımlılıklardan biri düşükse **503** döner. 200 dönseydi orchestrator
   * instance'ı sağlıklı sayar ve çalışmayacak isteklerle beslerdi; durum kodu
   * makine tarafından okunabilir tek sinyaldir.
   *
   * Gövde her iki durumda da aynı biçimdedir — hangi bağımlılığın düştüğü ve
   * yoklamanın kaç ms sürdüğü raporda görünür.
   */
  @Get('health')
  async readiness(
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<HealthReport> {
    const report = await this.health.check();

    if (report.status !== 'ok') {
      reply.status(503);
    }

    return report;
  }
}
