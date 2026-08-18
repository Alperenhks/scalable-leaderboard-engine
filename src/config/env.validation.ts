import * as Joi from 'joi';

/**
 * Uygulama açılışında .env doğrulaması.
 *
 * Amaç: eksik bir bağlantı URL'i ile sunucunun ayağa kalkıp ilk istekte
 * çökmesi yerine, daha bootstrap anında anlaşılır bir hata vermesi.
 * Hiçbir bağlantı bilgisi koda gömülü değildir; tümü process.env'den okunur.
 */
export const envValidationSchema = Joi.object({
  DATABASE_URL: Joi.string()
    .uri({ scheme: ['postgresql', 'postgres'] })
    .required(),
  REDIS_URL: Joi.string()
    .uri({ scheme: ['redis', 'rediss'] })
    .required(),
  MONGO_URI: Joi.string()
    .uri({ scheme: ['mongodb', 'mongodb+srv'] })
    .required(),
  JWT_SECRET: Joi.string().min(16).required(),
  PORT: Joi.number().port().default(8080),
  // Ödül dağıtımı ucunu elle tetikleyebilmek için gereken paylaşılan sır.
  // OPSİYONELDİR ve tanımlı değilse admin token hiç üretilmez — haftalık
  // dağıtım zaten cron ile otomatik çalışır, bu uç yalnızca dağıtımın elle
  // gösterilebilmesi içindir.
  ADMIN_SECRET: Joi.string().min(16).optional(),
  // Instance başına Postgres bağlantı havuzu boyutu. Yatayda çoğaltmada
  // toplam bağlantı sayısı = instance × bu değer; Neon'un limitine göre
  // ayarlanır.
  DB_POOL_MAX: Joi.number().min(1).max(100).default(20),
});
