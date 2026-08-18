import { Test, TestingModule } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { AppModule } from './../src/app.module';

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

  it('ödül dağıtımı token olmadan tetiklenemez', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/rewards/distribute',
      payload: { seasonId: '2020-W01' },
    });

    expect(res.statusCode).toBe(401);
  });

  /**
   * Kimliği doğrulanmış olmak yetmez: para dağıtan uç yalnızca admin'e açıktır.
   * 401 ile 403 ayrımı korunur — "kimsin?" ve "yetkin var mı?" farklı sorular.
   */
  it('sıradan oyuncu ödül dağıtımını tetikleyemez (403)', async () => {
    const jwt = app.get(JwtService);
    const token = jwt.sign({ sub: 'e2e-player', roles: ['player'] });

    const res = await app.inject({
      method: 'POST',
      url: '/api/rewards/distribute',
      headers: { authorization: `Bearer ${token}` },
      payload: { seasonId: '2020-W01' },
    });

    expect(res.statusCode).toBe(403);
  });

  it('rol taşımayan token da dağıtımı tetikleyemez (403)', async () => {
    // Yetki yükseltmesine karşı en kritik kontrol: rolsüz token admin sayılmaz.
    const jwt = app.get(JwtService);
    const token = jwt.sign({ sub: 'e2e-rolsuz' });

    const res = await app.inject({
      method: 'POST',
      url: '/api/rewards/distribute',
      headers: { authorization: `Bearer ${token}` },
      payload: { seasonId: '2020-W01' },
    });

    expect(res.statusCode).toBe(403);
  });

  it('admin rolü dağıtım ucundan geçer', async () => {
    const jwt = app.get(JwtService);
    const token = jwt.sign({ sub: 'e2e-admin', roles: ['admin'] });

    const res = await app.inject({
      method: 'POST',
      url: '/api/rewards/distribute',
      headers: { authorization: `Bearer ${token}` },
      payload: { seasonId: '2020-W01' },
    });

    // Yetki engeline takılmaz; boş sezon olduğu için iş mantığı 200/201 döner.
    expect(res.statusCode).not.toBe(401);
    expect(res.statusCode).not.toBe(403);
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
