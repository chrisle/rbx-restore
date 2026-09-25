# RBXport Restore

RBXport Restore puts an RBXport backup back as your rekordbox library. It
replaces the restore that used to live in RBXport's Preferences › Backups,
and looks the same as that screen.

It is built with Tauri 2, Rust and React for macOS and Windows, and is
licensed GPL-2.0-or-later.

## What it does

- Lists the backups in RBXport's Default backup folder, newest first.
  **Change folder…** lists another folder instead; **Use RBXport's folder**
  goes back.
- Opening a backup (the arrow, or **Restore…**) shows what it holds: the
  size of each kind of data as a bar, like RBXport's Rekordbox Data bar, and
  the number of tracks, playlists, intelligent playlists, folders, hot cues,
  memory cues, My Tags, history playlists, analyzed tracks, analysis files
  and artwork images, next to the same counts for your library now.
  Differences are highlighted.
- Restores all of a backup or only the parts you tick: the library
  database, the analysis files, the artwork, or the Sync Manager and
  Automix selections. Leaving the database or the analysis files out shows
  what that means before you confirm.
- **Choose ZIP…** opens a backup saved anywhere, such as an external drive,
  including one that was renamed.
- **Delete** removes a backup from the listed folder.

Backups made by RBXport 0.18.0 and later carry a `summary.json`, so their
details show at once. For an older backup, the app reads the archive to
work the figures out: about 10 seconds for a 10.8 GB backup of 38,705 tracks
on an Apple Silicon Mac. The result is remembered.

## Safety

- Quit rekordbox and RBXport before restoring. The app checks both before it
  starts and again just before it replaces anything.
- A backup is refused if it was taken from a different rekordbox library.
- Nothing is replaced until the chosen parts are fully unpacked beside the
  library, every entry has passed its checksum and the database has passed
  SQLite's `quick_check`. Stopping or an error before then leaves the library
  as it was.
- The restore journal is the one RBXport uses. If a restore is interrupted
  while files are being replaced, the next start of RBXport Restore or RBXport
  rolls it back, or finishes it if the new files were already in place,
  before the library is read.
- If RBXport has an analysis edit it hasn't finished, open RBXport once so it
  can finish it, then quit it and restore.

## Development

The archive format, the summary and the restore itself come from RBXport's
library crates. Pinned snapshots of those crates live under `crates/`, keeping
local and release builds reproducible without a second checkout.

```sh
pnpm install
pnpm dev          # the app
pnpm dev:web      # the window in a browser, with a stand-in backend
```

```sh
pnpm test && pnpm typecheck && pnpm lint
cargo test && cargo clippy --all-targets
```

In the browser, `?rekordbox=1` and `?rbxport=1` have those apps running,
`?pending=1` has an interrupted restore, `?fail=1` fails restores and
`?decline=1` answers no to confirmations.

To try the real app without touching your library, point it at a fixture:
`RBXPORT_OPTIONS` names the `options.json` that locates the library,
`RBXPORT_STATE_DIR` replaces RBXport's backup state folder (where the
backups are listed from and the restore journal is kept), and
`RBXPORT_RESTORE_DIR` replaces this app's settings and cache folders.

## Releases

Pushing a version tag such as `v1.0.0` runs the release workflow on the arc
self-hosted fleet. It builds signed and notarized macOS DMGs for Apple Silicon
and Intel, a signed Windows installer, and Linux AppImage and Debian packages.

Release files share RBXport's R2 bucket under the isolated
`rbxport-restore-<version>-<platform>` namespace. The current download manifest
is `rbxport-restore-latest.json`; RBXport's own `latest.json` is never changed.
A manual workflow run without a tag builds preview artifacts without publishing.

## License

GPL-2.0-or-later. See [LICENSE](LICENSE) and [COPYING](COPYING).
