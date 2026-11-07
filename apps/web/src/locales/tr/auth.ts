/** auth ekranlarının metinleri (kaynak dil: Türkçe) */
export default {
  login: {
    title: "Giriş yap",
    username: "Kullanıcı adı",
    password: "Şifre",
    code: "Doğrulama kodu (2FA)",
    submit: "Giriş yap",
    submitting: "Giriş yapılıyor…",
  },
  setup: {
    title: "İlk kurulum",
    subtitle: "Adım 1 / 2 · Yönetici hesabını oluşturun. Kurulum token'ı sunucu loglarında yazıyor.",
    token: "Kurulum token'ı",
    username: "Kullanıcı adı",
    password: "Şifre (en az 12 karakter)",
    password2: "Şifre (tekrar)",
    mismatch: "Şifreler eşleşmiyor",
    continue: "Devam et",
    totp: {
      title: "İki adımlı doğrulamayı kur",
      subtitle: "Adım 2 / 2 · Doğrulama uygulamasıyla (Google Authenticator, 1Password, Aegis…) QR kodu tara. Tarayamıyorsan anahtarı elle gir.",
      qrAlt: "İki adımlı doğrulama QR kodu",
      manualKey: "Elle giriş anahtarı",
      copyKey: "Anahtarı kopyala",
      accountName: "hesap adı",
      code: "Uygulamanın gösterdiği 6 haneli kod",
      verify: "Doğrula ve bitir",
      verifying: "Doğrulanıyor…",
      lostBefore: "Telefonu kaybedersen sunucuda SSH ile",
      lostAfter: "komutu hesabı sıfırlar; veriler kalır.",
    },
  },
} as const;
