import { Inject, Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.module';
import { PrismaService } from '../prisma/prisma.service';
import { EventsService } from '../events/events.service';
import { PRIZE_POOL_RATE } from '../rewards/reward-math';

export interface LeaderboardEntry {
  rank: number;
  userId: string;
  username: string;
  score: number;
  /** ISO 3166-1 alpha-2; ülke bazlı karşılaştırma ve bayrak gösterimi için. */
  country: string | null;
}

export interface LeaderboardPage {
  seasonId: string;
  /** Ülke sıralaması sorgulandıysa ISO kodu, global sorguda null. */
  country: string | null;
  total: number;
  limit: number;
  offset: number;
  entries: LeaderboardEntry[];
}

export interface SubmitScoreResult {
  userId: string;
  seasonId: string;
  delta: number;
  totalScore: number;
  rank: number | null;
  duplicate: boolean;
}

export interface AroundLeaderboard {
  seasonId: string;
  /** Ülke sıralaması sorgulandıysa ISO kodu, global sorguda null. */
  country: string | null;
  userId: string;
  rank: number | null;
  score: number;
  total: number;
  /** Oyuncu ilk 100'deyse true — bu durumda entries ilk 100'ün başıdır. */
  inTopWindow: boolean;
  entries: Array<LeaderboardEntry & { isCurrentUser: boolean }>;
  /**
   * Oyuncunun DAİMA kendi çevresi: 3 üst + kendisi + 2 alt.
   *
   * `entries`den bağımsızdır: oyuncu ilk 100'de olsa bile burası kişiye
   * özeldir. Tablonun sınırlarında kırpılır (1. sırada üstte kimse yoktur),
   * bu yüzden uzunluğu 3-6 arasında değişir.
   */
  neighbours: Array<LeaderboardEntry & { isCurrentUser: boolean }>;
}

/** Postgres'te bulunamayan kullanıcı için gösterilecek ad. */
const UNKNOWN_USERNAME = 'unknown';

/** Liderlik tablosunda gösterilen kullanıcı bilgileri. */
interface UserProfile {
  username: string;
  country: string | null;
}

/**
 * Profil cache ömrü (24 saat).
 *
 * Kullanıcı adı ve ülke pratikte hiç değişmez; buna karşılık her liderlik
 * tablosu isteği bu bilgi için Postgres'e gidiyordu. Ölçüm: uzak Postgres'e
 * tek gidiş-dönüş ~57 ms — `SELECT 1` bile aynı süreyi alıyordu, yani maliyet
 * satır sayısından değil ağ mesafesinden geliyordu. Cache bu adımı kaldırır
 * ve ölçülen verimi iki katına çıkarır (155 -> 309 RPS).
 *
 * TTL sonsuz değildir ki bir ad değişikliği en geç bir gün içinde yansısın.
 */
const PROFILE_CACHE_TTL_SECONDS = 86_400;

/** "İlk N" penceresi — bu aralıktaki oyuncu zaten tabloda görünür. */
export const TOP_WINDOW_SIZE = 100;

/** Oyuncu ilk 100 dışındaysa gösterilecek komşu sayısı: 3 üst, 2 alt. */
export const NEIGHBOURS_ABOVE = 3;
export const NEIGHBOURS_BELOW = 2;

/**
 * Canlı liderlik tablosu.
 *
 * Sıralamanın otoritesi Redis Sorted Set'tir. Araya bir RedisService katmanı
 * konmadı — davranışı olmayan bir dolaylama olurdu; bu sınıfın kendisi zaten
 * ZSET sarmalayıcısıdır.
 */
@Injectable()
export class LeaderboardService {
  private readonly logger = new Logger(LeaderboardService.name);

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
  ) {}

  /**
   * Sezon başına ayrı anahtar: haftalık ödül job'ı donmuş bir anlık görüntüye
   * ihtiyaç duyar. Tek global ZSET her hafta yıkıcı sıfırlama gerektirir ve
   * geçmişi yok ederdi.
   *
   * Süslü parantez ({}) kullanılmaz — Redis Cluster ve Upstash'te hash-slot
   * etiketi anlamına gelir, burada bir karşılığı yok.
   */
  private key(seasonId: string): string {
    return `lb:${seasonId}`;
  }

  /**
   * Sezonun ödül havuzu (kuruş cinsinden tamsayı sayaç).
   *
   * Kuruş tutulur çünkü INCRBY yalnızca tamsayı ile atomiktir; INCRBYFLOAT
   * ikili kayan nokta biriktirir ve haftalık milyonlarca artışta havuz sapar.
   */
  private poolKey(seasonId: string): string {
    return `pool:${seasonId}`;
  }

  /** Oyuncu profilinin (ad + ülke) cache anahtarı. */
  private profileKey(userId: string): string {
    return `profile:${userId}`;
  }

  /**
   * Ülke bazlı sıralama anahtarı.
   *
   * Global tablodan ayrı bir ZSET tutulur; alternatif olan "global tabloyu
   * çekip ülkeye göre filtrele" yaklaşımı 2M üyede tüm sıralamayı taramak
   * demek olurdu. Ayrı ZSET ile ülke sorgusu da global sorgu kadar hızlıdır:
   * ZREVRANGE/ZREVRANK aynı O(log N + M) maliyetiyle çalışır.
   *
   * Ülke kodu ISO 3166-1 alpha-2'dir ve şemada `Char(2)` ile sınırlıdır;
   * anahtar adına doğrudan girmesi güvenlidir.
   */
  private countryKey(seasonId: string, country: string): string {
    return `lb:${seasonId}:c:${country}`;
  }

  /**
   * Sorgunun hangi sıralamaya gideceğini seçer.
   *
   * `country` verilmişse ülke tablosu, verilmemişse global tablo. Okuma
   * yolundaki tüm metotlar bu tek noktadan geçtiği için ülke desteği her
   * uçta aynı biçimde ve aynı maliyetle çalışır.
   */
  private scopedKey(seasonId: string, country?: string | null): string {
    return country
      ? this.countryKey(seasonId, country.toUpperCase())
      : this.key(seasonId);
  }

  /**
   * Skor gönderimi. İşlem iki depoya yayılır ve aralarında ortak transaction
   * yoktur — gerçek dağıtık atomiklik mümkün değildir. Bu yüzden hata yönü
   * bilinçli seçilir: önce Redis, sonra Mongo.
   *
   * Gerekçe: Redis canlı sıralamanın otoritesi, Mongo denetim kaydıdır. Mongo
   * yazımı düşerse skor doğru kalır, yalnızca bir denetim satırı kaybolur.
   * Ters sırada Redis düşseydi log, ödül dağıtımının dayandığı skoru yanlış
   * gösterirdi — kalıcı tutarsızlık. Denetim satırı kaybetmek daha ucuzdur.
   */
  async submitScore(
    userId: string,
    delta: number,
    source: string,
    seasonId: string,
    idempotencyKey?: string,
  ): Promise<SubmitScoreResult> {
    // 1) Ön-kontrol: bilinen bir tekrarsa Redis'e hiç dokunma.
    if (idempotencyKey) {
      const existing = await this.events.findByIdempotencyKey(idempotencyKey);
      if (existing) {
        return {
          userId: existing.userId,
          seasonId: existing.seasonId,
          delta: existing.delta,
          totalScore: existing.totalScore,
          rank: await this.rankOf(existing.userId, existing.seasonId),
          duplicate: true,
        };
      }
    }

    // 2) ZINCRBY atomiktir ve yeni toplamı döndürür — ayrıca ZSCORE gerekmez.
    //    Havuz katkısı ve ülke sıralaması aynı pipeline'da gider: üç yazma
    //    tek gidiş-dönüşte tamamlanır.
    const key = this.key(seasonId);
    const poolContribution = this.poolContributionMinor(delta);

    // Ülke, profil cache'inden okunur — yazma yolu Postgres'e dokunmaz.
    // Cache boşsa ülke ZSET'i bu istekte atlanır: global sıralama her zaman
    // doğrudur ve ülke tablosu bir sonraki yazımda kendini toparlar. Yazma
    // yolunun gecikmesini artırmamak, ülke tablosunun anlık kesinliğinden
    // daha önemlidir.
    const country = await this.cachedCountry(userId);

    const pipeline = this.redis.pipeline().zincrby(key, delta, userId);
    if (poolContribution > 0) {
      pipeline.incrby(this.poolKey(seasonId), poolContribution);
    }
    if (country) {
      pipeline.zincrby(this.countryKey(seasonId, country), delta, userId);
    }
    const results = await pipeline.exec();
    const totalScore = Number(results?.[0]?.[1] ?? 0);

    // 3) Denetim kaydı.
    try {
      await this.events.record({
        userId,
        delta,
        totalScore,
        seasonId,
        source,
        idempotencyKey,
      });
    } catch (error) {
      if (this.events.isDuplicateKeyError(error)) {
        // Ön-kontrolü aşan eşzamanlı tekrar: unique index kazananı belirledi.
        // Redis'e uygulanan artışı geri al — telafi edilmezse çift gönderim
        // canlı skora işlemiş olarak kalır ve anahtarın anlamı kalmazdı.
        await this.compensate(seasonId, userId, delta);

        const winner = idempotencyKey
          ? await this.events.findByIdempotencyKey(idempotencyKey)
          : null;

        return {
          userId,
          seasonId,
          delta: winner?.delta ?? delta,
          totalScore: winner?.totalScore ?? totalScore - delta,
          rank: await this.rankOf(userId, seasonId),
          duplicate: true,
        };
      }

      // Diğer Mongo hataları: skor zaten doğru uygulandı. İstek başarısız
      // sayılmaz; kaybolan yalnızca denetim satırıdır.
      this.logger.error(
        `ScoreEvent yazılamadı (userId=${userId}, seasonId=${seasonId}): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    return {
      userId,
      seasonId,
      delta,
      totalScore,
      rank: await this.rankOf(userId, seasonId),
      duplicate: false,
    };
  }

  /**
   * Skoru ve havuz katkısını birlikte geri alır.
   *
   * İkisi birlikte uygulandığı için birlikte geri alınmalıdır; yalnızca skoru
   * geri almak havuzu şişirir ve mükerrer gönderim ödül bütçesine sızardı.
   *
   * Telafi başarısız olursa çift sayım kalır — nadir, elle mutabakat için loglanır.
   */
  private async compensate(
    seasonId: string,
    userId: string,
    delta: number,
  ): Promise<void> {
    const poolContribution = this.poolContributionMinor(delta);
    try {
      // Ülke ZSET'i de geri alınır: yalnızca globali düzeltmek, ülke
      // sıralamasında çift sayım bırakırdı.
      const country = await this.cachedCountry(userId);

      const pipeline = this.redis
        .pipeline()
        .zincrby(this.key(seasonId), -delta, userId);
      if (poolContribution > 0) {
        pipeline.decrby(this.poolKey(seasonId), poolContribution);
      }
      if (country) {
        pipeline.zincrby(this.countryKey(seasonId, country), -delta, userId);
      }
      await pipeline.exec();
    } catch (error) {
      this.logger.error(
        `Telafi başarısız — ${userId} için ${delta} çift sayılmış olabilir: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /**
   * Oyuncunun ülkesini YALNIZCA cache'ten okur.
   *
   * Postgres'e bilinçli olarak düşülmez: skor gönderimi bu mimarinin en sıcak
   * yoludur ve oraya bir veritabanı turu eklemek, kaçınılan yükü geri
   * getirirdi. Cache boşsa ülke ZSET'i o istekte atlanır — oyuncu liderlik
   * tablosunda bir kez göründüğünde profil cache'i dolar ve sonraki
   * yazımlarda ülke sıralaması da işler.
   */
  private async cachedCountry(userId: string): Promise<string | null> {
    try {
      const raw = await this.redis.get(this.profileKey(userId));
      if (!raw) return null;
      return (JSON.parse(raw) as UserProfile).country;
    } catch {
      // Bozuk cache kaydı skor yazımını engellemesin.
      return null;
    }
  }

  /**
   * Bir skor artışının havuza aktarılan kuruş karşılığı.
   *
   * Yalnızca POZİTİF delta katkı yapar: ceza/düzeltme amaçlı negatif delta
   * havuzu küçültmez. Aksi halde bir oyuncuya kesilen ceza, tüm oyuncuların
   * ödül havuzunu azaltırdı.
   */
  private poolContributionMinor(delta: number): number {
    if (delta <= 0) return 0;
    return Math.round(delta * PRIZE_POOL_RATE * 100);
  }

  /** Sezonun biriken havuzu (kuruş). */
  async getPrizePoolMinor(seasonId: string): Promise<bigint> {
    const raw = await this.redis.get(this.poolKey(seasonId));
    return raw === null ? 0n : BigInt(raw);
  }

  /**
   * Sezonu kapatır: sıralamayı ve havuzu birlikte siler.
   *
   * Dağıtım Postgres'e yazıldıktan SONRA çağrılmalıdır — önce silinirse
   * dağıtım yarıda kalırsa veri geri getirilemez.
   */
  async resetSeason(seasonId: string): Promise<void> {
    await this.redis.del(this.key(seasonId), this.poolKey(seasonId));

    // Ülke tabloları da silinmelidir; kalırlarsa yeni sezon eski skorlarla
    // başlar. Anahtarlar SCAN ile taranır — KEYS tek iş parçacıklı Redis'i
    // tüm filo için bloklardı ve bu, üretimde kaçınılan bir komuttur.
    const pattern = `${this.key(seasonId)}:c:*`;
    let cursor = '0';
    do {
      const [next, found] = await this.redis.scan(
        cursor,
        'MATCH',
        pattern,
        'COUNT',
        200,
      );
      cursor = next;
      if (found.length > 0) await this.redis.del(...found);
    } while (cursor !== '0');
  }

  /** Dağıtım için ilk N oyuncuyu skorlarıyla verir. */
  async getRewardCandidates(
    seasonId: string,
    count: number,
  ): Promise<Array<{ userId: string; rank: number; score: number }>> {
    const flat = await this.redis.zrevrange(
      this.key(seasonId),
      0,
      count - 1,
      'WITHSCORES',
    );
    return this.parseRange(flat, 0);
  }

  /**
   * Oyuncunun sırası ve skoru.
   *
   * ZREVRANK 0-tabanlıdır, insan sırası +1'dir. Üye yoksa null döner ve bu
   * ASLA 0'a çevrilmez — 0 "1. sıra" demek olurdu.
   */
  async getUserRank(
    userId: string,
    seasonId: string,
    country?: string | null,
  ): Promise<{
    userId: string;
    seasonId: string;
    country: string | null;
    rank: number | null;
    score: number;
  }> {
    const key = this.scopedKey(seasonId, country);
    const results = await this.redis
      .pipeline()
      .zrevrank(key, userId)
      .zscore(key, userId)
      .exec();

    const rank = (results?.[0]?.[1] ?? null) as number | null;
    const score = (results?.[1]?.[1] ?? null) as string | null;

    return {
      userId,
      seasonId,
      country: country ? country.toUpperCase() : null,
      rank: rank === null ? null : rank + 1,
      score: score === null ? 0 : Number(score),
    };
  }

  private async rankOf(
    userId: string,
    seasonId: string,
  ): Promise<number | null> {
    const rank = await this.redis.zrevrank(this.key(seasonId), userId);
    return rank === null ? null : rank + 1;
  }

  /** ZCARD O(1)'dir; istemci sayfalama arayüzü için toplam sayı verir. */
  async getPlayerCount(
    seasonId: string,
    country?: string | null,
  ): Promise<number> {
    return this.redis.zcard(this.scopedKey(seasonId, country));
  }

  /**
   * Birden çok oyuncunun sırasını TEK pipeline ile sorgular.
   *
   * Oyuncu başına ayrı ZREVRANK, 500 kayıtta 500 ağ turu demektir; pipeline
   * bunu tek gidiş-dönüşe indirir. Sırası olmayan oyuncu için null döner ve
   * bu değer asla 0'a çevrilmez — 0 "birincilik" anlamına gelirdi.
   */
  async getRanksOf(
    seasonId: string,
    userIds: string[],
  ): Promise<Array<number | null>> {
    if (userIds.length === 0) return [];

    const key = this.key(seasonId);
    const pipeline = this.redis.pipeline();
    for (const userId of userIds) pipeline.zrevrank(key, userId);
    const results = await pipeline.exec();

    return userIds.map((_, i) => {
      const rank = results?.[i]?.[1] as number | null | undefined;
      return rank === null || rank === undefined ? null : rank + 1;
    });
  }

  /**
   * Sıralamadaki verilen aralığın yalnızca userId'lerini verir (skorsuz).
   *
   * Kimlik seçimi (AuthService) sıradaki bir oyuncuyu bulmak için kullanır;
   * ad ve skor gerekmediği için WITHSCORES yükü taşınmaz.
   */
  async getUserIdsAtRange(
    seasonId: string,
    start: number,
    stop: number,
  ): Promise<string[]> {
    return this.redis.zrevrange(this.key(seasonId), start, stop);
  }

  /**
   * Sıralamanın ilk N kaydı.
   *
   * 2M satırın sıralanması tamamen Redis'te kalır. Postgres'e yalnızca görünen
   * adlar için tek bir indeksli birincil anahtar araması gider — O(sayfa),
   * O(tablo) değil.
   */
  async getTopPlayers(
    seasonId: string,
    limit: number,
    offset: number,
    country?: string | null,
  ): Promise<LeaderboardPage> {
    const key = this.scopedKey(seasonId, country);

    // Sayfa ve toplam sayı TEK pipeline'da alınır: iki ayrı gidiş-dönüş,
    // bu mimaride ölçülen sürenin neredeyse tamamını oluşturuyordu.
    const results = await this.redis
      .pipeline()
      .zrevrange(key, offset, offset + limit - 1, 'WITHSCORES')
      .zcard(key)
      .exec();

    const flat = (results?.[0]?.[1] ?? []) as string[];
    const total = (results?.[1]?.[1] ?? 0) as number;

    const entries = await this.enrich(this.parseRange(flat, offset));

    return {
      seasonId,
      country: country ? country.toUpperCase() : null,
      total,
      limit,
      offset,
      entries,
    };
  }

  /**
   * "3 üst, 2 alt" penceresi.
   *
   * Oyuncu ilk 100'deyse zaten normal tabloda görünür; o durumda ilk 100'ün
   * başı döndürülür ve `inTopWindow: true` işaretlenir. İlk 100 dışındaysa
   * [rank-3 .. rank+2] aralığı çekilir — oyuncu hiçbir koşulda listeden
   * kaybolmaz.
   *
   * Maliyet sabittir: ZREVRANK + tek bir dar ZREVRANGE + en fazla 6 satırlık
   * ad araması. Oyuncunun 1.500.000. sırada olması hiçbir şeyi değiştirmez.
   */
  async getAround(
    userId: string,
    seasonId: string,
    limit = TOP_WINDOW_SIZE,
    country?: string | null,
  ): Promise<AroundLeaderboard> {
    const key = this.scopedKey(seasonId, country);
    const scope = country ? country.toUpperCase() : null;

    // Sıra, skor ve toplam sayı TEK pipeline'da: üç ayrı gidiş-dönüş yerine
    // bir tur. Bu yolun tamamı Redis'tir, Postgres'e hiç uğramaz.
    const head = await this.redis
      .pipeline()
      .zrevrank(key, userId)
      .zscore(key, userId)
      .zcard(key)
      .exec();

    const rawRank = head?.[0]?.[1] as number | null;
    const rawScore = head?.[1]?.[1] as string | null;
    const total = (head?.[2]?.[1] ?? 0) as number;

    // Oyuncu bu sezon hiç skor göndermemiş: pencere yok, tablonun başı verilir.
    if (rawRank === null || rawRank === undefined) {
      const top = await this.getTopPlayers(seasonId, limit, 0, country);
      return {
        seasonId,
        country: scope,
        userId,
        rank: null,
        score: 0,
        total,
        inTopWindow: false,
        // Sırası olmayan oyuncunun komşusu da yoktur — boş dizi döner ve
        // frontend "henüz sıralamada değilsin" ekranını gösterir.
        neighbours: [],
        entries: top.entries.map((e) => ({ ...e, isCurrentUser: false })),
      };
    }

    const rank = rawRank + 1;
    const inTopWindow = rank <= TOP_WINDOW_SIZE;

    // İlk 100'deyse pencere kaydırmaya gerek yok; aksi halde 3 üst / 2 alt.
    const start = inTopWindow ? 0 : rawRank - NEIGHBOURS_ABOVE;
    const stop = inTopWindow ? limit - 1 : rawRank + NEIGHBOURS_BELOW;

    // Komşu penceresi tablonun sınırlarında kırpılır: 1. sıradaki oyuncunun
    // üstünde kimse yoktur ve uydurma satır üretilmez.
    const nbStart = Math.max(0, rawRank - NEIGHBOURS_ABOVE);
    const nbStop = Math.min(total - 1, rawRank + NEIGHBOURS_BELOW);

    // İki aralık TEK pipeline'da çekilir, ardından ad çözümlemesi de tek
    // seferde yapılır. Ayrı ayrı enrich çağırmak aynı kullanıcıları iki kez
    // sorgulayıp fazladan bir tur atardı.
    const ranges = await this.redis
      .pipeline()
      .zrevrange(key, start, stop, 'WITHSCORES')
      .zrevrange(key, nbStart, nbStop, 'WITHSCORES')
      .exec();

    const mainRanked = this.parseRange(
      (ranges?.[0]?.[1] ?? []) as string[],
      start,
    );
    const nbRanked =
      nbStart > nbStop
        ? []
        : this.parseRange((ranges?.[1]?.[1] ?? []) as string[], nbStart);

    // Tek enrich: iki pencerenin kullanıcıları birleştirilip bir kez çözülür.
    const enriched = await this.enrich([...mainRanked, ...nbRanked]);
    const entries = enriched.slice(0, mainRanked.length);
    const neighbourEntries = enriched.slice(mainRanked.length);

    return {
      seasonId,
      country: scope,
      userId,
      rank,
      score: rawScore === null ? 0 : Number(rawScore),
      total,
      inTopWindow,
      neighbours: neighbourEntries.map((e) => ({
        ...e,
        isCurrentUser: e.rank === rank,
      })),
      entries: entries.map((e) => ({
        ...e,
        isCurrentUser: e.userId === userId,
      })),
    };
  }

  /**
   * RESP2'de ZREVRANGE ... WITHSCORES yanıtı düz dizidir:
   * [üye, skor, üye, skor, ...]. offset ilk satırın 0-tabanlı sırasıdır.
   */
  private parseRange(
    flat: string[],
    offset: number,
  ): Array<{ rank: number; userId: string; score: number }> {
    const ranked: Array<{ rank: number; userId: string; score: number }> = [];
    for (let i = 0; i < flat.length; i += 2) {
      ranked.push({
        rank: offset + i / 2 + 1,
        userId: flat[i],
        score: Number(flat[i + 1]),
      });
    }
    return ranked;
  }

  /** Redis sırasını koruyarak görünen ad ve ülkeyi ekler. */
  private async enrich(
    ranked: Array<{ rank: number; userId: string; score: number }>,
  ): Promise<LeaderboardEntry[]> {
    const profileById = await this.resolveProfiles(ranked.map((r) => r.userId));

    return ranked.map((r) => {
      const profile = profileById.get(r.userId);
      return {
        ...r,
        username: profile?.username ?? UNKNOWN_USERNAME,
        country: profile?.country ?? null,
      };
    });
  }

  /**
   * Tek sorguda ad çözümleme. findMany giriş sırasını korumaz, bu yüzden
   * sonuç Map'e alınır ve Redis'ten gelen sıra esas kabul edilir.
   *
   * Postgres'te bulunamayan kullanıcı listeden DÜŞÜRÜLMEZ; düşürmek sıralamada
   * boşluk yaratır ve sayfalamayı bozardı.
   */
  private async resolveProfiles(
    userIds: string[],
  ): Promise<Map<string, UserProfile>> {
    if (userIds.length === 0) return new Map();

    // Aynı kullanıcı iki pencerede birden geçebilir; tekilleştirilmezse
    // hem cache hem Postgres aynı kaydı iki kez sorgular.
    const unique = [...new Set(userIds)];
    const resolved = new Map<string, UserProfile>();

    // 1) Önce cache — tek MGET, üye başına ayrı çağrı yok.
    const cached = await this.redis.mget(
      ...unique.map((id) => this.profileKey(id)),
    );

    const misses: string[] = [];
    unique.forEach((id, i) => {
      const raw = cached[i];
      if (raw === null) {
        misses.push(id);
        return;
      }
      try {
        resolved.set(id, JSON.parse(raw) as UserProfile);
      } catch {
        // Bozuk kayıt cache'i kilitlemesin; Postgres'ten tazelenir.
        misses.push(id);
      }
    });

    if (misses.length === 0) return resolved;

    // 2) Yalnızca eksikler Postgres'ten. country aynı satırda gelir; ülke
    //    bayrağı için ikinci bir sorgu atmak gereksiz olurdu.
    const users = await this.prisma.user.findMany({
      where: { id: { in: misses } },
      select: { id: true, username: true, country: true },
    });

    // 3) Cache'e tek pipeline ile yazılır.
    const pipeline = this.redis.pipeline();
    for (const u of users) {
      const profile: UserProfile = {
        username: u.username,
        country: u.country,
      };
      resolved.set(u.id, profile);
      pipeline.set(
        this.profileKey(u.id),
        JSON.stringify(profile),
        'EX',
        PROFILE_CACHE_TTL_SECONDS,
      );
    }
    await pipeline.exec();

    return resolved;
  }
}
