#!/usr/bin/env bash
#
# Canlı Render örneğine karşı yük testi.
#
#   ./perf/run-benchmark.sh
#
# Sonuçlar perf/results/*.json olarak yazılır; grafikleri
# perf/plot.py üretir.
#
# Ölçüm CANLI sunucuda yapılır (yerelde değil): amaç gerçek dağıtımın
# internet üzerinden ne kadar yük kaldırdığını görmek. Bu, yerel ölçüme
# göre daha kötü ama daha dürüst bir sayıdır — ağ gecikmesi dahildir.
set -euo pipefail

BASE="${BASE_URL:-https://scalable-leaderboard-engine.onrender.com}"
OUT="$(dirname "$0")/results"
DURATION="${DURATION:-20}"
mkdir -p "$OUT"

echo "▶ Hedef: $BASE"
echo "▶ Süre : ${DURATION}s / senaryo"
echo

# Soğuk başlangıcı ölçüme karıştırmamak için önce uyandır.
echo "· Sunucu ısıtılıyor…"
for _ in 1 2 3; do curl -s -o /dev/null "$BASE/api/leaderboard?limit=10"; done

# Korumalı uçlar için token al.
TOKEN=$(curl -s -X POST "$BASE/api/auth/identify" \
  -H 'Content-Type: application/json' -d '{"mode":"outside"}' \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['token'])")
echo "· Token alındı"
echo

# senaryo <ad> <eszamanlilik> <yol> [auth]
senaryo() {
  local ad="$1" conn="$2" yol="$3" auth="${4:-}"
  local args=(-d "$DURATION" -c "$conn" -j --renderStatusCodes)
  [ -n "$auth" ] && args+=(-H "Authorization: Bearer $TOKEN")

  echo "· $ad (c=$conn)"
  autocannon "${args[@]}" "$BASE$yol" > "$OUT/${ad}.json" 2>/dev/null

  python3 - "$OUT/${ad}.json" <<'PY'
import json,sys
d=json.load(open(sys.argv[1]))
print(f"    RPS {d['requests']['average']:>8.1f} | p50 {d['latency']['p50']:>6}ms | "
      f"p99 {d['latency']['p99']:>6}ms | hata {d['errors']:>3} | non2xx {d['non2xx']}")
PY
}

# --- Eşzamanlılık taraması: okuma yolu ---------------------------------
for c in 10 25 50 100; do
  senaryo "leaderboard_c${c}" "$c" "/api/leaderboard?limit=100"
done

# --- Uç karşılaştırması (sabit c=50) -----------------------------------
senaryo "around_c50"     50 "/api/leaderboard/around" auth
senaryo "rank_c50"       50 "/api/leaderboard/rank"   auth
senaryo "season_c50"     50 "/api/rewards/season"
senaryo "projection_c50" 50 "/api/rewards/projection"
senaryo "me_c50"         50 "/api/me"                 auth

# --- Sayfa boyutunun etkisi --------------------------------------------
for l in 10 50 100; do
  senaryo "limit_${l}" 50 "/api/leaderboard?limit=${l}"
done

echo
echo "✔ Bitti — sonuçlar: $OUT"
