#!/usr/bin/env python3
"""
Yük testi sonuçlarını grafiğe döker.

    .perfvenv/bin/python perf/plot.py

perf/results/*.json dosyalarını okur, perf/charts/*.png üretir.
Grafikler README'ye gömülür.
"""
import json
import pathlib
import sys

import matplotlib
matplotlib.use("Agg")  # başsız ortam: pencere açmadan dosyaya yazar
import matplotlib.pyplot as plt

ROOT = pathlib.Path(__file__).parent
RESULTS = ROOT / "results"
CHARTS = ROOT / "charts"
CHARTS.mkdir(exist_ok=True)

# Koyu/açık temada da okunabilen, birbirinden ayrışan renkler.
INK = "#1a1a2e"
ACCENT = "#4c6ef5"
WARN = "#f59f00"
GOOD = "#2f9e44"
MUTED = "#adb5bd"

plt.rcParams.update({
    "figure.dpi": 130,
    "font.size": 10,
    "axes.edgecolor": MUTED,
    "axes.labelcolor": INK,
    "text.color": INK,
    "xtick.color": INK,
    "ytick.color": INK,
    "axes.spines.top": False,
    "axes.spines.right": False,
})


def load(name):
    path = RESULTS / f"{name}.json"
    if not path.exists():
        return None
    return json.loads(path.read_text())


def bail(msg):
    print(f"✖ {msg}", file=sys.stderr)
    sys.exit(1)


def annotate(ax, xs, ys, fmt="{:.0f}", dy=6):
    """Her noktanın üstüne değerini yazar — grafik tek başına okunabilsin."""
    for x, y in zip(xs, ys):
        ax.annotate(fmt.format(y), (x, y), textcoords="offset points",
                    xytext=(0, dy), ha="center", fontsize=8, color=INK)


# ---------------------------------------------------------------- 1) Ölçekleme
def chart_scaling():
    conns = [10, 25, 50, 100]
    data = [(c, load(f"leaderboard_c{c}")) for c in conns]
    data = [(c, d) for c, d in data if d]
    if not data:
        return False

    xs = [c for c, _ in data]
    rps = [d["requests"]["average"] for _, d in data]
    p50 = [d["latency"]["p50"] for _, d in data]
    p99 = [d["latency"]["p99"] for _, d in data]

    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(11, 4.2))

    ax1.plot(xs, rps, "o-", color=ACCENT, linewidth=2.2, markersize=7)
    annotate(ax1, xs, rps)
    ax1.set_title("Verim — eşzamanlılık arttıkça", fontweight="bold")
    ax1.set_xlabel("Eşzamanlı bağlantı")
    ax1.set_ylabel("İstek/saniye")
    ax1.grid(alpha=0.25, linestyle="--")
    ax1.set_ylim(0, max(rps) * 1.25)

    ax2.plot(xs, p50, "o-", color=GOOD, linewidth=2.2, markersize=7, label="p50 (medyan)")
    ax2.plot(xs, p99, "s--", color=WARN, linewidth=2.2, markersize=6, label="p99")
    annotate(ax2, xs, p50)
    annotate(ax2, xs, p99)
    ax2.set_title("Gecikme — eşzamanlılık arttıkça", fontweight="bold")
    ax2.set_xlabel("Eşzamanlı bağlantı")
    ax2.set_ylabel("Milisaniye")
    ax2.legend(frameon=False)
    ax2.grid(alpha=0.25, linestyle="--")

    fig.suptitle("GET /api/leaderboard?limit=100 — canlı Render örneği",
                 fontsize=12, fontweight="bold", y=1.02)
    fig.tight_layout()
    fig.savefig(CHARTS / "scaling.png", bbox_inches="tight")
    plt.close(fig)
    return True


