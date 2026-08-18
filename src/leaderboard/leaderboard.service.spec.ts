import { Test } from '@nestjs/testing';
import {
  LeaderboardService,
  NEIGHBOURS_ABOVE,
  NEIGHBOURS_BELOW,
  TOP_WINDOW_SIZE,
} from './leaderboard.service';
import { REDIS_CLIENT } from '../redis/redis.module';
import { PrismaService } from '../prisma/prisma.service';
import { EventsService } from '../events/events.service';

/**
 * `getAround` testleri — case'in 8. maddesinin tek uygulayıcısı.
 *
 * Case: *"If a player is not in the top 100, they should still be able to see
 * their own position — along with their own rank, the 3 players above and the
 * 2 players below them should also appear in the list."*
 *
 * Sınanan şey ağ değil KARAR mantığıdır: pencere nerede başlar, tablonun
 * sınırlarında nasıl kırpılır, oyuncu ilk 100'deyken ne olur, hiç skoru
 * yoksa ne olur. Bunlar sessizce yanlış çalışabilen türden hatalardır —
 * yanıt yine döner, yalnızca içindeki sıralar kayar.
 *
 * Redis sahte bir sıralama üzerinden taklit edilir: gerçek bir Redis'e
 * bağlanmak testi yavaşlatır ve sınır durumlarını kurmayı zorlaştırırdı.
 */
