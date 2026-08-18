/**
 * Sezon kimliği üretimi ve doğrulaması.
 *
 * Sezon, ISO-8601 hafta numarasıdır: "2026-W34". Haftalık ödül dağıtımı bu
 * kimlik üzerinden yürür ve RewardLog'daki (userId, seasonId) tekil kısıtı
 * buna dayanır — dolayısıyla üretim tüm sunucularda birebir aynı olmalıdır.
 *
 * Hesap UTC üzerinden yapılır: yatayda çoğaltılmış instance'lar farklı saat
 * dilimlerinde çalışsa bile aynı anda aynı sezonu görür. Yerel saat kullanmak,
 * hafta sınırında iki sunucunun farklı ZSET'lere yazmasına yol açardı.
 */

/**
 * Kabul edilen sezon biçimi: 4 haneli yıl + "W" + 01-53 arası hafta.
 * Sorgu parametresiyle gelen sezon değerini doğrulamak için kullanılır.
 */
export const SEASON_ID_REGEX = /^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$/;

/**
 * Verilen ana (varsayılan: şimdi) karşılık gelen ISO-8601 sezon kimliğini üretir.
 *
 * ISO-8601 kuralı: bir hafta Pazartesi başlar ve yılın ilk haftası, o yılın ilk
 * Perşembe'sini içeren haftadır. Bu yüzden tarih önce haftanın Perşembe'sine
 * kaydırılır; yıl da bu kaydırılmış tarihten okunur. Aralık sonu böylece doğru
 * şekilde bir sonraki yılın W01'ine düşebilir (ör. 31.12.2026 -> "2026-W53").
 */
export function getCurrentSeasonId(now: Date = new Date()): string {
  const date = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );

  // getUTCDay() Pazar için 0 döner; ISO'da Pazar haftanın 7. günüdür.
  const dayOfWeek = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayOfWeek);

  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(
    ((date.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7,
  );

  // Yıl, kaydırılmış Perşembe'den alınır — takvim yılından değil.
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/**
 * İçinde bulunulan ISO haftasının bitiş anı (bir sonraki Pazartesi 00:00 UTC).
 *
 * Frontend'in "yeni sezona 2 gün 4 saat" geri sayımı için gereklidir. Hesap
 * sunucuda yapılır: istemcinin yerel saatine bırakılsaydı farklı saat
 * dilimlerindeki oyuncular farklı bitiş zamanı görürdü — oysa sezon sınırı
 * herkes için aynı UTC anıdır.
 */
export function getSeasonEndsAt(now: Date = new Date()): Date {
  const date = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );

  // Pazar 0 döner; ISO'da Pazar 7. gündür. Haftanın kalan gün sayısı bulunur.
  const dayOfWeek = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + (8 - dayOfWeek));

  return date;
}

/**
 * Sezonun başlangıç anı (o haftanın Pazartesi 00:00 UTC).
 *
 * Geri sayım çubuğunun "haftanın ne kadarı geçti" oranını hesaplayabilmesi
 * için bitiş kadar başlangıç da gerekir.
 */
export function getSeasonStartsAt(now: Date = new Date()): Date {
  const end = getSeasonEndsAt(now);
  return new Date(end.getTime() - 7 * 86_400_000);
}
