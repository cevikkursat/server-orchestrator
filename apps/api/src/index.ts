/**
 * Giriş noktası. Panel yedeğinden geri dönüşte panel.db ve secret.key, veritabanı açılmadan ÖNCE
 * yerine konmalı. Statik importlar (ve derleyicinin ortak parçaları) her şeyden önce çalıştığı için
 * panelin geri kalanı ancak bu iş bittikten sonra dinamik olarak yüklenir.
 */
import "./restore-swap.js";

await import("./main.js");
