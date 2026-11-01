# ZL-WA 7.3.6 test-3 — 2026-11-01

Independent Windows x64 prerelease. Stable v7.3.6 and its automatic-update feed
remain unchanged. Source feature: 5b0f95e, including all test-2 recovery fixes.

Translation settings include a default-off “禁止发送中文” switch for each account.
Turning it on blocks Han-containing final outgoing text and supported captions,
including mixed text and supplementary characters, showing “禁止发送中文” while
preserving the draft. It works with outgoing translation disabled. With outgoing
translation enabled, Chinese drafts may be translated first; provider output
still containing Han cannot pass send confirmation. Turning the guard off
restores normal behavior. Background bulk/reply sends and edits check the
selected target account's own saved policy, independently of other accounts.

This is text inspection, not image OCR or speech recognition. The setting uses
existing per-service/account preferences; it does not change separately linked
devices. Previously saved settings default to guard-off.

Includes test-2 customer login/restart/window replacement recovery, taskbar
badge refresh, complete proxy document probing and target-scoped diagnostics.
Google Cloud speech recognition is not included. No real customer messages
were sent during validation, and advertising-notification removal is not claimed.

Before packaging: 742 tests passed, 2 skipped; TypeScript, targeted ESLint,
source build and guest serialization checks passed. Offline native Chromium
verified 24 surface/gesture combinations: mouse and Enter in normal chat,
quote reply, edit variants, image/video/file captions and attachment drawers.
Checks cover guard-on with translation-off, translate-first, Chinese provider
output blocked, foreign text allowed, retained drafts, and guard-off recovery.
Real WhatsApp/Windows behavior remains subject to user testing.
