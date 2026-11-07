/** e-posta / Telegram / Discord bildirimleri */
export const notify = {
  auth: {
    lockedTitle: "Panel girişi kilitlendi",
    lockedBody_one: "Son 15 dakikada {{count}} başarısız giriş denemesi. Giriş 15 dakika kapalı.\nSon deneme: {{ip}}",
    lockedBody_other: "Son 15 dakikada {{count}} başarısız giriş denemesi. Giriş 15 dakika kapalı.\nSon deneme: {{ip}}",
    loginTitle: "Panele giriş yapıldı",
    loginBody: "Kullanıcı: {{username}}\nIP: {{ip}}\nTarayıcı: {{browser}}",
  },
  cron: {
    failedTitle: "Görev başarısız: {{project}} / {{job}}",
    noOutput: "(çıktı yok)",
  },
  test: {
    title: "Test bildirimi ✅",
    body: "Sunucu panelinden bildirimler çalışıyor.",
  },
  security: {
    allowlistTitle: "IP izin listesi değişti",
    allowlistBody: "Panel artık sadece şu adreslerden açılır:\n{{ips}}",
    allowlistRemoved: "IP kısıtlaması kaldırıldı.",
    passwordTitle: "Panel şifresi değiştirildi",
    passwordBody_one: "IP: {{ip}}\nDiğer {{count}} oturum kapatıldı.",
    passwordBody_other: "IP: {{ip}}\nDiğer {{count}} oturum kapatıldı.",
  },
  updater: {
    doneTitle: "Panel güncellendi",
    failedTitle: "Panel güncellemesi başarısız",
  },
  monitor: {
    diskTitle: "Disk %{{pct}} dolu",
    diskBody: "Boş alan: {{free}} GB. Eski image'ları ve yedekleri temizlemeyi düşünün.",
    memoryTitle: "Bellek %{{pct}} dolu",
    memoryBody: "Kullanılabilir: {{free}} GB / {{total}} GB.",
    projectLabel: "Proje: {{name}}",
    databaseLabel: "Veritabanı: {{name}}",
    downTitle: "{{label}} durdu",
    status: "Durum: {{status}}",
    containerMissing: "Container bulunamadı",
    upTitle: "{{label}} tekrar çalışıyor",
  },
  maintenance: {
    failedTitle: "Disk temizliği başarısız",
  },
  health: {
    previewLabel: "{{name}} (PR önizlemesi)",
    upTitle: "{{label}} tekrar yanıt veriyor",
    restarted: "Container yeniden başlatıldı.",
    restartFailed: "Container yeniden başlatılamadı: {{error}}",
    downTitle: "{{label}} yanıt vermiyor",
    downBody_one: "Üst üste {{count}} kontrol başarısız: {{path}} → {{error}}",
    downBody_other: "Üst üste {{count}} kontrol başarısız: {{path}} → {{error}}",
  },
  explorer: {
    unlockedTitle: "Veritabanı gezgini açıldı",
    unlockedBody: "Kullanıcı: {{username}}\nIP: {{ip}}",
  },
  deploy: {
    successTitle: "Deploy başarılı: {{project}}",
    failedTitle: "Deploy başarısız: {{project}}",
    previousRunning: "Önceki sürüm çalışmaya devam ediyor.",
  },
  backup: {
    failedTitle: "Yedekleme başarısız: {{target}}",
    panelFailedTitle: "Panel yedeği başarısız",
  },
  offsite: {
    keyEmailBody: "Sunucu dışı yedeklerin kurtarma anahtarı aşağıda, panelde belirlediğiniz PAROLA ile şifrelenmiş olarak duruyor.\nParola bu e-postada yok; sadece siz biliyorsunuz. Parola olmadan bu metin işe yaramaz.\n\nGönderim zamanı   : {{date}}\nAnahtar parmak izi: {{fingerprint}} (panelde görünenle aynı olmalı)\n\nŞifreli kurtarma anahtarı (tek satır, tamamını kopyalayın):\n{{key}}\n\nYeni bir sunucuda kullanmak için:\n  Yedekler → Sunucu dışı kopya → \"Mevcut bir kurtarma anahtarını kullan\" → bu metni yapıştırın ve parolanızı girin.\nPanel çalışmıyorsa: cli.js decrypt-backup <dosya.enc> <çıktı> komutu da bu metni ve parolayı kabul eder.\n\nBu e-postayı silmeyin; parolanızı e-postadan ayrı bir yerde (şifre yöneticisi ya da kâğıt) saklayın.",
    keyEmailSubject: "{{app}}: şifreli kurtarma anahtarı",
    uploadFailedTitle: "Yedek sunucu dışına gönderilemedi: {{target}}",
  },
};
