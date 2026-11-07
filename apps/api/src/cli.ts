/**
 * Acil durum komutları. Sadece sunucuya SSH ile girebilen kişi (siz) çalıştırabilir:
 *
 *   docker exec -it panel node /app/api/dist/cli.js <komut>
 *
 * Komutlar:
 *   unlock           Giriş kilidini kaldırır (çok fazla başarısız deneme sonrası)
 *   clear-allowlist  IP izin listesini temizler (kendinizi dışarıda bıraktıysanız)
 *   logout-all       Tüm oturumları kapatır
 *   reset-admin      Yönetici hesabını siler (telefonu/2FA'yı kaybettiyseniz). Projeler,
 *                    veritabanları ve ayarlar SİLİNMEZ. Panel yeniden başlatılınca logda yeni
 *                    kurulum token'ı çıkar ve hesabı yeniden oluşturursunuz.
 *   decrypt-backup <girdi.enc> <çıktı>
 *                    Sunucu dışına gönderilmiş (şifreli) bir yedeği çözer. Kurtarma anahtarını sorar
 *                    (ya da KURTARMA_ANAHTARI ortam değişkeninden okur).
 */
import { db, schema } from "./db/index.js";
import { audit } from "./lib/audit.js";
import { deleteSetting } from "./lib/settings.js";
import { pt } from "./lib/i18n.js";

const cmd = process.argv[2];
const done = (msg: string) => {
  console.log(msg);
  process.exit(0);
};

switch (cmd) {
  case "unlock": {
    // Kayıtlar silinmez; kilit sayımı bu andan itibaren yeniden başlar
    audit("cli.unlock", null);
    done(pt("messages:cli.unlocked"));
    break;
  }
  case "clear-allowlist": {
    deleteSetting("security");
    audit("cli.clear_allowlist", null);
    done(pt("messages:cli.allowlistCleared"));
    break;
  }
  case "logout-all": {
    const r = db.delete(schema.sessions).run();
    audit("cli.logout_all", null, { count: r.changes });
    done(pt("messages:cli.loggedOut", { count: r.changes }));
    break;
  }
  case "reset-admin": {
    if (process.argv[3] !== "--evet" && process.argv[3] !== "--yes") {
      done(pt("messages:cli.resetConfirm"));
    }
    db.delete(schema.sessions).run();
    db.delete(schema.users).run();
    audit("cli.reset_admin", null);
    done(pt("messages:cli.resetDone"));
    break;
  }
  case "decrypt-backup": {
    const [input, output] = process.argv.slice(3);
    if (!input || !output) done(pt("messages:cli.decryptUsage"));
    const { decryptFile, isWrappedKey, parseKey, unwrapKey } = await import("./modules/offsite/crypto.js");
    let key = process.env.KURTARMA_ANAHTARI ?? "";
    let pass = process.env.KURTARMA_PAROLASI ?? "";
    if (!key || (isWrappedKey(key) && !pass)) {
      const rl = (await import("node:readline/promises")).createInterface({ input: process.stdin, output: process.stdout });
      if (!key) key = await rl.question(pt("messages:cli.keyPrompt"));
      if (isWrappedKey(key) && !pass) pass = await rl.question(pt("messages:cli.passPrompt"));
      rl.close();
    }
    try {
      await decryptFile(input!, output!, isWrappedKey(key) ? await unwrapKey(key, pass) : parseKey(key));
    } catch (err) {
      console.error((err as Error).message);
      process.exit(1);
    }
    done(pt("messages:cli.decrypted", { output }));
    break;
  }
  default:
    done(pt("messages:cli.usage"));
}
