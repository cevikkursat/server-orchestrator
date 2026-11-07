/** dashboard ekranlarının metinleri (kaynak dil: Türkçe) */
export default {
  header: {
    cores_one: "çekirdek",
    cores_other: "çekirdek",
    memory: "bellek",
    uptime: "açık",
    fallback: "Sunucunun şu anki durumu",
    newProject: "Yeni proje",
  },
  /** Durum noktalarının sesli / ipucu adı (küçük harf) */
  levels: {
    ok: "yolunda",
    info: "bilgi",
    warning: "bakılmalı",
    danger: "acil",
    none: "veri yok",
  },
  band: {
    title: "Sunucu durumu",
    allGood: "Her şey yolunda",
    /** Önünde sayı yazılır: "2 alt sistemde iş var" */
    busy_one: "alt sistemde iş var",
    busy_other: "alt sistemde iş var",
    accessOk: "erişim yolunda",
    subsystems: "Alt sistemler",
    twofa: "İki adımlı giriş",
    short: {
      apps: "UYG.",
      disk: "DİSK",
      backup: "YEDEK",
      dns: "DNS",
      access: "ERİŞİM",
    },
    names: {
      apps: "Uygulamalar",
      disk: "Disk ve bellek",
      backup: "Yedekler",
      dns: "DNS",
      access: "Erişim",
    },
  },
  /** Koruma durumu hücreleri (lib/status.ts → usePosture) */
  posture: {
    access: {
      label: "Erişim",
      tailscaleTitle: "Panel sadece Tailscale ağından açılıyor",
      public: "İnternete açık",
      publicTitle: "Panel internetten açılabiliyor (şifre + 2FA ile)",
    },
    twofa: {
      title: "İki adımlı doğrulama zorunlu",
    },
    backup: {
      label: "Son yedek",
      short: "Yedek",
      autoOffAgo: "{{ago}} · otomatik kapalı",
      autoOff: "Otomatik kapalı",
      failed: "Başarısız",
      none: "Henüz yok",
    },
    offsite: {
      label: "Sunucu dışı kopya",
      short: "Dış kopya",
      notConfigured: "Ayarlı değil",
      failed_one: "{{count}} gönderim başarısız",
      failed_other: "{{count}} gönderim başarısız",
    },
  },
  /** "Seni bekleyenler" listesi (lib/status.ts → useAttention) */
  attention: {
    title: "Seni bekleyenler",
    level: {
      danger: "ACİL",
      warning: "BAKILMALI",
      info: "BİLGİ",
    },
    empty: {
      title: "Şu an ilgilenmen gereken bir şey yok",
      detail: "Uygulamalar çalışıyor, yedekler güncel, disk rahat.",
    },
    actions: {
      inspect: "İncele",
      health: "Sağlık",
      cleanup: "Temizlik",
      setUp: "Ayarla",
      key: "Anahtar",
    },
    caddy: {
      title: "Caddy'ye ulaşılamıyor",
      detail: "Domain değişiklikleri uygulanamıyor; siteler son ayarla çalışmaya devam eder.",
    },
    deployFailed: {
      title: "{{name}} · son deploy başarısız (#{{id}})",
      liveRunning: "Yayında #{{id}} çalışmaya devam ediyor.",
      previousRunning: "Önceki sürüm çalışmaya devam ediyor.",
      notRunning: "Uygulama şu an çalışmıyor.",
    },
    down: {
      title: "{{name}} durdu",
      detail: "Uygulama şu an erişilemez.",
    },
    health: {
      title: "{{name}} yanıt vermiyor",
      detail: "Sağlık kontrolü başarısız.",
    },
    disk: {
      title: "Disk {{pct}} dolu",
      detail: "Eski imajları ve build önbelleğini temizleyerek yer açabilirsiniz.",
    },
    mem: {
      title: "Bellek {{pct}} dolu",
      detail: "En çok bellek kullanan uygulamalar Genel Bakış'ın altında.",
    },
    dns: {
      title_one: "{{count}} domainin DNS kaydı bu sunucuyu göstermiyor",
      title_other: "{{count}} domainin DNS kaydı bu sunucuyu göstermiyor",
      detail: "SSL sertifikası alınamaz; ziyaretçiler siteye ulaşamaz.",
    },
    backupFailed: "Son yedekleme başarısız",
    backupOff: "Otomatik yedekleme kapalı",
    backupStale: "Son başarılı yedek {{ago}}",
    backupNever: "Henüz hiç yedek alınmadı",
    offsite: {
      title: "Sunucu dışı yedek kopyası ayarlı değil",
      detail: "Sunucu kaybolursa yedekler de gider.",
    },
    offsiteOff: {
      title: "Sunucu dışı yedek kopyası kapalı",
      detail: "Ayarlar duruyor ama yedekler sunucu dışına gönderilmiyor.",
    },
    offsiteFailed_one: "{{count}} yedek sunucu dışına gönderilemedi",
    offsiteFailed_other: "{{count}} yedek sunucu dışına gönderilemedi",
    offsiteKey: {
      title: "Kurtarma anahtarı hiç dışarı alınmadı",
      detail: "Sunucu kaybolursa buluttaki yedekler bu anahtar olmadan açılamaz. Göster ya da e-postana gönder.",
    },
  },
  top: {
    title: "En çok kaynak kullananlar",
    kinds: {
      project: "proje",
      database: "veritabanı",
      system: "sistem",
      other: "diğer",
    },
    cols: {
      container: "Container",
      kind: "Tür",
      memory: "Bellek",
      network: "Ağ ↓ / ↑",
    },
    empty: "Çalışan container yok",
    waiting: "İlk ölçüm bekleniyor…",
    measuring: "ölçülüyor…",
    docker: {
      /** Önünde "çalışan / toplam" yazılır */
      running_one: "container çalışıyor",
      running_other: "container çalışıyor",
      images_one: "imaj",
      images_other: "imaj",
      unavailable: "Docker'a bağlanılamıyor. Sunucuda Docker servisinin çalıştığını kontrol edin.",
    },
  },
  server: {
    title: "Sunucu",
    now: "şu an",
    metrics: {
      cpu: "CPU",
      mem: "Bellek",
      disk: "Disk",
      net: "Ağ",
    },
    metricTabs: "Ölçü",
    load: "yük {{values}}",
    unreadable: "okunamadı",
    perSecond: "saniye başına",
    perSecondShort: "/sn",
    timeRange: "Zaman aralığı",
    ranges: {
      "1h": { label: "1 saat", span: "son 1 saat" },
      "6h": { label: "6 saat", span: "son 6 saat" },
      "24h": { label: "24 saat", span: "son 24 saat" },
      "7d": { label: "7 gün", span: "son 7 gün" },
    },
    chartTitle: "{{metric}} {{span}}",
    download: "İndirme",
    upload: "Yükleme",
    downloadLower: "indirme",
    uploadLower: "yükleme",
    netUnavailable: "Ağ trafiği bu ortamda ölçülemiyor.",
    stats: {
      min: "En düşük",
      avg: "Ortalama",
      max: "Tepe",
    },
  },
  forecast: {
    title: "Tahmin",
    span: "önümüzdeki 30 gün",
    disk: {
      unreadable: {
        title: "Disk okunamadı",
        sub: "Bu ortamda disk ölçülemiyor",
      },
      collecting: {
        title: "Disk tahmini için veri birikiyor",
        sub: "Şu an {{pct}} dolu · en az 1 günlük ölçüm gerekir",
      },
      stable: {
        title: "Disk doluluğu sabit",
        sub: "Şu an {{pct}} dolu · son 7 günde belirgin artış yok",
      },
      overYear: "Disk bu hızla 1 yıldan uzun sürede dolar",
      fillsIn_one: "Disk bu hızla ~{{count}} günde dolar",
      fillsIn_other: "Disk bu hızla ~{{count}} günde dolar",
      perDay: "Günde ortalama {{size}} artış",
      today: "bugün {{pct}}",
      fullOn: "~{{date}} {{full}}",
    },
    backup: {
      loading: "Yedek bilgisi yükleniyor",
      offSub: "Yedekler sayfasından açabilirsin",
      next: "Sıradaki yedek: {{when}}",
      retention_one: "{{count}} gün saklanır",
      retention_other: "{{count}} gün saklanır",
    },
    ssl: {
      none: {
        title: "Henüz SSL sertifikası yok",
        sub: "Domain eklenince burada görünür",
      },
      reading: "SSL sertifikaları okunuyor",
      domains_one: "{{count}} domain",
      domains_other: "{{count}} domain",
      expired: "Bir SSL sertifikasının süresi doldu",
      nearest_one: "En yakın SSL yenilemesi: {{count}} gün",
      nearest_other: "En yakın SSL yenilemesi: {{count}} gün",
      certs_one: "{{count}} sertifika · otomatik yenilenir",
      certs_other: "{{count}} sertifika · otomatik yenilenir",
    },
    update: {
      loading: "Sürüm bilgisi yükleniyor",
      notInstalled: {
        title: "Güncelleyici kurulu değil",
        sub: "Panel elle güncelleniyor",
      },
      pending: {
        title: "Panel güncellemesi bekliyor",
        sub_one: "{{count}} yeni değişiklik · Ayarlar'dan güncelle",
        sub_other: "{{count}} yeni değişiklik · Ayarlar'dan güncelle",
      },
      upToDate: "Panel güncel",
    },
  },
  projects: {
    all: "Tümü ({{count}}) →",
    cols: {
      project: "Proje",
      status: "Durum",
      domain: "Domain",
      lastDeploy: "Son deploy",
      time: "Zaman",
    },
    pinned: "Sabitlenmiş",
    lastFailed: "son deploy başarısız",
    live: "yayında",
  },
} as const;
