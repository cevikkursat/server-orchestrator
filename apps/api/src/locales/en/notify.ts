import type { Shape } from "@panel/shared";
import type { notify as tr } from "../tr/notify.js";

export const notify = {
  auth: {
    lockedTitle: "Panel sign-in locked",
    lockedBody_one: "{{count}} failed sign-in attempt in the last 15 minutes. Sign-in is closed for 15 minutes.\nLast attempt: {{ip}}",
    lockedBody_other: "{{count}} failed sign-in attempts in the last 15 minutes. Sign-in is closed for 15 minutes.\nLast attempt: {{ip}}",
    loginTitle: "Signed in to the panel",
    loginBody: "User: {{username}}\nIP: {{ip}}\nBrowser: {{browser}}",
  },
  cron: {
    failedTitle: "Job failed: {{project}} / {{job}}",
    noOutput: "(no output)",
  },
  test: {
    title: "Test notification ✅",
    body: "Notifications from the server panel are working.",
  },
  security: {
    allowlistTitle: "IP allowlist changed",
    allowlistBody: "The panel now only opens from these addresses:\n{{ips}}",
    allowlistRemoved: "IP restriction removed.",
    passwordTitle: "Panel password changed",
    passwordBody_one: "IP: {{ip}}\n{{count}} other session was signed out.",
    passwordBody_other: "IP: {{ip}}\n{{count}} other sessions were signed out.",
  },
  updater: {
    doneTitle: "Panel updated",
    failedTitle: "Panel update failed",
  },
  monitor: {
    diskTitle: "Disk {{pct}}% full",
    diskBody: "Free space: {{free}} GB. Consider cleaning up old images and backups.",
    memoryTitle: "Memory {{pct}}% full",
    memoryBody: "Available: {{free}} GB / {{total}} GB.",
    projectLabel: "Project: {{name}}",
    databaseLabel: "Database: {{name}}",
    downTitle: "{{label}} stopped",
    status: "Status: {{status}}",
    containerMissing: "Container not found",
    upTitle: "{{label}} is running again",
  },
  maintenance: {
    failedTitle: "Disk cleanup failed",
  },
  health: {
    previewLabel: "{{name}} (PR preview)",
    upTitle: "{{label}} is responding again",
    restarted: "Container restarted.",
    restartFailed: "Couldn't restart the container: {{error}}",
    downTitle: "{{label}} is not responding",
    downBody_one: "{{count}} check failed: {{path}} → {{error}}",
    downBody_other: "{{count}} checks failed in a row: {{path}} → {{error}}",
  },
  explorer: {
    unlockedTitle: "Database explorer unlocked",
    unlockedBody: "User: {{username}}\nIP: {{ip}}",
  },
  deploy: {
    successTitle: "Deploy succeeded: {{project}}",
    failedTitle: "Deploy failed: {{project}}",
    previousRunning: "The previous version keeps running.",
  },
  backup: {
    failedTitle: "Backup failed: {{target}}",
    panelFailedTitle: "Panel backup failed",
  },
  offsite: {
    keyEmailBody: "The recovery key for your off-site backups is below, encrypted with the PASSPHRASE you set in the panel.\nThe passphrase isn't in this email; only you know it. Without it, this text is useless.\n\nSent at        : {{date}}\nKey fingerprint: {{fingerprint}} (should match the one shown in the panel)\n\nEncrypted recovery key (one line, copy all of it):\n{{key}}\n\nTo use it on a new server:\n  Backups → Off-site copy → \"Use an existing recovery key\" → paste this text and enter your passphrase.\nIf the panel isn't running: the cli.js decrypt-backup <file.enc> <output> command also accepts this text and the passphrase.\n\nDon't delete this email; keep your passphrase somewhere separate from your email (a password manager or paper).",
    keyEmailSubject: "{{app}}: encrypted recovery key",
    uploadFailedTitle: "Couldn't send the backup off-site: {{target}}",
  },
} satisfies Shape<typeof tr>;
