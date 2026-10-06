# Changelog

Every release names its four numbers — the extension's version, the hatch protocol range
it speaks, the config schema its `hatch.*` settings mirror, the patch format its `.hatch`
language colors — then what changed, breaking changes first. The rules behind the numbers are in [CONTRIBUTING.md](./CONTRIBUTING.md).

## Unreleased — 0.0.1

**Extension 0.0.1 · protocol 4–4 · config schema 2 · patch format 1 · VS Code 1.101+**

The first release. It needs hatch with protocol 4 and carries hatch 0.4.1 inside the
package: hatch 0.2 and 0.3 (protocols 2–3) are refused at the handshake with "update
hatch".

### Added

- **Generate Patch** (`alt+G`, macOS `⌥⌘G`): the buffer — unsaved edits included —
  against its base, written as a `.hatch` where the CLI would write it (`generate.out`,
  the patch tree of an `upstream`) and opened beside the code. Progress shows the segment
  being synthesized; cancelling stops the core between changes. One file has one patch:
  an existing one is regenerated or opened, never doubled, and a patch there that names
  another file is not written over without saying so.
- **The base**: the file as last saved on disk, or a git revision named by
  `generate.base` (`head`, `branch`, `commit`, `eol`) or the `hatch.base.*` settings. A git
  base that cannot be read yet is said so and never replaced by the saved file. A git base
  is read with the line endings of the file on disk unless `base.eol` says otherwise.
- **Generate Patch Against File…**: one run against an old file you pick,
  as the CLI's `--in-old`.
- **Go to the Other Side** (`alt+O`, macOS `⌥⌘O`): from a hunk to the code it writes, and from the code,
  or from the base half of a diff, back to its hunk. A drifted file is followed line by
  line and named as approximate; a patch not applied yet is followed in the base.
- **Go to What the Hunk Replaces** (`alt+B`, macOS `⌥⌘B`) and **Preview Patch**: a diff of the
  base against the base with the patch applied — what a build would write — nothing
  written anywhere. The hunk is selected on both sides; one whose target only exists
  after an earlier hunk is shown on the right. A patch that does not reproduce the file
  exactly offers **Preview Result**.
- **The patch guard** in the status bar of a file with a patch: `matches its patch`,
  `edits not in the patch` (a build from the patch would drop them), `patch not
  applied`; **Show Edits Not in Patch** diffs base + patch against the file. A file not
  in the base revision reads `new file`.
