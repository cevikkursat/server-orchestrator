# Contributing

Thanks for helping. Bug reports, fixes, translations and documentation are all welcome. For a
larger change, open an issue first so we can agree on the approach before you spend time on it.

## Development setup

Requirements: Node.js 24+, pnpm 11+ (`corepack enable`), Docker (Docker Desktop on Windows/macOS).

```bash
pnpm install
docker compose -f deploy/docker-compose.dev.yml up -d   # local Caddy on :8080 (admin API on :2019)
pnpm dev                                               # API on :3100, UI on :5173
```

The API prints a one-time setup token in its log; open http://localhost:5173 and enter it. Deployed
projects open at `http://<project>.localhost:8080`. Data lives in `apps/api/data` — delete the
folder to start over. A step-by-step guide with checks is in
[docs/local-development.md](docs/local-development.md).

## Code layout

```
apps/api/src
  modules/<area>/   routes.ts (HTTP) + service.ts (logic) per feature: projects, deploy, backups, …
  lib/              shared helpers: docker, i18n, crypto, errors, validation
  locales/          server-side texts (errors, notifications, logs)
apps/web/src
  pages/            one file per screen
  components/       shared UI (Status, Layout, dialogs, charts, …)
  lib/              data hooks, formatting, dialogs, toasts
  locales/          UI texts, one file per area
packages/shared/src types and zod schemas used by both sides
deploy/             install/update scripts, docker-compose, Caddyfile
```

The API talks to the host only through the Docker socket and a read-only mount of `/`; keep it that
way. Anything that has to run on the host belongs in `deploy/` (see how the updater works).

## Before opening a pull request

- `pnpm typecheck` and `pnpm build` pass. CI runs both, plus `shellcheck deploy/*.sh`.
- UI changes: check them at desktop width and at ~390px (phone). Keep 44px touch targets on phone.
- No browser `confirm()` / `alert()` / `prompt()`: use `confirmDialog` / `showError` from
  `apps/web/src/lib/dialog.tsx`.
- Follow the visual language in [DESIGN.md](DESIGN.md): night ground, one amber accent, status
  as dot + text, Tailwind tokens from `apps/web/src/index.css` (no raw hex in components).
- Every user-facing string goes through translations (below), in both languages.
- Keep examples generic: `example.com`, `203.0.113.10`, no real domains, IPs or e-mails.

## Translations

The interface, API messages and notifications are translated with
[i18next](https://www.i18next.com). Turkish is the source language; every other language must
have exactly the same keys, and TypeScript fails the build if a key is missing or extra.

| What | Where |
|---|---|
| UI texts | `apps/web/src/locales/<lang>/<area>.ts` (`common`, `dashboard`, `projects`, …) |
| API errors, notifications, logs | `apps/api/src/locales/<lang>/{errors,notify,messages}.ts` |
| Form validation messages | `packages/shared/src/locales/validation.<lang>.ts` |

In code:

```ts
import { t } from "../i18n";              // web: works inside and outside components
t("projects:list.empty.title");
t("projects:deploy.started", { name });   // "{{name}}" in the dictionary
t("common:time.daysAgo", { count: 3 });   // plural keys end in _one / _other in every language
```

On the server, throw `new HttpError(404, "errors:project.notFound")`; the error handler translates
it into the request's language. Texts that are stored or sent later (deploy logs, notifications)
use `pt(...)`, which writes in the admin's chosen language.

### Adding a language

1. Copy `apps/web/src/locales/en` to `apps/web/src/locales/<code>` and translate the values.
   Each file ends with `satisfies Shape<typeof tr>`, so the compiler tells you what's missing.
2. Do the same for `apps/api/src/locales/en` and `packages/shared/src/locales/validation.en.ts`.
3. Register the code in `panelLanguages` (`packages/shared/src/i18n.ts`), in `languages` and
   `resources` (`apps/web/src/i18n/index.ts`), in the API's `resources` (`apps/api/src/lib/i18n.ts`),
   and give it a name in `common.language` of every language.
4. Add the Intl locale for dates and numbers in `intlLocale()` (web) and `localeOf()` (API).
5. Run `pnpm typecheck`, then switch the language in the panel and click through the screens.

Write translations the way the product talks: short, plain, second person, sentence case. Keep
product names (Docker, Caddy, Tailscale, GitHub), commands and code as they are.

## Commits

Small, focused commits with a message that says what changed and why. One pull request per topic.

## License

By contributing you agree that your contributions are licensed under the [MIT License](LICENSE).
