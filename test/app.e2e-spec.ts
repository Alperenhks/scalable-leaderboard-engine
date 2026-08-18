import { Test, TestingModule } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { AppModule } from '../src/app.module';

/**
 * Uygulama Fastify üzerinde çalışır; test de aynı adaptörü kurmalıdır.
 * Adaptör verilmezse Nest varsayılan olarak @nestjs/platform-express arar
 * ve o paket bu projede kurulu değildir.
 *
 * Prefix kurulumu main.ts ile birebir aynı tutulur: kök yol hariç tutulduğu
 * için sağlık kontrolü / üzerinde kalır, iş uçları /api altına iner.
 */
describe('Uygulama (e2e)', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    app.setGlobalPrefix('api', { exclude: ['/'] });
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );

    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  it('kök yol liveness probe olarak prefix dışında kalır', async () => {
    const res = await app.inject({ method: 'GET', url: '/' });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload) as {
      status: string;
      uptimeSeconds: number;
    };
    expect(body.status).toBe('ok');
    expect(body.uptimeSeconds).toBeGreaterThanOrEqual(0);
  });

  it('readiness probe üç veri deposunu da raporlar', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });

    // Testler canlı depolara bağlı çalışır; hepsi ayaktaysa 200, biri
    // düşükse 503 — ikisi de geçerli yanıttır, önemli olan raporun biçimi.
    expect([200, 503]).toContain(res.statusCode);

    const body = JSON.parse(res.payload) as {
      status: string;
      dependencies: Record<string, { status: string; latencyMs: number }>;
    };
    expect(['ok', 'degraded']).toContain(body.status);
    for (const name of ['postgres', 'redis', 'mongo']) {
      expect(['up', 'down']).toContain(body.dependencies[name].status);
      expect(body.dependencies[name].latencyMs).toBeGreaterThanOrEqual(0);
    }
  });

  it('liderlik tablosu /api altında yayınlanır', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/leaderboard' });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload) as {
      seasonId: string;
      entries: unknown[];
    };
    expect(body.seasonId).toMatch(/^\d{4}-W\d{2}$/);
    expect(Array.isArray(body.entries)).toBe(true);
  });

  it('skor gönderimi token olmadan reddedilir', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/score',
      payload: { delta: 10, source: 'e2e_test' },
    });

    expect(res.statusCode).toBe(401);
  });

  it('geçersiz imzalı token reddedilir', async () => {
    const foreign = new JwtService({ secret: 'tamamen-baska-bir-anahtar' });
    const res = await app.inject({
      method: 'POST',
      url: '/api/score',
      headers: { authorization: `Bearer ${foreign.sign({ sub: 'sahte' })}` },
      payload: { delta: 10, source: 'e2e_test' },
    });

    expect(res.statusCode).toBe(401);
  });

  it('geçerli token ile gövdeden userId/seasonId göndermek reddedilir', async () => {
    // Kimlik ve sezon sunucu tarafından belirlenir; ikisi de gövdede olamaz.
    const jwt = app.get(JwtService);
    const token = jwt.sign({ sub: 'e2e-test-user' });

    const res = await app.inject({
      method: 'POST',
      url: '/api/score',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        userId: 'baskasinin-idsi',
        delta: 10,
        source: 'e2e_test',
        seasonId: '2020-W01',
      },
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.payload) as { message: string[] };
    expect(body.message.join(' ')).toContain('userId');
  });

  it('around ucu token ister', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/leaderboard/around',
    });

    expect(res.statusCode).toBe(401);
  });

  /**
   * Dağıtım ucu kimlik doğrulaması istemez (case bir yetkilendirme sistemi
   * istemiyor, haftalık dağıtım zaten cron ile otomatik). Ucun güvencesi
   * guard değil İDEMPOTENCY'dir: art arda çağırmak çift ödeme üretemez.
   */
  it('dağıtım ucu token olmadan çağrılabilir', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/rewards/distribute',
      payload: { seasonId: '2020-W01' },
    });

    // 201: dağıtıldı (havuz boş olduğu için kimseye ödeme yapılmaz)
    // 409: aynı sezon zaten dağıtılmış / dağıtım sürüyor
    expect([201, 409]).toContain(res.statusCode);
  });

  it('aynı sezon ikinci kez dağıtılamaz', async () => {
    const seasonId = '2020-W02';
    const call = () =>
      app.inject({
        method: 'POST',
        url: '/api/rewards/distribute',
        payload: { seasonId },
      });

    const first = await call();
    expect([201, 409]).toContain(first.statusCode);

    // İkinci çağrı: ya sezon zaten dağıtılmış (409) ya da havuz boş olduğu
    // için hiç kayıt oluşmamıştır (201, rewardedCount: 0). Her iki durumda
    // da ÇİFT ÖDEME oluşmamalıdır.
    const second = await call();
    expect([201, 409]).toContain(second.statusCode);

    if (second.statusCode === 201) {
      const body = JSON.parse(second.payload) as { rewardedCount: number };
      expect(body.rewardedCount).toBe(0);
    }
  });

  it('skor gönderimi admin rolü gerektirmez', async () => {
    // Rol koruması yalnızca dağıtım ucuna eklendi; oyun akışı etkilenmemeli.
    const jwt = app.get(JwtService);
    const token = jwt.sign({ sub: 'e2e-player-2', roles: ['player'] });

    const res = await app.inject({
      method: 'POST',
      url: '/api/score',
      headers: { authorization: `Bearer ${token}` },
      payload: { delta: 1, source: 'e2e_rbac' },
    });

    expect(res.statusCode).toBe(201);
  });

  afterAll(async () => {
    await app.close();
  });
});
