import fs from "node:fs";
import path from "node:path";
import type { UpdateStatus } from "@panel/shared";
import { config } from "../../config.js";
import { HttpError } from "../../lib/errors.js";
import { getSecret, setSecret } from "../../lib/settings.js";
import { notify } from "../notify/service.js";
import { pt } from "../../lib/i18n.js";

/**
 * Paneli panelden güncelleme.
 *
 * Panel kendi container'ını yeniden oluşturamaz (güncelleme sırasında kendisi kapanır). Bu yüzden
 * işi sunucudaki küçük bir systemd servisi yapar (deploy/update.sh, install-updater.sh kurar):
 *   1. Panel `updater/request` dosyasına "check" ya da "update" yazar
 *   2. systemd dosyayı görünce update.sh'ı admin kullanıcısıyla çalıştırır:
 *        git fetch → (update ise) git merge --ff-only → docker compose up -d --build
 *   3. Sonucu `updater/status.json`'a yazar; panel buradan okur
 * Panel sadece bu iki sabit işi isteyebilir; komut çalıştıramaz.
 */

const dir = config.updaterDir;
const file = (n: string) => path.join(dir, n);
const STALE_MS = 45 * 60_000;
const NOTIFIED_KEY = "updater.notifiedAt";

const empty: UpdateStatus = {
  installed: false,
  state: "idle",
  action: null,
  startedAt: null,
  finishedAt: null,
  branch: null,
  current: null,
  pending: [],
  missingEnv: [],
  log: "",
  error: null,
};

export function updateStatus(): UpdateStatus {
  const installed = fs.existsSync(file("installed"));
  let s: UpdateStatus = { ...empty, installed };
  try {
    s = { ...empty, ...(JSON.parse(fs.readFileSync(file("status.json"), "utf8")) as Partial<UpdateStatus>), installed };
  } catch {
    // henüz hiç çalışmadı
  }
  if (fs.existsSync(file("request")) && s.state !== "running") s.state = "running";
  // Yarıda kalmış (sunucu yeniden başladı vb.)
  if (s.state === "running" && s.startedAt && Date.now() - s.startedAt > STALE_MS) {
    s = { ...s, state: "failed", error: pt("messages:updater.stale") };
  }
  return s;
}

export function requestUpdate(action: "check" | "update") {
  const s = updateStatus();
  if (!s.installed) throw new HttpError(409, "errors:updater.notInstalled");
  if (s.state === "running") throw new HttpError(409, "errors:updater.running");
  fs.writeFileSync(file("request"), action);
}

/** Güncelleme bitince bildirim (panel yeniden başladıktan sonra biter; periyodik bakılır) */
function checkFinished() {
  const s = updateStatus();
  if (s.action !== "update" || !s.finishedAt || (s.state !== "done" && s.state !== "failed")) return;
  const last = getSecret<number>(NOTIFIED_KEY) ?? 0;
  if (s.finishedAt <= last) return;
  setSecret(NOTIFIED_KEY, s.finishedAt);
  if (s.state === "done") {
    notify("panelUpdate", pt("notify:updater.doneTitle"), s.current ? `${s.current.sha.slice(0, 7)} ${s.current.message}` : "", "info");
  } else {
    notify("panelUpdate", pt("notify:updater.failedTitle"), s.error ?? "", "error");
  }
}

export function startUpdaterWatch() {
  fs.mkdirSync(dir, { recursive: true });
  setInterval(checkFinished, 30_000).unref();
  setTimeout(checkFinished, 5000).unref();
}
