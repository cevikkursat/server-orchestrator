# Paneli yerelde denemek

Bu rehber paneli kendi bilgisayarında (Windows) adım adım denemek içindir. Her bölümün
sonunda **"Beklenen"** kısmı var. Beklenenden farklı bir şey görürsen bölüm numarasıyla
birlikte yaz; ekran görüntüsü ve terminaldeki hata satırları çok işe yarar.

> Yerelde olmayanlar: Tailscale (panel burada doğrudan `localhost`'tan açılır), HTTPS,
> GitHub'dan otomatik deploy (push bildirimi) ve sunucu ağ trafiği grafiği. Bunlar sunucuda denenecek.

---

## 0. Gerekenler

| Araç | Kontrol | Not |
|---|---|---|
| Node.js 24+ | `node -v` | |
| pnpm 11+ | `pnpm -v` | Yoksa: `corepack enable` |
| Docker Desktop | `docker ps` | **Açık ve çalışıyor** olmalı |
| Telefonda 2FA uygulaması | | Google Authenticator, Authy, 1Password, Microsoft Authenticator… |

Bilgisayarında `8080`, `2019`, `3100` ve `5173` portları boş olmalı. (Panel API'si bilerek
3000 yerine 3100 kullanır; 3000 geliştirmede başka uygulamalarca sık kullanılır.)

---

## 1. Kurulum ve başlatma

Proje klasöründe (PowerShell veya terminal):

```bash
pnpm install
docker compose -f deploy/docker-compose.dev.yml up -d     # yerel Caddy (uygulamalar için)
pnpm dev                                                 # panel (API + arayüz)
```

`pnpm dev` açık kalmalı; loglar bu pencerede akar. Logların içinde şu satırı bul:

```
ILK KURULUM TOKENI: 3f9a1c...
```

**Beklenen:** Logda `Server listening at http://127.0.0.1:3100`, `Caddy ayarı senkronize edildi`
ve kurulum token'ı görünür. Uyarı olarak `PUBLIC_IP ayarlanmamış` yazması normaldir.

---

## 2. İlk kurulum ve giriş

1. Tarayıcıda **http://localhost:5173** adresini aç.
2. Kurulum token'ını, bir kullanıcı adını ve en az 12 karakterlik bir şifre gir.
3. Çıkan QR kodu telefondaki 2FA uygulamasıyla okut, 6 haneli kodu gir.
4. Sol alttan **Çıkış yap**, sonra tekrar giriş yap.

Ayrıca dene:
- Yanlış kodla giriş → reddedilmeli.
- Az önce kullandığın kodu (30 saniye dolmadan) tekrar kullanmak → reddedilmeli. Bu yeni
  bir güvenlik özelliği; bir sonraki kodu bekleyip onunla gir.

**Beklenen:** Kurulumdan sonra doğrudan Genel Bakış açılır. Çıkış/giriş sorunsuz çalışır.

---

## 3. Genel Bakış (izleme)

- Üstte CPU, bellek, disk, ağ ve çalışma süresi kutuları.
- Grafikler başta boştur; panel 15 saniyede bir ölçüm alır, **1–2 dakika** içinde dolmaya başlar.
- Grafiğin üzerinde fareyi gezdir → o anın değeri görünür. Sağ üstteki tablo ikonu → tablo görünümü.
- "Son 1 saat / 6 saat / 24 saat / 7 gün" seçicisini dene.
- Altta "Uygulamaların kaynak kullanımı" tablosu, başlıklara tıklayarak sıralanır.

**Beklenen:** Windows'ta **ağ kutusu ve ağ grafiği "ölçülemiyor" der**; bu normal, sunucuda
(Linux) çalışır. Bilgisayarında zaten çalışan başka container'lar da tabloda görünür.

---

## 4. Container'lar

- **Container'lar** sayfası tüm Docker container'larını listeler.
- Birine tıkla → canlı loglar, CPU/bellek, **Terminal** ve **Detaylar** sekmeleri.

> ⚠️ Listede bilgisayarındaki başka projelerin container'ları da olabilir. Onları
> **durdurma**, o projeler etkilenir. Durdur/başlat denemelerini aşağıda oluşturacağın
> test projelerinde yap.

**Beklenen:** Loglar canlı akar, arama/duraklatma çalışır.

---

## 5. İlk proje (hazır image)

**Projeler → Yeni proje → Docker image** sekmesi:

| Alan | Değer |
|---|---|
| Image | `traefik/whoami` (formdaki "Denemek için" bağlantısına basabilirsin) |
| İç port | `80` |
| Proje adı | `whoami` |
| Domain | `whoami.localhost` (otomatik dolar) |

**Oluştur ve deploy et** → Deploylar sekmesinde log canlı akar (~10 sn).

Sonra **http://whoami.localhost:8080** adresini aç.

Ayrıca dene:
- **Deploy et** butonuyla tekrar deploy → kesinti olmadan yeni container'a geçer.
- **Loglar** sekmesi.

**Beklenen:** Sayfada `Hostname: ...` ile başlayan bir metin görünür. Her yeniden deploy'da
`Hostname` değişir (yeni container).

> `whoami.localhost` Chrome/Edge/Firefox'ta otomatik olarak bu bilgisayara gider. Açılmazsa
> `http://localhost:8080` adresini `Host: whoami.localhost` başlığıyla deneyebiliriz; yaz.

---

## 6. Terminal, ortam değişkenleri, zamanlanmış görev

`whoami` image'ında shell yok; bunun için ikinci bir proje aç:

| Alan | Değer |
|---|---|
| Image | `nginx:alpine` |
| İç port | `80` |
| Proje adı | `nginx-test` |

1. **Ortam değişkenleri** sekmesi → `MERHABA = dunya` ekle → **Kaydet ve deploy et**.
2. **Terminal** sekmesi → `echo $MERHABA` yaz → `dunya` çıkmalı. `ls /`, `top` gibi komutlar da çalışır.
3. **Görevler** sekmesi → Görev ekle: isim `Deneme`, zamanlama `*/5 * * * *`,
   komut `echo merhaba && date` → kaydet → **▶ (Şimdi çalıştır)** → son çıktı görünür.
4. Hatalı görev: komut `exit 3` → çalıştır → "başarısız" ve `[çıkış kodu 3]` görünmeli.

**Beklenen:** Hepsi çalışır; terminalde Türkçe karakterler ve renkler düzgün görünür.

---

## 7. Bozuk deploy ve geri dönüş

1. `whoami` projesi → **Ayarlar** → image'ı `alpine` yap → **Kaydet ve deploy et**.
2. Deploy **başarısız** olur ("sürekli kapanıp yeniden başlıyor" mesajı). http://whoami.localhost:8080
   hâlâ çalışmalı (eski sürüm).
3. Image'ı tekrar `traefik/whoami` yap ve kaydet.
4. **Deploylar** sekmesinde eski başarılı bir deploy'u seç → **Bu sürüme geri dön**.

**Beklenen:** Bozuk deploy siteyi kapatmaz; geri dönüş başarılı olur.

---

## 8. Domainler ve yönlendirme

1. **Domainler** sayfası → `demo.localhost` adresini `nginx-test` projesine bağla,
   "www.demo.localhost adresini de yönlendir" işaretli kalsın.
2. http://demo.localhost:8080 → nginx karşılama sayfası.
3. http://www.demo.localhost:8080 → `demo.localhost:8080`'e yönlenmeli.
4. `Örnek.com` gibi Türkçe karakterli bir domain eklemeyi dene → listede `örnek.com` olarak,
   altında `xn--…` biçimiyle görünür. (Gerçekte açılmaz, sadece biçimi görmek için; sonra sil.)

**Beklenen:** Yerelde DNS durumu "kontrol edilemiyor" veya "DNS kaydı yok" görünür; normaldir
(`.localhost` gerçek bir domain değil ve `PUBLIC_IP` ayarlı değil). SSL satırı görünmez (yerelde HTTPS yok).

---

## 9. Veritabanı

1. **Veritabanları → Yeni veritabanı** → PostgreSQL, isim `testdb` → Oluştur
   (ilk seferde image indirildiği için 1–2 dk sürebilir).
2. Kartta **Projeye bağla** → proje `nginx-test`, değişken `DATABASE_URL` → Ekle.
3. `nginx-test` projesini yeniden deploy et → Terminal'de `echo $DATABASE_URL`.
4. Kartta **Yedekle** → "Yedek alındı".

İstersen MariaDB, Redis veya MongoDB de dene (MongoDB image'ı ~1 GB).

**Beklenen:** `postgresql://app:...@db-testdb:5432/app` biçiminde bir adres görünür.

---

## 10. Yedekler

1. **Yedekler** sayfası → **Şimdi tümünü yedekle**.
2. Listede panel yedeği ve `testdb` yedeği görünür → **İndir** ikonuyla indir.
3. `testdb` yedeğinde **Geri yükle** ikonu → onay için veritabanı adını yaz.

**Beklenen:** Geri yüklemeden önce otomatik bir "güvenlik yedeği" alınır ve listede görünür.

---

## 11. Bildirimler (e-posta)

**Seçenek A: Gerçek Gmail**
1. Google Hesabı → Güvenlik → 2 Adımlı Doğrulama açık olmalı → **Uygulama şifreleri** →
   16 haneli şifre oluştur.
2. Panel → **Ayarlar → Bildirimler → E-posta**: Gmail hazır ayarı, gönderen hesap = Gmail
   adresin, şifre = uygulama şifresi, alıcı = Gmail adresin.
3. **Test bildirimi gönder**.

**Seçenek B: Sahte mail kutusu (gerçek mail gitmez)**
```bash
docker run -d --name mailpit -p 1025:1025 -p 8025:8025 axllent/mailpit
```
Panelde: SMTP sunucusu `localhost`, port `1025`, gönderen hesap ve şifre **boş**, alıcı herhangi
bir adres → **Test bildirimi gönder** → mailleri **http://localhost:8025** adresinde gör.

Ardından çıkış yapıp tekrar gir → "Panele giriş yapıldı" maili gelmeli.

**Beklenen:** Test maili ve giriş maili gelir. Yanlış şifrede anlaşılır bir Türkçe hata çıkar.

---

## 12. Güvenlik sayfası

- **Aktif oturumlar:** başka bir tarayıcıdan (ör. gizli pencere) giriş yap → iki oturum görünür →
  birini kapat → o tarayıcı çıkış yapmış olur.
- **Şifre değiştir:** mevcut şifre + 2FA kodu + yeni şifre.
- **İşlem kaydı:** girişler, başarısız denemeler, terminal açma vb.
- **IP kısıtlaması:** yerelde deneme yapmana gerek yok. Denersen şu anki IP'n (`::1` veya
  `127.0.0.1`) listede olmalı; değilse kayıt zaten reddedilir.

**Giriş kilidi denemesi (isteğe bağlı):** Gizli pencerede yanlış şifreyle giriş dene.
Önce IP başına sınır devreye girer: dakikada 5 denemeden sonra "Çok fazla istek… saniye sonra
tekrar deneyin" der. Denemeleri 2–3 dakikaya yayıp toplam 10 yanlış denemeye ulaşınca hesap
kilidi devreye girer: doğru bilgilerle de giriş 15 dk kapanır ("Çok fazla başarısız deneme").
Kilidi kaldırmak için (yeni bir terminalde):

```bash
cd apps/api
npx tsx src/cli.ts unlock
```

Diğer kurtarma komutları da aynı şekilde çalışır: `clear-allowlist`, `logout-all`,
`reset-admin --evet` (sunucudaki karşılıkları [README](../README.tr.md)'de).

---

## 13. GitHub (isteğe bağlı)

Yerelde GitHub App oluşturup **private bir reponu build ederek** deneyebilirsin:

1. **Ayarlar → GitHub → GitHub App oluştur** → GitHub'da *Create* → panele dönersin.
2. **App'i kur ve repo seç** → bir veya birkaç repo seç → panelde sayfayı yenile.
3. **Projeler → Yeni proje → GitHub reposu** → repo, branch → **Oluştur ve deploy et**.
4. Deploy logunda repo çekilir, tür algılanır (Dockerfile yoksa üretilen Dockerfile görünür) ve build edilir.

> Yerelde oluşturulan App'e GitHub **push bildirimi gönderemez** (localhost internetten görünmez),
> yani deploy'ları elle başlatırsın. Denemen bitince bu App'i GitHub'dan sil
> (Settings → Developer settings → GitHub Apps → App → Advanced → Delete); sunucuda yenisini
> oluşturacağız. Paneldeki **Bağlantıyı kaldır** da kaldırma sayfasını açar.

**Beklenen:** Node, Python (başlatma komutuyla), Go veya statik siteler otomatik algılanıp çalışır.
Python için başlatma komutu gerekir (ör. `gunicorn app:app --bind 0.0.0.0:$PORT`).

---

## Sorun giderme

| Belirti | Neden / çözüm |
|---|---|
| "API'ye ulaşılamıyor" | `pnpm dev` penceresinde hata var; son satırları gönder |
| Projelerde sarı "Caddy'ye ulaşılamıyor" uyarısı | Yerel Caddy kapalı: `docker compose -f deploy/docker-compose.dev.yml up -d` |
| `port is already allocated` (8080) | 8080'i kullanan başka bir program var; söyle, portu değiştirelim |
| `*.localhost:8080` açılmıyor | Tarayıcıyı değiştir (Chrome/Edge) veya yaz |
| Deploy "Image çekilemedi" | İnternet bağlantısı / image adı; image adını kontrol et |
| 2FA kodu hep reddediliyor | Telefonun saati otomatik mi? Ayrıca aynı kodu iki kez kullanamazsın, sonrakini bekle |
| Kurulum token'ını kaçırdım | `pnpm dev`'i durdurup yeniden başlat, yeni token yazar |

## Sıfırdan başlamak / temizlik

```bash
# pnpm dev'i durdur (Ctrl+C), sonra:
# 1) Panelde oluşturduğun projeleri ve veritabanlarını sil (container'lar da silinir)
# 2) Panel verisini sil (hesap, projeler, ayarlar, yedekler):
rm -rf apps/api/data                 # PowerShell: Remove-Item -Recurse -Force apps/api/data
# 3) Yerel Caddy'yi kapat:
docker compose -f deploy/docker-compose.dev.yml down
docker rm -f mailpit                 # Mailpit'i açtıysan
```

> Panel verisini silmeden önce panelden projeleri ve veritabanlarını silmezsen, onların
> container'ları (`app-*`, `db-*`) Docker'da kalır; `docker rm -f` ile elle silebilirsin.
