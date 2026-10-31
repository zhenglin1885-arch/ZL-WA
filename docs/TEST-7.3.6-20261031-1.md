# ZL-WA 7.3.6 test-1 — 2026-10-31

Isolated Windows x64 test package. Stable v7.3.6 and its update channel remain unchanged.
Source fixes: aadd97b, including its multi-account performance, customer row identity,
and idle-window recovery parents. Google Cloud voice transcription is not included.

- Explicit proxy test rebuilds the current account's connection even with unchanged
  settings, then reloads the view after success. Login and chat storage are retained.
- Authenticated and unauthenticated SOCKS5 use an isolated account bridge with
  upstream DNS and no direct-network fallback. Diagnostics report sanitized
  connection/negotiation/authentication/destination errors.
- Send diagnostics remain copyable when WhatsApp fails to load or guest execution
  fails/hangs. Native clipboard and Chromium proxy fixture checks passed.
- Includes reduced background polling, lazy advanced-library loading, notification
  callback cleanup, customer-row identity/layout fixes and window recovery.
- 723 tests passed, 2 skipped; TypeScript, targeted ESLint and source build passed.
  Actual Windows provider failure and 25-account resource usage remain to be tested.

Install the AutoSetup test build over the existing installation and test proxy repair,
copying diagnostics from an error page, customer notes and normal message handling.
Do not delete or clear the existing account storage. No uncertain message is retried
by these changes. Advertising notifications have not been confirmed removed.
