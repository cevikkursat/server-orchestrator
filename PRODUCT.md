# Product

## Platform

web

## Users

- **Primary:** a single developer-administrator running their own VPS. Long sessions at a desk
  (setting up projects, domains, databases, backups) and short, urgent sessions on a phone
  (something is down, a deploy failed, the disk is filling up).
- **Next:** other developers who will self-host the panel on their own server once the repository
  is public. Their first-run experience (install, setup token, 2FA, first project) matters.
- Today there is exactly one admin account per installation; multi-user/team use is not built.

## Product Purpose

A self-hosted control panel that turns one Linux server into a small, safe PaaS: deploy apps from
GitHub or Docker images, give them domains with automatic HTTPS, run databases and services next
to them, back everything up (locally and encrypted off-site) and recover the whole server from
backups. Success: the admin always knows what is running, can fix or roll back from anywhere in a
minute, and never loses data.

## Positioning

- **Security first:** the panel is reachable only over Tailscale, password + TOTP 2FA are
  mandatory, public SSH can be closed, secrets and env vars are encrypted at rest, off-site
  backups are end-to-end encrypted with a separate recovery key, disaster recovery is one flow.
- **One server, simple:** no Kubernetes or clusters; everything on a single VPS, one-click deploy,
  few settings, sensible defaults.
- **Full ownership of data:** database explorer/editor (behind a second 2FA unlock), backups and
  restores, persistent volumes and services such as Orthanc (DICOM) live inside the panel; data
  does not leave the server unless the admin sends it off-site.
- **Plain language:** the UI explains technical parts plainly and errors say what to do next.

## Operating Context

- Accessed in a browser on desktop and on a phone, always through Tailscale.
- Phone jobs, in order of importance: check status (is everything running, disk/memory, last
  deploy), urgent intervention (restart, roll back, read logs, restore a backup), trigger a deploy
  or fix an env var.
- Desk jobs: create projects (GitHub App, monorepo watch paths, compose), domains and access
  rules, databases, backup schedules, off-site storage (S3/R2), notifications, panel updates.
- Real-time surfaces: deploy logs, container logs, terminal, metrics refreshed every few seconds.

## Capabilities and Constraints

- Stack: pnpm monorepo, Fastify + SQLite API, React 19 + Vite + Tailwind v4 web app; Caddy,
  Docker, GitHub App CI/CD.
- UI language is Turkish today. **Multi-language support is desired** (not built yet): copy should
  stay extractable and layouts must tolerate longer strings.
- Never use browser confirm/alert/prompt; the panel's own dialogs only.
- The repository must stay generic: no personal names, domains, IPs or app names in code or
  samples.
- Terminology in use: proje, deploy, domain, veritabanı, yedek, kalıcı klasör, ortam değişkeni,
  ortak değişkenler, container, önizleme (PR preview), sağlık kontrolü.

## Evidence on Hand

- No testimonials, customers, benchmarks or press exist; never fabricate them.
- No logo or brand assets beyond the name "Sunucu Paneli" and a server icon.

## Product Principles

1. State before decoration: what is running, broken or needs a decision comes first, everywhere.
2. Safe by default: destructive or irreversible actions are explicit, named and confirmable;
   recovery paths are always visible.
3. Fix from anywhere: every urgent job is doable on a phone in a few taps.
4. Explain, don't assume: plain wording, actionable errors, no jargon without a hint.
5. One server, few knobs: prefer good defaults over options.

## Accessibility & Inclusion

- Readable on small phones in bright light; status never conveyed by color alone.
- Full keyboard use on desktop; respects reduced motion.
