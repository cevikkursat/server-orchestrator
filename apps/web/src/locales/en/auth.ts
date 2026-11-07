import type { Shape } from "../types";
import type tr from "../tr/auth";

export default {
  login: {
    title: "Sign in",
    username: "Username",
    password: "Password",
    code: "Verification code (2FA)",
    submit: "Sign in",
    submitting: "Signing in…",
  },
  setup: {
    title: "First-time setup",
    subtitle: "Step 1 of 2 · Create the admin account. The setup token is printed in the server logs.",
    token: "Setup token",
    username: "Username",
    password: "Password (at least 12 characters)",
    password2: "Confirm password",
    mismatch: "Passwords don't match",
    continue: "Continue",
    totp: {
      title: "Set up two-factor authentication",
      subtitle: "Step 2 of 2 · Scan the QR code with an authenticator app (Google Authenticator, 1Password, Aegis…). If you can't scan it, enter the key manually.",
      qrAlt: "Two-factor authentication QR code",
      manualKey: "Manual entry key",
      copyKey: "Copy key",
      accountName: "account name",
      code: "6-digit code from your app",
      verify: "Verify and finish",
      verifying: "Verifying…",
      lostBefore: "If you lose your phone, run",
      lostAfter: "over SSH on the server to reset the account. Your data stays intact.",
    },
  },
} satisfies Shape<typeof tr>;
