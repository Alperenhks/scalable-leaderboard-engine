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
});
