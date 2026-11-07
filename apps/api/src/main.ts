import { config } from "./config.js";
import { buildServer } from "./server.js";
import { ensureSetupToken, purgeExpiredSessions } from "./modules/auth/service.js";
import { syncCaddyWithRetry } from "./modules/caddy/service.js";
import { failInterruptedDeployments } from "./modules/projects/service.js";
import { failInterruptedBackups } from "./modules/backups/service.js";
import { startOffsite } from "./modules/offsite/service.js";
import { startScheduler } from "./modules/cron/service.js";
import { startMonitor } from "./modules/monitor/service.js";
import { startMetrics } from "./modules/metrics/service.js";
import { checkPublicIpConfig } from "./modules/domains/service.js";
import { startHealthChecks } from "./modules/health/service.js";
import { scheduleCleanup } from "./modules/maintenance/service.js";
import { startTailnetDns } from "./modules/tailnet/dns.js";
import { startUpdaterWatch } from "./modules/updater/service.js";

const app = await buildServer();

const token = ensureSetupToken();
if (token) {
  app.log.warn("==============================================");
  app.log.warn(`ILK KURULUM TOKENI / SETUP TOKEN: ${token}`);
  app.log.warn("Enter this token on the setup screen.");
  app.log.warn("==============================================");
}

failInterruptedDeployments();
failInterruptedBackups();
startOffsite();
syncCaddyWithRetry(app.log);
startScheduler();
startMonitor();
startMetrics();
startHealthChecks();
scheduleCleanup();
startTailnetDns(app.log);
startUpdaterWatch();
checkPublicIpConfig(app.log);

purgeExpiredSessions();
setInterval(purgeExpiredSessions, 60 * 60 * 1000).unref();

await app.listen({ port: config.port, host: config.host });

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, async () => {
    await app.close();
    process.exit(0);
  });
}
