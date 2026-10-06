# Security

## Supported versions

Before 1.0.0 only the latest release gets fixes.

## Reporting a vulnerability

Please do not open a public issue. Use **Report a vulnerability** on the repository's
*Security* tab (GitHub private vulnerability reporting), with the extension version, the
hatch version from the first lines of the *Hatch* output channel, and the steps to
reproduce.

## What the extension does on your machine

Worth knowing when you judge a report, or decide whether to trust a workspace:

- **One child process.** It runs the hatch core that ships inside the extension
  (`node_modules/hatch`), on the editor's own Node, without a shell. Nothing else is
  executed.
- **No network.** The extension never asks the core to download anything. Tree-sitter
  grammars (`.wasm`, which is executable code) come from the package, from
  `HATCH_GRAMMAR_DIR` or from the local cache the hatch CLI fills; a grammar the core
  downloads itself is checked against a pinned sha256.
- **What it writes.** Patch files (`.md`) where the project config puts them, and
  `hatch.config.json` on **Hatch: Init Config**. Source files are never written.
- **Untrusted workspaces.** A repository you have not trusted may not choose where
  patches go: its own `hatch.out` setting is ignored, a patch its
  `hatch.config.json` sends outside the workspace is written only after you confirm, and
  no config file is created.
- **Logs can contain code.** At its default level the *Hatch* output channel records
  what happened and how long it took, not the text of your files. The messages
  exchanged with the core — which carry pieces of the files you patch — are written only
  at the *Trace* level ("Developer: Set Log Level…"). Check a trace log before pasting it
  into a public issue.
