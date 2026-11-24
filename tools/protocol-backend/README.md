# Isolated WhatsApp protocol runtime

Pinned Baileys 7.0.0-rc14, an unofficial WhatsApp Web protocol implementation without a browser page. This is not a WhatsApp Desktop SDK or official Business Platform API.

Install separately with `npm ci --prefix tools/protocol-backend` before packaging. Electron utilityProcess runs worker.mjs from the packaged extraResources directory; existing application dependencies and browser accounts are unchanged. node_modules, including the OS-specific FFmpeg and sharp binaries and their license files, must be present for the packaging OS/architecture. Do not copy Linux binaries into a Windows release.

Each worker is assigned a fixed account directory by the trusted main process. Credentials remain inside the worker, root IPC is authenticated against the application's main frame, attachment IDs resolve only to the existing application media store, and UI data excludes authentication keys. No web page receives this IPC.

Messages and uncertain group/send checkpoints are written atomically. Credential writes are serialized before reconnect; duplicate operation tokens do not resubmit. Node tests use fake sockets and do not prove real server login or media delivery. Native tests exercise actual packaged utility processes, per-account isolation, cache restart, diagnostics privacy, sharp and FFmpeg; UI tests use synthetic messages and intercept all test sends.

See docs/PROTOCOL-CONNECTION-TEST15.md for user-facing scope and limitations. Original queue implementations and the original web mode remain available.
