# ZL-WA 7.3.6 test-2 — 2026-10-31

Independent Windows x64 prerelease; stable v7.3.6 and automatic updates remain unchanged.
Source: 384ed89 with its taskbar and proxy document-probe parents.

- Customer identity rebinding on new login/document/window and late PN/LID
  readiness reloads saved notes instead of retaining stale empty bundles.
- Bounded guest/helper initialization can recover from timeouts. One stalled
  account cannot block customer tools in a selected healthy account.
- Saved customer records remain in userData/customers.json when a service is
  removed. The same verified WhatsApp owner can restore them in another window
  within the same data directory. This is local recovery, not cloud sync;
  window names, groups and proxy settings are separate service preferences.
- Windows taskbar unread overlays are refreshed after show/restore/focus using
  the latest unread count, with bounded timers and cached image assets.
- Proxy tests now read the full GET document rather than HEAD alone. A successful
  probe does not assert that subsequent WhatsApp resources/chat sockets work.
  Diagnostics separate WhatsApp failures from unrelated background requests.
- Includes test-1's proxy reconnect, unavailable-page diagnostic copying, customer
  row identity fixes, idle-window recovery and multi-account performance work.
- Google Cloud voice recognition is not included. Advertising notification
  removal has not been confirmed; normal customer notifications remain enabled.

Validation before packaging: 739 tests passed, 2 skipped; TypeScript, targeted
ESLint, source build and offline Chromium customer/owner isolation fixtures
passed. Actual Windows taskbar behavior and real WhatsApp login restoration
still require the user's machine/provider verification.
