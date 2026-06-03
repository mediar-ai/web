# 1.4.6

- Fixed the main window appearing off-screen: it now recenters automatically when restored from an off-screen position.
- TypeScript workflows now route correctly to the Rust executor, with the executor format detected from the active workflow version for reliable execution.
- Disabled workflows are no longer executed — enabled/disabled state is now read directly from disk.
- Scheduled (cloud cron) runs now receive their per-schedule inputs correctly.