describe('LeaderboardService.getAround', () => {
  /** Sahte sıralama: rank 1 en yüksek skor. */
  const board = Array.from({ length: 500 }, (_, i) => ({
    userId: `u${i + 1}`,
    score: 100_000 - i * 10,
  }));

  /**
   * ioredis pipeline'ının taklidi.
   *
   * Zincirlenen her komut kaydedilir, `exec()` hepsini sırayla çalıştırıp
   * ioredis'in biçiminde ([hata, sonuç] çiftleri) döndürür — servis yanıtı
   * bu biçime göre okuduğu için taklit de aynı biçimde olmalıdır.
   */
  const makeRedis = (members = board) => {
    const rangeOf = (start: number, stop: number) => {
      // ZREVRANGE negatif olmayan aralıkta çalışır; stop dahildir.
      const slice = members.slice(start, stop + 1);
      return slice.flatMap((m) => [m.userId, String(m.score)]);
    };

    const run = (cmd: string, args: unknown[]): unknown => {
      switch (cmd) {
        case 'zrevrank': {
          const i = members.findIndex((m) => m.userId === args[1]);
          return i === -1 ? null : i;
        }
        case 'zscore': {
          const m = members.find((x) => x.userId === args[1]);
          return m ? String(m.score) : null;
        }
        case 'zcard':
          return members.length;
        case 'zrevrange':
          return rangeOf(args[1] as number, args[2] as number);
        case 'mget':
          // Profil cache'i daima boş: isim çözümü Postgres'e düşsün.
          return (args as string[]).map(() => null);
        default:
          return null;
      }
    };

    const pipeline = () => {
      const queued: Array<[string, unknown[]]> = [];
      const api: Record<string, unknown> = {
        exec: () =>
          Promise.resolve(queued.map(([c, a]) => [null, run(c, a)] as const)),
      };
      for (const cmd of ['zrevrank', 'zscore', 'zcard', 'zrevrange', 'set']) {
        api[cmd] = (...args: unknown[]) => {
          queued.push([cmd, args]);
          return api;
        };
      }
      return api;
    };

    return {
      pipeline,
      mget: (...keys: string[]) => Promise.resolve(run('mget', keys)),
      get: () => Promise.resolve(null),
    };
  };

  const build = async (members = board) => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        LeaderboardService,
        { provide: REDIS_CLIENT, useValue: makeRedis(members) },
        {
          provide: PrismaService,
          useValue: {
            user: {
              // Sıralamadaki her kullanıcı Postgres'te de var sayılır.
              findMany: ({ where }: { where: { id: { in: string[] } } }) =>
                Promise.resolve(
                  where.id.in.map((id) => ({
                    id,
                    username: `name_${id}`,
                    country: 'TR',
                  })),
                ),
            },
          },
        },
        { provide: EventsService, useValue: {} },
      ],
    }).compile();

    return moduleRef.get(LeaderboardService);
  };

  describe('ilk 100 DIŞINDAKİ oyuncu — case md.8', () => {
    it('3 üst + kendisi + 2 alt döndürür', async () => {
      const service = await build();
      const target = board[120].userId; // 121. sıra

      const result = await service.getAround(target, '2026-W34');

      expect(result.rank).toBe(121);
      expect(result.inTopWindow).toBe(false);

      const ranks = result.neighbours.map((n) => n.rank);
      expect(ranks).toEqual([118, 119, 120, 121, 122, 123]);

      const above = result.neighbours.filter((n) => n.rank < 121);
      const below = result.neighbours.filter((n) => n.rank > 121);
      expect(above).toHaveLength(NEIGHBOURS_ABOVE);
      expect(below).toHaveLength(NEIGHBOURS_BELOW);
    });

    it('kendi satırını isCurrentUser ile işaretler, yalnızca birini', async () => {
      const service = await build();
      const target = board[120].userId;

      const result = await service.getAround(target, '2026-W34');

      const marked = result.neighbours.filter((n) => n.isCurrentUser);
      expect(marked).toHaveLength(1);
      expect(marked[0].rank).toBe(121);
      expect(marked[0].userId).toBe(target);
    });

    it('komşu skorları azalan sırada gelir', async () => {
      const service = await build();

      const result = await service.getAround(board[300].userId, '2026-W34');

      const scores = result.neighbours.map((n) => n.score);
      expect([...scores].sort((a, b) => b - a)).toEqual(scores);
    });
  });

  describe('tablo sınırlarında kırpma', () => {
    it('1. sıradaki oyuncunun üstünde komşu üretmez', async () => {
      const service = await build();

      const result = await service.getAround(board[0].userId, '2026-W34');

      expect(result.rank).toBe(1);
      // Üstte kimse yok: uydurma satır üretilmemeli.
      expect(result.neighbours.every((n) => n.rank >= 1)).toBe(true);
      expect(result.neighbours[0].rank).toBe(1);
      expect(result.neighbours.filter((n) => n.rank < 1)).toHaveLength(0);
    });

    it('son sıradaki oyuncunun altında komşu üretmez', async () => {
      const small = board.slice(0, 150);
      const service = await build(small);
      const last = small[small.length - 1].userId; // 150. sıra

      const result = await service.getAround(last, '2026-W34');

      expect(result.rank).toBe(150);
      expect(result.neighbours.every((n) => n.rank <= 150)).toBe(true);
      expect(result.neighbours[result.neighbours.length - 1].rank).toBe(150);
    });

    it('kırpma sonrası komşu sayısı 3 ile 6 arasında kalır', async () => {
      const service = await build();

      for (const index of [0, 1, 2, 120, 400, 499]) {
        const result = await service.getAround(board[index].userId, '2026-W34');
        expect(result.neighbours.length).toBeGreaterThanOrEqual(3);
        expect(result.neighbours.length).toBeLessThanOrEqual(
          NEIGHBOURS_ABOVE + 1 + NEIGHBOURS_BELOW,
        );
      }
    });
  });

  describe('ilk 100 İÇİNDEKİ oyuncu', () => {
    it('inTopWindow işaretler ve entries tablonun başından başlar', async () => {
      const service = await build();

      const result = await service.getAround(board[49].userId, '2026-W34');

      expect(result.rank).toBe(50);
      expect(result.inTopWindow).toBe(true);
      expect(result.entries[0].rank).toBe(1);
      expect(result.entries).toHaveLength(TOP_WINDOW_SIZE);
    });

    it('ilk 100 içinde olsa bile kişisel komşu penceresi döner', async () => {
      const service = await build();

      const result = await service.getAround(board[49].userId, '2026-W34');

      // `neighbours` `entries`den bağımsızdır: oyuncu tabloda görünse de
      // kendi çevresi ayrıca verilir.
      expect(result.neighbours.map((n) => n.rank)).toEqual([
        47, 48, 49, 50, 51, 52,
      ]);
    });
  });

  describe('sıralamada olmayan oyuncu', () => {
    it('rank null döner ve ASLA 0 olmaz', async () => {
      const service = await build();

      const result = await service.getAround('hic-yok', '2026-W34');

      expect(result.rank).toBeNull();
      // 0 dönseydi istemci bunu "1. sıra" diye gösterirdi.
      expect(result.rank).not.toBe(0);
      expect(result.score).toBe(0);
    });

    it('komşusu yoktur ama tablonun başı gösterilir', async () => {
      const service = await build();

      const result = await service.getAround('hic-yok', '2026-W34');

      expect(result.neighbours).toEqual([]);
      expect(result.inTopWindow).toBe(false);
      expect(result.entries[0].rank).toBe(1);
      expect(result.entries.every((e) => !e.isCurrentUser)).toBe(true);
    });
  });

  describe('genel değişmezler', () => {
    it('toplam oyuncu sayısını raporlar', async () => {
      const service = await build();

      const result = await service.getAround(board[10].userId, '2026-W34');

      expect(result.total).toBe(board.length);
    });

    it('ülke sorgusunda kodu büyük harfe çevirir', async () => {
      const service = await build();

      const result = await service.getAround(
        board[10].userId,
        '2026-W34',
        100,
        'tr',
      );

      expect(result.country).toBe('TR');
    });

    it('global sorguda country null kalır', async () => {
      const service = await build();

      const result = await service.getAround(board[10].userId, '2026-W34');

      expect(result.country).toBeNull();
    });

    it('kullanıcı adları Redis sırasını bozmadan eklenir', async () => {
      const service = await build();

      const result = await service.getAround(board[120].userId, '2026-W34');

      for (const n of result.neighbours) {
        expect(n.username).toBe(`name_${n.userId}`);
      }
    });
  });
});
