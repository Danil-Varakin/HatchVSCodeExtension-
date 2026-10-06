# Hatch for VS Code

Structure-aware patches for source code, in the editor. Instead of line numbers, a
[Hatch](https://github.com/Danil-Varakin/hatchTs) patch describes *where* to change code
in terms of the code's own structure, and the tool finds the spot.

> Русская версия: [README.ru.md](./README.ru.md)

This extension does two things:

- **Generate a patch from your edits.** The new version is what is in the editor right
  now — unsaved changes included. The old one is the file as last saved on disk, or a
  git revision when the project config or your settings name one.
- **Move between a patch and the code it belongs to.** `alt+O` (macOS `⌥⌘O`) jumps to the
  other side — from the code, the patch or the baseline half of a diff; `alt+B`
  (`⌥⌘B`) opens the
  baseline and shows what the hunk replaces. Which patch belongs
  to which file is the core's answer — the `Target` in the patch's header, the patch tree or
  `generate.out` — so it works from the moment the editor opens, without a generate first.

Requires hatch with protocol 4 — hatch 0.4.1 or later. The core ships inside the
extension and is spawned as a process; from a checkout it is the clone next to this one
(see [Development](#development)).

## Requirements

- VS Code 1.101 or later — its Node 22 runtime is what the core runs on.
- The Hatch core runs as a separate process and comes with the extension as a dependency.
  The editor's own Node runtime is used, so a system-wide Node installation is not needed.
- Tree-sitter grammars — nothing to put in place. Since hatch 0.4 they ship inside the
  core's own package (`node_modules/hatch/grammars`), so a patch is generated offline and
  nothing is ever downloaded. A grammar of your own goes in `HATCH_GRAMMAR_DIR`, which the
  core reads first and still holds to its pin.

## Commands

| Command | What it does |
|---|---|
| **Hatch: Generate Patch** (`alt+G`, macOS `⌥⌘G`) | writes the patch where the project puts patches — by default `<file>.hatch` next to the file — and opens it beside the editor |
| **Hatch: Go to the Other Side** (`alt+O`, macOS `⌥⌘O`) | from a hunk to the code it changes, and back from the code to its hunk |
| **Hatch: Go to What the Hunk Replaces** (`alt+B`, macOS `⌥⌘B`) | opens the diff «base ↔ base + patch» with the hunk selected on both sides |
| **Hatch: Preview Patch** | the same diff for the whole patch, from the patch or its code: what a build would write, nothing written |
| **Hatch: Check All Patches** | every `.hatch` of the workspace against the project base, or a branch, tag or commit you name — in the **Hatch Patches** panel of the Explorer |
| **Hatch: Copy Patch Report** | the last check as Markdown: the totals and every patch that needs a look |
| **Hatch: Open Failed Patches** | opens every patch the last check found not applying |
| **Hatch: Show Edits Not in Patch** | diff «base + patch ↔ the file»: the edits in the code its patch does not write |
| **Hatch: Generate Patch Against File…** | pick an old file and generate against it, this once |
| **Hatch: Show Base** | print which base a generate from the active file would use, and where that came from |
| **Hatch: Init Config** | creates a minimal `hatch.config.json` at the repository root and opens it; an existing one is only opened |
| **Hatch: Show Log** | open the Hatch output channel |

Three shortcuts, three keys each: `⌥⌘G`, `⌥⌘O`, `⌥⌘B` on macOS, `alt+G`, `alt+O`,
`alt+B` elsewhere. On macOS Option alone types a character — `alt+O` is `ø` — and Control
does not reliably stop it, so Command is in every macOS chord. Nothing uses Shift there: a
jump worth four keys is worth none. The commands without a chord are in the palette, and
you can bind them — or rebind these — in **Preferences: Open Keyboard Shortcuts**.

The extension starts when the workspace has a `hatch.config.json`, when a Markdown file
is opened, or with the first Hatch command — not in every window.

## What a patch shows

Open a patch and its state is there without a command — worked out again as you edit
the patch, the code or the base.

A `.hatch` is a language of its own: the header, the headings, the `...` `>>>` `<<<`
operators of a `# match` and the notes are colored, and the code inside each hunk is
colored as the language its heading names (Kotlin only with an extension that brings a
Kotlin grammar). Hunks and notes fold; the Outline and the breadcrumbs list the hunks with
their state; typing `match` or `note` offers a snippet. Trailing whitespace in a patch is
significant, so in `.hatch` files it is shown and never trimmed, and format-on-save is off.

Above every `# match`, a line with the hunk's state and where it lands; click it to jump
there (the same as Go to the Other Side):

| Lens | Meaning |
|---|---|
| `✓ src/a.cc:413` | the code holds what the hunk writes, at that line |
| `✓ src/a.cc:413 · depends on an earlier hunk` | the same; its target only exists once an earlier hunk is in |
| `○ not applied · src/a.cc:410` | the code is still its base: the patch is not in it, the line is where it would go |
| `◌ nothing to check: src/a.cc has no unsaved edits` | the base is the saved file and the code is that file: whether the patch is in it cannot be told; a git base can |
| `⚠ differs from the code — regenerate?` | the hunk lands, but the code there has moved on |
| `✗ anchor 3 of 5 not found` | the pattern stops at an anchor the base does not have |
| `✗ fits 4 places` | the pattern is ambiguous: it needs more context |

A broken anchor is underlined on its own line, with the reason in **Problems**; a hunk that
lands nowhere gets a red background, one the code no longer holds a yellow one, both with
a mark on the scrollbar. When nothing can be resolved at all — no file to patch, no base —
a single line at the top of the patch says why, and Problems lists it on the header. A
patch whose file is gone from the upstream is an **orphan**: it has nothing to apply to,
and **Delete Patch…** moves it to the trash after you confirm. A base branch or commit that
is not in the repository asks for a fetch.

On a broken or drifted hunk the light bulb (`ctrl+.`) offers what fits it: **Show How Far
It Got**, **Show the N Places It Fits…**, **Go to the Earlier Hunk**, **Regenerate Patch**.
The ones that only show come first; nothing that rewrites is preferred.

The status bar shows `Hatch: 3/4 hunks` for a patch (click for the log of the last
resolve) and, for a file of code with a patch, the guard — `matches its patch`, `edits not in the
patch` (a build from the patch would drop them) or `patch not applied`; for one without,
its base (click for **Show Base**). In a workspace with no
`hatch.config.json` and no `.hatch` open the extension stays silent and does not start the
core until a Hatch command runs.

**Generate Patch** is offered on the files the core has a grammar for; on any other it
says so before sending anything, unless `hatch.language` names a language. Its progress
shows the time spent. The **Hatch** output channel logs what happened and how long the core
took; the messages exchanged with it — which hold pieces of your files — appear only at the
*Trace* level (**Developer: Set Log Level…**).

## Where the baseline comes from

By default, from the file itself as last saved on disk. The patch then describes exactly
the edits you have not saved yet, and nothing needs configuring.

A project that compares against git names it once in `hatch.config.json` (config schema 2):

```jsonc
{ "version": 2, "generate": { "base": { "head": true } } }   // or "branch": "main", "commit": "…"
```

The buffer is then compared with the file as of that revision — the last commit of the
current branch here. `hatch.base.head`, `hatch.base.branch` and `hatch.base.commit` do
the same for you alone, and `hatch.base.head: false` goes back to the saved file whatever
the config says. The status bar shows the base of the active file (`base HEAD:src/a.cc @
4f1c2e2`), resolved again when you commit or switch branches.

A base out of git is read with the **line endings of the file on disk** unless
`generate.base.eol` or `hatch.base.eol` says otherwise: under `core.autocrlf` git keeps LF
while the file has CRLF, and comparing the two would mark every line as changed. The CLI
keeps `repository` by default; the editor compares with the buffer, which is the disk.

A buffer with nothing to patch against its base says so — `a.cc matches HEAD:src/a.cc,
nothing to patch` — and writes no patch.

**Hatch: Generate Patch Against File…** asks for an old file and compares
the buffer with it instead — the CLI's `--in-old`. It holds for that one run: nothing is
remembered, so the next **Generate Patch**, and navigation, compare with the saved file
again.

When no baseline can be used, the message says why and offers to pick an old file
instead. A git base that cannot be read yet — the file is not committed, the branch does
not exist — is said so, in the message and in the status bar, never swapped for the
saved file. **Hatch: Show Base** writes the base of the active file to the log at any
time, with where each `generate.base` setting came from.

## Where patches go

A patch is a `.hatch` file. By default it sits next to its file: `src/a/b.cc` gets
`src/a/b.cc.hatch`.

`generate.out` moves it. A value with **no extension** — or one ending with a slash, or
naming an existing directory — is a directory and receives `<file name>.hatch`; a file must
be named `*.hatch`. Missing directories are created, and a relative value is measured from
the repository root, so it means the same place here and in a terminal.

A project that patches somebody else's code names that code in `upstream`, and keeps its
patches in a tree of their own:

```jsonc
{ "version": 2, "upstream": "..", "generate": { "out": "patches" } }
```

With this config in `src/brave`, the patch for `src/chrome/browser/ui/browser.h` is
`src/brave/patches/chrome/browser/ui/browser.h.hatch`. `"upstream": "."` is the same
layout inside one repository.

The decision is made by the core, not here: the extension writes to the path the service
reports, which is the path the CLI would have written.

Every patch opens with a header, up to the first blank line:

```
Hatch: 1
Target: src/a/b.cc
Generated-From: 3b18e512dba79e4c8300dd08aeb37f8e728b8dad
Generated-By: hatch 0.4.0
Grammar: tree-sitter-cpp@0.23.4
```

`Target` is the file the patch is for; the core reads it back when pairing a patch with
its code, before the patch tree or `out`. A patch written by hand that has no `Target` is
linked by its name and place; when neither tells, the patch says so on its first line —
add a `Target:` line there.

## Notes on hunks

A `# note` … `# end` block right before a `# match` is your comment on that hunk: prose
in any column, no gutter, never read by the matcher.

```
# note
Keep the retry: the server drops the first request after a restart.
# end

# match cpp
    ...
```

The extension paints notes dimmed and in italics, as comments. A hunk that lands
nowhere gets a red background, one the code no longer holds a yellow one, both with a
mark on the scrollbar; the reason is in the squiggle and in Problems. A patch has at
most one note per hunk, and text between hunks outside a note is a parse error.
Notes need hatch 0.4: older cores refuse such a patch. `generate` writes no notes, so
regenerating a patch drops the ones in it.

## Configuration

Two layers, and they answer different questions.

### Project policy — `hatch.config.json`

How much context a generated hunk carries is a property of the **project**, not of one
developer, so it belongs in a file that travels with the repository: the same two file
versions then produce the same patch in the terminal, in the editor and in CI.

The extension reads it exactly as the CLI does — the search starts at the directory of
the edited file and walks up, stopping at the repository root, so a config above the
repository never applies.

**Hatch: Init Config** creates one at the repository root and opens it (needs hatch with
protocol 4): the newest schema, only `$schema` and `version` — every setting keeps its
built-in default until you add it. The core composes the text; an untrusted workspace
gets nothing written.

```jsonc
{
  "version": 1,
  "generate": {
    "parents": { "min": 2 },
    "siblings": { "min": 1, "max": 8 },
    "bridgeGap": 2
  }
}
```

Every key, what it trades against what, and the defaults are documented once, in the
core:
[Anchoring options and Configuration in the Hatch README](https://github.com/Danil-Varakin/hatchTs#configuration).

### An untrusted workspace

Patches are generated and navigation works, but the workspace does not choose where
patches go: its own `hatch.out` setting is ignored, and a patch its
`hatch.config.json` sends outside the workspace is written only after you confirm.

### Editor settings — your local override

Every key above is also an editor setting, so you can try something without touching a
file everyone shares. Precedence is the one a command-line flag has over the config file:

```
built-in defaults  <  hatch.config.json  <  editor settings
```

| Setting | Config key |
|---|---|
| `hatch.out` | `generate.out` |
| `hatch.language` | `generate.language` |
| `hatch.exact` | `generate.exact` |
| `hatch.bridgeGap` | `generate.bridgeGap` |
| `hatch.parents.min` | `generate.parents.min` |
| `hatch.parents.max` | `generate.parents.max` |
| `hatch.parents.detail.base` | `generate.parents.detail.base` |
| `hatch.parents.required` | `generate.parents.required` |
| `hatch.siblings.min` | `generate.siblings.min` |
| `hatch.siblings.max` | `generate.siblings.max` |
| `hatch.siblings.detail.base` | `generate.siblings.detail.base` |
| `hatch.base.head` | `generate.base.head` |
| `hatch.base.branch` | `generate.base.branch` |
| `hatch.base.commit` | `generate.base.commit` |
| `hatch.base.eol` | `generate.base.eol` |

The three `hatch.base.*` coordinates name the base whole, as a git flag does on the
command line: any of them set replaces the config's `generate.base` entirely.

**A setting you never touched is not sent to the core at all**, so it cannot silently
override the project config. Set one — even to the value that is already the default —
and it wins for you.

Which is which is written to the log on every run:

```
config: /repo/hatch.config.json applied generate.parents.min; overridden by editor settings: generate.bridgeGap
config: none, built-in defaults only
```

A setting that quietly did not apply is the failure that line exists to prevent.

## Known limitations

- **No apply yet.** The extension generates, checks and navigates patches; applying one
  to a file is done with `hatch apply` in a terminal for now.
- **Regenerating drops notes.** `generate` writes no `# note` blocks, so regenerating a
  patch loses them and any hunk written by hand; the dialog before it says so.
- **One file, one patch.** A file has one `.hatch`; there is no second patch beside it.
- **Large files with many edits** can take minutes to generate; the progress
  notification can cancel it at any time.

## Development

`npm install` brings in the core as the release tarball named in `package.json`:

```bash
npm install        # the core, from its GitHub release
npm run build      # bundle into dist/extension.cjs
npm run watch      # rebuild on change
npm run check      # typecheck and tests
npm run test:e2e   # the end-to-end tests, in a real VS Code
```

Against a core you are changing yourself, put the checkout next to this one and link it
without writing it into the manifest:

```
some-dir/
  HatchTS/                  the core — npm install && npm run build
  HatchVSCodeExtension-/    this repository
```

```bash
npm install --no-save ../HatchTS   # node_modules/hatch is a link to the checkout
```

Everything here then runs the core from `HatchTS/dist`: after a change or a `git pull`
there, run `npm run build` in it first. `npm install` without the flag puts the released
core back.

Then press F5, or launch the development host directly:

```bash
code --extensionDevelopmentPath=. /path/to/a/project
```

Code and manifest changes are picked up only after **Developer: Reload Window** in the
window titled *Extension Development Host*.

The rules this repository keeps — the protocol range, the editor settings that mirror the
config — are in [CONTRIBUTING.md](./CONTRIBUTING.md); how the extension is put together is
in [ARCHITECTURE.md](./ARCHITECTURE.md); what changed in each release is in
[CHANGELOG.md](./CHANGELOG.md); how to report a vulnerability is in
[SECURITY.md](./SECURITY.md).

### Packaging

The core runs from `node_modules/hatch` with its own dependencies beside it, so a package
is built against the released core — the one `package.json` names:

```bash
npm install             # the released core
npm run package         # the bundle, the listing check, then hatch-vscode-<version>.vsix
npm run test:packaged   # installs that .vsix in a throwaway profile and runs the suite in it
```

`npm run package` stops if `node_modules/hatch` is a link to a checkout (`npm install
--no-save ../HatchTS`): vsce refuses a path above the package root, and the link would
carry the core's build tree and dev dependencies instead of its package. Before writing the
`.vsix` it checks what goes into it (`scripts/package-contents.mjs`): the bundle, the files
the manifest points at, the core's service entry and the grammars inside it; the sources,
the tests and the local `docs/` stay out (`.vscodeignore`). The repository ships no LICENSE,
so the package is written with `--skip-license`.
