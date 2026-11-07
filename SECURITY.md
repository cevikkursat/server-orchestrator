# Security policy

Server Panel holds root-equivalent access to the server it runs on (it talks to the Docker
socket), so security reports are taken seriously.

## Reporting a vulnerability

Please **do not open a public issue**. Use GitHub's private reporting instead:
**Security → Report a vulnerability** on this repository.

Include what you can: the affected version or commit, how to reproduce it, and the impact you see.
You'll get an acknowledgement within a few days. Once a fix is released, you're welcome to be
credited in the release notes.

## Supported versions

Only the latest commit on `main` is supported. The panel updates itself from `main`
(**Settings → Panel updates**), so please confirm the issue there first.

## Scope

In scope: the panel API and UI, the install and update scripts in `deploy/`, and the default
configuration they produce.

Out of scope: vulnerabilities in the apps you deploy, in third-party images, or in Docker, Caddy
or Tailscale themselves (report those upstream), and setups that deliberately weaken the defaults
(for example exposing the panel to the internet with `PANEL_ACCESS=public` without an IP allowlist).

## Hardening built in

See [README → Security](README.md#security) for the layers that protect a default install:
Tailscale-only access, mandatory 2FA, brute-force limits, encrypted secrets and backups, and the
audit log.
