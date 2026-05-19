# 1.4.4

- Fixed Claude Code chat silently failing for production users whose 1.4.3 install was missing the bundled ACP resource files. The runtime now embeds those files in the binary and materializes them on first launch as a fallback, so chat works even when bundle.resources didn't ship correctly.
- Pipe ACP subprocess stderr into the desktop log. Anthropic API errors, rate limits, and Claude Agent SDK warnings from inside the ACP runtime now appear in support logs instead of being silently dropped.
