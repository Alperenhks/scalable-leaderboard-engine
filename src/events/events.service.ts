import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ScoreEvent, ScoreEventDocument } from './schemas/score-event.schema';

/** Mongo'nun tekil anahtar ihlali hata kodu. */
export const MONGO_DUPLICATE_KEY = 11000;

export interface RecordEventInput {
  userId: string;
  delta: number;
  totalScore: number;
  seasonId: string;
  source: string;
  idempotencyKey?: string;
}

/**
 * Append-only skor event log'u.
 *
 * Bilinçli olarak ince tutuldu — repository katmanı değil. Tek işi Mongo
 * erişimini ve tekil anahtar ihlalinin tanınmasını tek yerde toplamak;
 * böylece LeaderboardService yalnızca Redis'e odaklanır.
 */
@Injectable()
export class EventsService {
  constructor(
    @InjectModel(ScoreEvent.name)
    private readonly model: Model<ScoreEventDocument>,
  ) {}

  /**
   * Idempotency ön-kontrolü. Bu bir okuma olduğu için gerçek eşzamanlılığa
   * karşı yarışa açıktır; asıl garanti idempotencyKey üzerindeki unique-sparse
   * index'tir. Buradaki sorgu yalnızca yaygın (ardışık) tekrarları ucuza eler.
   */
  async findByIdempotencyKey(key: string): Promise<ScoreEvent | null> {
    return this.model
      .findOne({ idempotencyKey: key })
      .lean<ScoreEvent>()
      .exec();
  }

  /**
   * Event'i yazar. Tekil anahtar ihlali (E11000) çağırana yansıtılır —
   * telafi kararı orada verilir.
   */
  async record(input: RecordEventInput): Promise<ScoreEvent> {
    const created = await this.model.create(input);
    return created.toObject<ScoreEvent>();
  }

  /** E11000 tespiti kod üzerinden yapılır; hata metnine bakmak kırılgan olurdu. */
  isDuplicateKeyError(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      (error as { code?: number }).code === MONGO_DUPLICATE_KEY
    );
  }
}
