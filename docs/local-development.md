# Trying the panel locally

This guide walks through the panel on your own computer (written for Windows; macOS and Linux
work the same way). Each section ends with **"Expected"**. If you see something else, note the
section number; screenshots and the error lines from the terminal help a lot.

Turkish version: [local-development.tr.md](local-development.tr.md)

> Not available locally: Tailscale (the panel opens directly on `localhost`), HTTPS, automatic
> deploys from GitHub (push events) and the host network traffic chart. Try those on a server.

---

## 0. Requirements

| Tool | Check | Note |
|---|---|---|
| Node.js 24+ | `node -v` | |
| pnpm 11+ | `pnpm -v` | If missing: `corepack enable` |
| Docker Desktop | `docker ps` | Must be **running** |
| 2FA app on your phone | | Google Authenticator, Authy, 1Password, Microsoft Authenticator… |

Ports `8080`, `2019`, `3100` and `5173` must be free. (The panel API deliberately uses 3100
instead of 3000, which other dev servers often take.)

---

## 1. Install and start

In the project folder (PowerShell or a terminal):

```bash
pnpm install
docker compose -f deploy/docker-compose.dev.yml up -d     # local Caddy (for apps)
pnpm dev                                                 # panel (API + UI)
```

Keep `pnpm dev` running; logs stream in that window. Find this line in the logs:

```
... SETUP TOKEN: 3f9a1c...
```

**Expected:** the log shows `Server listening at http://127.0.0.1:3100`, a line saying the Caddy
config was synced, and the setup token. A warning that `PUBLIC_IP` is not set is normal.

---

## 2. First setup and login

1. Open **http://localhost:5173**.
2. Enter the setup token, a user name and a password of at least 12 characters.
3. Scan the QR code with your phone's 2FA app and enter the 6-digit code.
4. Log out (bottom left), then log in again.

Also try:
- Logging in with a wrong code → must be refused.
- Reusing the code you just used (within 30 seconds) → must be refused. Wait for the next code.

**Expected:** after setup the Overview opens. Logout and login work.

---

## 3. Overview (monitoring)

- Tiles at the top: CPU, memory, disk, network and uptime.
- Charts start empty; the panel samples every 15 seconds and they fill within **1–2 minutes**.
- Hover a chart to see the value at that moment. The table icon (top right) switches to a table.
- Try the "1 hour / 6 hours / 24 hours / 7 days" selector.
- "App resource usage" at the bottom; click headers to sort.

**Expected:** on Windows the **network tile and chart say they cannot be measured**; that is
normal and works on a Linux server. Other containers already running on your computer also show up.

---

## 4. Containers

- The **Containers** page lists all Docker containers.
- Click one → live logs, CPU/memory, **Terminal** and **Details** tabs.

> The list may include containers of other projects on your computer. **Do not stop** them;
> those projects would be affected. Try stop/start on the test projects you create below.

**Expected:** logs stream live; search and pause work.

---

## 5. First project (ready-made image)

**Projects → New project → Docker image**:

| Field | Value |
|---|---|
| Image | `traefik/whoami` (the "Try it" link in the form fills it in) |
| Internal port | `80` |
| Project name | `whoami` |
| Domain | `whoami.localhost` (filled automatically) |

**Create and deploy** → the log streams in the Deploys tab (~10 s).

Then open **http://whoami.localhost:8080**.

Also try:
- **Deploy** again → switches to a new container without downtime.
- The **Logs** tab.

**Expected:** the page shows text starting with `Hostname: ...`. The hostname changes with every
redeploy (new container).

> `whoami.localhost` resolves to your computer automatically in Chrome/Edge/Firefox. If it does
> not open, try `http://localhost:8080` with a `Host: whoami.localhost` header.

---

## 6. Terminal, environment variables, scheduled task

`whoami` has no shell, so create a second project:

| Field | Value |
|---|---|
| Image | `nginx:alpine` |
| Internal port | `80` |
| Project name | `nginx-test` |

1. **Environment variables** tab → add `HELLO = world` → **Save and deploy**.
2. **Terminal** tab → `echo $HELLO` → prints `world`. `ls /`, `top` etc. work too.
3. **Tasks** tab → add a task: name `Test`, schedule `*/5 * * * *`, command
   `echo hello && date` → save → **▶ (Run now)** → the last output appears.
4. A failing task: command `exit 3` → run → shows "failed" and `[exit code 3]`.

**Expected:** everything works; non-ASCII characters and colours render correctly in the terminal.

---

## 7. Broken deploy and rollback

1. `whoami` project → **Settings** → set the image to `alpine` → **Save and deploy**.
2. The deploy **fails** (the container keeps exiting). http://whoami.localhost:8080 still works
   (old version).
3. Set the image back to `traefik/whoami` and save.
4. In **Deploys**, pick an earlier successful deploy → **Roll back to this version**.

**Expected:** a broken deploy does not take the site down; the rollback succeeds.

---

## 8. Domains and redirects

1. **Domains** page → attach `demo.localhost` to `nginx-test`, keep "also redirect
   www.demo.localhost" checked.
2. http://demo.localhost:8080 → nginx welcome page.
3. http://www.demo.localhost:8080 → redirects to `demo.localhost:8080`.
4. Try adding an internationalised domain such as `Exämple.com` → listed as `exämple.com`
   with its `xn--…` form below it. (It will not resolve; this is only to see the format. Delete it afterwards.)

