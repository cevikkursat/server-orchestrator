/**
 * API metinleri (kaynak dil: Türkçe). Ad alanları:
 *   errors   → kullanıcıya dönen hata mesajları (HttpError anahtarı: "errors:project.notFound")
 *   notify   → e-posta / Telegram / Discord bildirimleri
 *   messages → deploy logu, yedek, kurtarma vb. sunucunun yazdığı metinler
 */
import { errors } from "./errors.js";
import { notify } from "./notify.js";
import { messages } from "./messages.js";

export const tr = { errors, notify, messages };
export type ApiMessages = typeof tr;