# ------------------------------------------------------------ 2) Uç kıyaslama
def chart_endpoints():
    spec = [
        ("leaderboard_c50", "leaderboard\n(ilk 100)"),
        ("around_c50", "around\n(3üst+2alt)"),
        ("rank_c50", "rank\n(tek satır)"),
        ("season_c50", "season\n(geri sayım)"),
        ("projection_c50", "projection\n(ödül tahmini)"),
        ("me_c50", "me\n(birleşik)"),
    ]
    rows = [(lbl, load(k)) for k, lbl in spec]
    rows = [(lbl, d) for lbl, d in rows if d]
    if not rows:
        return False

    labels = [lbl for lbl, _ in rows]
    rps = [d["requests"]["average"] for _, d in rows]
    p99 = [d["latency"]["p99"] for _, d in rows]

    fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(10, 7), sharex=True)

    bars = ax1.bar(labels, rps, color=ACCENT, width=0.6)
    for b, v in zip(bars, rps):
        ax1.text(b.get_x() + b.get_width() / 2, v, f"{v:.0f}",
                 ha="center", va="bottom", fontsize=9, fontweight="bold")
    ax1.set_ylabel("İstek/saniye")
    ax1.set_title("Uç bazında verim (50 eşzamanlı bağlantı)", fontweight="bold")
    ax1.grid(alpha=0.25, axis="y", linestyle="--")
    ax1.set_ylim(0, max(rps) * 1.2)

    bars2 = ax2.bar(labels, p99, color=WARN, width=0.6)
    for b, v in zip(bars2, p99):
        ax2.text(b.get_x() + b.get_width() / 2, v, f"{v:.0f}ms",
                 ha="center", va="bottom", fontsize=9, fontweight="bold")
    ax2.set_ylabel("p99 gecikme (ms)")
    ax2.set_title("Uç bazında kuyruk gecikmesi", fontweight="bold")
    ax2.grid(alpha=0.25, axis="y", linestyle="--")
    ax2.set_ylim(0, max(p99) * 1.2)

    fig.tight_layout()
    fig.savefig(CHARTS / "endpoints.png", bbox_inches="tight")
    plt.close(fig)
    return True


# --------------------------------------------------- 3) Sayfa boyutunun etkisi
def chart_page_size():
    sizes = [10, 50, 100]
    rows = [(s, load(f"limit_{s}")) for s in sizes]
    rows = [(s, d) for s, d in rows if d]
    if not rows:
        return False

    xs = [str(s) for s, _ in rows]
    rps = [d["requests"]["average"] for _, d in rows]
    p50 = [d["latency"]["p50"] for _, d in rows]

    fig, ax1 = plt.subplots(figsize=(7.5, 4.2))
    bars = ax1.bar(xs, rps, color=ACCENT, width=0.55, label="İstek/saniye")
    for b, v in zip(bars, rps):
        ax1.text(b.get_x() + b.get_width() / 2, v, f"{v:.0f}",
                 ha="center", va="bottom", fontsize=9, fontweight="bold")
    ax1.set_xlabel("limit (dönen satır sayısı)")
    ax1.set_ylabel("İstek/saniye", color=ACCENT)
    ax1.tick_params(axis="y", labelcolor=ACCENT)
    ax1.set_ylim(0, max(rps) * 1.25)
    ax1.grid(alpha=0.25, axis="y", linestyle="--")

    ax2 = ax1.twinx()
    ax2.plot(xs, p50, "o-", color=WARN, linewidth=2.2, markersize=8, label="p50 (ms)")
    for x, y in zip(xs, p50):
        ax2.annotate(f"{y:.0f}ms", (x, y), textcoords="offset points",
                     xytext=(0, 9), ha="center", fontsize=8, color=WARN)
    ax2.set_ylabel("p50 gecikme (ms)", color=WARN)
    ax2.tick_params(axis="y", labelcolor=WARN)
    ax2.set_ylim(0, max(p50) * 1.4)
    ax2.spines["right"].set_visible(True)

    ax1.set_title("Sayfa boyutu maliyeti — O(sayfa), O(tablo) değil",
                  fontweight="bold")
    fig.tight_layout()
    fig.savefig(CHARTS / "page-size.png", bbox_inches="tight")
    plt.close(fig)
    return True