- Failed hunks explain themselves: the anchor that did not match ("anchor 3 of 5 not
  found") with how far the pattern got in the base; every place an ambiguous pattern fits,
  in a picker.
- **Feedback in the patch** without a command: a lens over every `# match` (`✓`, `○ not
  applied`, `⚠ differs from the code`, `✗ …`), errors on the anchor line in Problems,
  red and yellow backgrounds for broken and drifted hunks, dimmed notes, and
  `Hatch: 3/4 hunks` in the status bar. All of it follows edits of the patch, the code,
  the base on disk, the config, HEAD and branches.
- **Notes on hunks** (`# note` … `# end`, hatch 0.4) are shown as comments.
- Warnings about significant trailing whitespace are underlined on their line of the patch,
  for a patch edited by hand too, and stay after a restart.
- **The `.hatch` language**: the header, headings, operators and notes colored, the code
  of each hunk colored as its language, folding, Outline and breadcrumbs by hunk with its
  state, `match` and `note` snippets; trailing whitespace shown and never trimmed. The
  grammar is generated from the languages of the core the extension ships with.
- **The Hatch Patches panel** in the Explorer: every patch of the workspace checked against
  the project base or a branch, tag or commit you name — before moving to a new upstream —
  worst first, with `✓ · ⚠ · ✗` totals and a badge; **Copy Patch Report** (Markdown) and
  **Open Failed Patches**. Nothing is written.
- **The light bulb** on a broken or drifted hunk of a patch: Show How Far It Got, Show
  the N Places It Fits…, Go to the Earlier Hunk, Regenerate Patch — and Delete Patch… on
  the header of an orphan. Looking comes first; nothing that rewrites is preferred.
- **Honest states.** A patch whose file is gone from the upstream is an orphan, with
  **Delete Patch…** (to the trash, after a confirmation); a base branch or commit that is
  not here asks for a fetch; a patch that names no file points at its header. Each of
  these is also listed in Problems, on the patch's first line. With the saved file as the
  base, code equal to it reads `◌ nothing to check`, not `○ not applied`.
- **Quiet without hatch**: the core is not started, and the status bar stays empty, until
  the workspace has a `hatch.config.json`, a `.hatch` is opened or a Hatch command runs.
- **Generate Patch** is offered only on files the core has a grammar for, and refuses any
  other before sending it, unless `hatch.language` names one. Its progress shows the
  elapsed time; regenerating a patch with notes names how many it would drop, and offers
  Open Existing first.
- **The log** is a log channel with levels: how long each request took (a `resolve` over
  a second is a warning), and the protocol messages, which hold pieces of your files, only
  at *Trace*.
- Fixed: on macOS the shortcuts typed a character instead of running. They were
  `ctrl+alt+…`, and Control does not reliably stop Option from inserting one — `alt+O` is
  `ø`, `alt+G` is `©`. Every macOS chord now holds Command, and none is longer than three
  keys: `⌥⌘G` Generate Patch, `⌥⌘O` Go to the Other Side, `⌥⌘B` Go to What the Hunk
  Replaces — which moved off `alt+shift+O` so that no shortcut needs a fourth key. The
  sentences the extension shows name the chord of the platform it runs on, instead of
  telling every reader `alt+O`.
- **Breaking**: Go to What the Hunk Replaces is `alt+B` (was `alt+shift+O`), and Generate
  Patch Against File… has no default shortcut — it is a one-off, and the *Pick Old File*
  button offers it where a missing base makes it the answer. Bind it in **Preferences:
  Open Keyboard Shortcuts** if you use it often.
- The verdict of a hunk is coloured, not grey: the lens opens with `✅`, `⚪`, `⚠️`, `❌` or
  `⬜`, and the hunk's header carries a mark in `hatch.brokenHunkForeground` or
  `hatch.driftedHunkForeground`. A CodeLens takes no colour of its own — the editor paints
  every lens in `editorCodeLens.foreground` — so the glyph brings one with it.
- Fixed: **Check All Patches** could not be stopped. It asked for a cancel button at a
  location that does not draw one, so a run over hundreds of patches had to finish.
- Fixed: a `resolve` of 999.9 ms was logged as `1000 ms`, and one of 59 999 ms as `60.0 s`.
- Fixed: the light bulb's Go to the Earlier Hunk could skip the hunk just before and land
  on an earlier one; it now names the hunk it goes to (`Go to Hunk 4`), since the core
  says only that a hunk needs an earlier one, never which.
- Fixed: with a patch open beside its code, typing in the code asked the core to apply the
  patch again every time, though neither the patch nor the base had changed — 46 ms per
  burst on a 1 900-line file, 248 ms on a 10 800-line one, on the one core process every
  other request waits behind.
- Fixed: a git base the core resolved without sending its text would have been shown as an
  empty file, with the hunk offsets still pointing into the real one.
- Fixed: the Patches panel could report a patch `broken` while explaining an ambiguity in
  a different hunk.
- Fixed: editing the code did not turn a placed lens into a drifted one when the patch and
  its base were unchanged; an edit made while a patch's table was first built was lost; one slow
  table held up the rebuild of every other; the Outline of a patch lagged one edit
  behind. Alt+G on a `.hatch` says to generate from its code. `hatch.base.eol` set alone,
  with the base named in the config, was not applied; the light bulb offered Go to the
  Earlier Hunk on a hunk that was neither broken nor drifted.
- While a `generate` runs, the other requests wait for it instead of timing out: a long
  step of synthesis no longer restarts the core and loses the patch.
- **Show Base**: which base a generate from the active file would use, and where each
  `generate.base` setting came from; the status bar shows the base of the active file.
- **Init Config**: a minimal `hatch.config.json` at the repository root, composed by the
  core.
- Every `generate.*` key of `hatch.config.json` (schema 2) as a `hatch.*` setting that
  overrides the project config for you only; settings you never touched are not sent.
- **Untrusted workspaces**: the workspace's own `hatch.out` is
  ignored, and a patch its config sends outside the workspace is written only after you
  confirm.
