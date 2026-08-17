import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type ScoreEventDocument = HydratedDocument<ScoreEvent>;

/**
 * Yüksek hacimli, append-only skor event kaydı.
 *
 * Neden Mongo: 2M DAU'lu idle bir oyunda skor artışı sürekli akar. Bu akışı
 * Postgres'e yazmak transactional veritabanını gereksiz yere doyurur.
 * Mongo burada denetim/analitik amaçlı olay geçmişini tutar; canlı sıralamanın
 * otoritesi Redis Sorted Set'tir, para ve ödülün otoritesi Postgres'tir.
 */
@Schema({
  collection: 'score_events',
  timestamps: { createdAt: true, updatedAt: false },
})
export class ScoreEvent {
  /// Postgres User.id (cuid) referansı — cross-store join uygulama katmanında yapılır.
  @Prop({ required: true, index: true })
  userId!: string;

  /// Bu event'te eklenen skor farkı (mutlak skor değil).
  @Prop({ required: true, type: Number })
  delta!: number;

  /// Event uygulandıktan sonra Redis'te oluşan toplam skor (denetim kopyası).
  @Prop({ required: true, type: Number })
  totalScore!: number;

  /// Sezon tanımlayıcısı, ör. "2026-W33".
  @Prop({ required: true, index: true })
  seasonId!: string;

  /// Skorun kaynağı, ör. "idle_tick", "quest_complete", "purchase".
  @Prop({ required: true })
  source!: string;

  /// İstemciden gelen idempotency anahtarı — tekrar gönderimde çift sayımı önler.
  @Prop({ required: false })
  idempotencyKey?: string;

  /// Mongoose `timestamps` tarafından yazılır — bu yüzden @Prop yok, sadece tip bildirimi.
  createdAt!: Date;
}

export const ScoreEventSchema = SchemaFactory.createForClass(ScoreEvent);

// Sezon + oyuncu bazlı geçmiş sorgusu en sık erişim deseni.
ScoreEventSchema.index({ seasonId: 1, userId: 1, createdAt: -1 });

// Aynı idempotency anahtarının iki kez yazılmasını engeller (sparse: alan opsiyonel).
ScoreEventSchema.index({ idempotencyKey: 1 }, { unique: true, sparse: true });