**Expected:** locally the DNS status reads "cannot check" or "no DNS record"; that is normal
(`.localhost` is not a real domain and `PUBLIC_IP` is not set). No SSL row is shown (no HTTPS locally).

---

## 9. Database

1. **Databases → New database** → PostgreSQL, name `testdb` → Create
   (the first time takes 1–2 minutes while the image downloads).
2. On the card, **Connect to project** → project `nginx-test`, variable `DATABASE_URL` → Add.
3. Redeploy `nginx-test` → in the terminal `echo $DATABASE_URL`.
4. On the card, **Back up** → "Backup taken".

Optionally try MariaDB, Redis or MongoDB (the MongoDB image is ~1 GB).

**Expected:** an address like `postgresql://app:...@db-testdb:5432/app`.

---

## 10. Backups

1. **Backups** page → **Back up everything now**.
2. The panel backup and the `testdb` backup are listed → download with the **Download** icon.
3. On the `testdb` backup, the **Restore** icon → type the database name to confirm.

**Expected:** an automatic "safety backup" is taken before the restore and appears in the list.

---

## 11. Notifications (e-mail)

**Option A: real Gmail**
1. Google Account → Security → 2-Step Verification must be on → **App passwords** →
   create a 16-character password.
2. Panel → **Settings → Notifications → E-mail**: Gmail preset, sender account = your Gmail
   address, password = the app password, recipient = your Gmail address.
3. **Send test notification**.

**Option B: fake mailbox (no real mail is sent)**
```bash
docker run -d --name mailpit -p 1025:1025 -p 8025:8025 axllent/mailpit
```
In the panel: SMTP server `localhost`, port `1025`, sender account and password **empty**, any
recipient → **Send test notification** → read mail at **http://localhost:8025**.

Then log out and in again → a "logged in to the panel" mail arrives.

**Expected:** the test mail and the login mail arrive. A wrong password shows a clear error.

---

## 12. Security page

- **Active sessions:** log in from another browser (e.g. a private window) → two sessions →
  end one → that browser is logged out.
- **Change password:** current password + 2FA code + new password.
- **Audit log:** logins, failed attempts, terminal sessions etc.
- **IP allowlist:** no need to try locally. If you do, your current IP (`::1` or `127.0.0.1`)
  must be in the list; otherwise saving is refused.

**Login lock test (optional):** in a private window, log in with a wrong password. The per-IP
limit kicks in first: after 5 attempts per minute it says "Too many requests… try again in …
seconds". Spread attempts over 2–3 minutes; after 10 wrong attempts in total the account lock
kicks in: even correct credentials are refused for 15 minutes. To remove the lock (in a new terminal):

```bash
cd apps/api
npx tsx src/cli.ts unlock
```

The other recovery commands work the same way: `clear-allowlist`, `logout-all`,
`reset-admin --yes` (server equivalents in the [README](../README.md#security)).

---

## 13. GitHub (optional)

You can create a GitHub App locally and **build one of your private repositories**:

1. **Settings → GitHub → Create GitHub App** → *Create* on GitHub → you return to the panel.
2. **Install the app and choose repositories** → pick one or more → reload the panel page.
3. **Projects → New project → GitHub repository** → repository, branch → **Create and deploy**.
4. The deploy log shows the clone, the detected type (a generated Dockerfile if the repo has none) and the build.

> GitHub **cannot send push events** to an app created locally (localhost is not reachable from
> the internet), so you start deploys by hand. When you are done, delete the app on GitHub
> (Settings → Developer settings → GitHub Apps → app → Advanced → Delete) and create a new one
> on the server. **Disconnect** in the panel also opens the removal page.

**Expected:** Node, Python (with a start command), Go and static sites are detected and run.
Python needs a start command (e.g. `gunicorn app:app --bind 0.0.0.0:$PORT`).

---

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| "Cannot reach the API" | `pnpm dev` shows an error; check its last lines |
| Yellow "cannot reach Caddy" warning on projects | Local Caddy is down: `docker compose -f deploy/docker-compose.dev.yml up -d` |
| `port is already allocated` (8080) | Another program uses 8080; free it or change the port in `deploy/docker-compose.dev.yml` |
| `*.localhost:8080` does not open | Try another browser (Chrome/Edge) |
| Deploy "could not pull image" | Internet connection / image name |
| 2FA code always refused | Is the phone's clock automatic? A code cannot be used twice; wait for the next one |
| Missed the setup token | Restart `pnpm dev`; a new token is printed |

## Starting over / cleanup

```bash
# stop pnpm dev (Ctrl+C), then:
# 1) Delete the projects and databases you created in the panel (their containers go too)
# 2) Delete the panel data (account, projects, settings, backups):
rm -rf apps/api/data                 # PowerShell: Remove-Item -Recurse -Force apps/api/data
# 3) Stop the local Caddy:
docker compose -f deploy/docker-compose.dev.yml down
docker rm -f mailpit                 # if you started Mailpit
```

> If you delete the panel data without deleting projects and databases in the panel first, their
> containers (`app-*`, `db-*`) stay in Docker; remove them with `docker rm -f`.