# ------------------------------------------------- 4) 2M DAU kapasite analizi
def chart_capacity():
    d = load("leaderboard_c50") or load("leaderboard_c100")
    if not d:
        return False
    rps = d["requests"]["average"]

    # 2M DAU varsayımı: oyuncu günde ~8 kez tabloya bakar. Trafik gün
    # boyunca düz dağılmaz; tepe saat ortalamanın ~3 katıdır (mobil oyunlarda
    # akşam yoğunluğu). Bunlar tahmindir ve grafikte açıkça belirtilir.
    dau = 2_000_000
    views = 8
    peak_multiplier = 3
    daily = dau * views
    avg_rps = daily / 86_400
    peak_rps = avg_rps * peak_multiplier

    labels = ["Ortalama\nyük", "Tepe saat\nyükü", "Tek instance\nölçülen"]
    values = [avg_rps, peak_rps, rps]
    colors = [MUTED, WARN, GOOD]

    fig, ax = plt.subplots(figsize=(8, 4.6))
    bars = ax.bar(labels, values, color=colors, width=0.55)
    for b, v in zip(bars, values):
        ax.text(b.get_x() + b.get_width() / 2, v, f"{v:,.0f}".replace(",", "."),
                ha="center", va="bottom", fontsize=10, fontweight="bold")

    needed = peak_rps / rps
    ax.set_ylabel("İstek/saniye")
    ax.set_title(
        f"2M DAU kapasite analizi — tepe yük için ~{needed:.1f} instance gerekir",
        fontweight="bold")
    ax.grid(alpha=0.25, axis="y", linestyle="--")
    ax.set_ylim(0, max(values) * 1.25)

    note = (f"Varsayım: {dau:,} DAU × günde {views} görüntüleme = "
            f"{daily:,} istek/gün · tepe çarpanı {peak_multiplier}×")
    ax.text(0.5, -0.22, note.replace(",", "."), transform=ax.transAxes,
            ha="center", fontsize=8.5, color=INK, style="italic")

    fig.tight_layout()
    fig.savefig(CHARTS / "capacity.png", bbox_inches="tight")
    plt.close(fig)
    return True


# ------------------------------------------- 5) Gerçek tarayıcı ölçümü
def chart_browser():
    """
    Asıl önemli grafik: tek kullanıcının gerçek deneyimi.

    Yük testleri sunucunun TAVANINI ölçer (50-100 eşzamanlı bağlantı altında
    kuyruk oluşur ve gecikme şişer). Oysa case'in sorusu "oyuncu ekranı
    açtığında ne kadar bekliyor?" — cevabı burada.
    """
    path = RESULTS / "browser-timings.json"
    if not path.exists():
        return False
    data = json.loads(path.read_text())
    reqs = data["requests"]

    labels = [r["endpoint"].replace("?limit=100", "\n(ilk 100)") for r in reqs]
    times = [r["ms"] for r in reqs]

    fig, ax = plt.subplots(figsize=(9, 4.4))
    bars = ax.barh(labels[::-1], times[::-1], color=GOOD, height=0.6)
    for b, v in zip(bars, times[::-1]):
        ax.text(v + 1.5, b.get_y() + b.get_height() / 2, f"{v} ms",
                va="center", fontsize=9, fontweight="bold")

    slowest = max(times)
    ax.axvline(slowest, color=WARN, linestyle="--", linewidth=1.5, alpha=0.8)
    # Etiket alt başlık olarak: başlıkla da, çubuklarla da çakışmaz.
    ax.set_title(
        f"Altı istek paralel gider — sayfa {slowest} ms'de hazır",
        fontsize=10, color=WARN, style="italic", pad=8, loc="center")

    ax.set_xlabel("Yanıt süresi (ms)")
    ax.set_xlim(0, slowest * 1.3)
    ax.margins(y=0.12)
    ax.grid(alpha=0.25, axis="x", linestyle="--")
    fig.suptitle("Gerçek kullanıcı deneyimi — tarayıcıdan canlı API'ye",
                 fontsize=12, fontweight="bold", y=1.02)

    fig.text(0.5, -0.04,
             "Chrome DevTools · Vercel (frontend) → Render (backend) · throttling yok",
             ha="center", fontsize=8.5, style="italic", color=INK)

    fig.tight_layout()
    fig.savefig(CHARTS / "browser.png", bbox_inches="tight")
    plt.close(fig)
    return True


def main():
    if not RESULTS.exists() or not any(RESULTS.glob("*.json")):
        bail("perf/results boş — önce ./perf/run-benchmark.sh çalıştırın")

    made = {
        "browser.png": chart_browser(),
        "scaling.png": chart_scaling(),
        "endpoints.png": chart_endpoints(),
        "page-size.png": chart_page_size(),
        "capacity.png": chart_capacity(),
    }
    for name, ok in made.items():
        print(f"{'✔' if ok else '·'} {name}{'' if ok else ' (veri yok, atlandı)'}")


if __name__ == "__main__":
    main()
