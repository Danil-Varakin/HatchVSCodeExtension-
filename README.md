# Hatch for VS Code

Structure-aware patches for source code, in the editor. Instead of line numbers, a
[Hatch](https://github.com/Danil-Varakin/hatchTs) patch describes *where* to change code
in terms of the code's own structure, and the tool finds the spot.

> Русская версия: [README.ru.md](./README.ru.md)

This extension does two things:

- **Generate a patch from your edits.** The baseline is the file as last saved on disk,
  the new version is what is in the editor right now — unsaved changes included.
- **Move between a patch and the code it belongs to.** `alt+O` jumps to the other side;
  `alt+shift+O` opens the baseline and shows what the hunk replaces. Navigation needs a
  patch tree, so it requires `generate.mirror`.

## Requirements

The extension runs the Hatch core as a separate process and ships it as a dependency.
Nothing else is required — the editor's own Node runtime is used, so a system-wide Node
installation is not needed.

Tree-sitter grammars are fetched once into a cache shared with the CLI:

```bash
npm run grammars
```

## Commands

| Command | What it does |
|---|---|
| **Hatch: Generate Patch** | writes `<file>.md` next to the file and opens it beside the editor |
| **Hatch: Go to the Other Side** (`alt+O`) | from a hunk to the code it changes, and back from the code to its hunk |
| **Hatch: Go to What the Hunk Replaces** (`alt+shift+O`) | opens the baseline beside the file and points at the text the hunk replaces |
| **Hatch: Pick Baseline File** | compare against some other file instead of the saved one |
| **Hatch: Clear Baseline Override** | drop that choice |
| **Hatch: Show Baseline Resolution** | print which baseline was used, and what was tried |
| **Hatch: Show Log** | open the Hatch output channel |

## Where the baseline comes from

By default, from the file itself as last saved on disk. The patch then describes exactly
the edits you have not saved yet, and nothing needs configuring.

**Hatch: Pick Baseline File** replaces it for one file — for comparing against a pristine
copy kept somewhere else. The choice is remembered until **Clear Baseline Override**.

When no baseline can be used, the message names the path that was tried. The same report
is available at any time through **Hatch: Show Baseline Resolution**.

## Where patches go

By default the patch sits next to its file: `src/a/b.cc` gets `src/a/b.cc.md`.

`generate.out` moves it. A value with **no extension** — or one ending with a slash, or
naming an existing directory — is a directory and receives `<file name>.md`; a value with
an extension is the file itself. Missing directories are created, and a relative value is
measured from the repository root, so it means the same place here and in a terminal.

`generate.mirror` keeps them in a tree of their own instead. With

```jsonc
{ "version": 1, "generate": { "out": "patches", "mirror": true } }
```

the patch for `chromium_src/browser/core/apdate.cc` is written to
`patches/chromium_src/browser/core/apdate.cc.md`, and missing directories are created.

Paths are measured from the **repository root** — the nearest ancestor holding `.git`.
A file outside any repository is an error rather than a guess, and a relative `out` is
taken from that root, so the editor and `hatch generate` in a terminal write to the same
place. `out` is required when mirroring is on, and is then always read as a directory.

The decision is made by the core, not here: the extension writes to the path the service
reports, which is the path the CLI would have written.

## Configuration

Two layers, and they answer different questions.

### Project policy — `hatch.config.json`

How much context a generated hunk carries is a property of the **project**, not of one
developer, so it belongs in a file that travels with the repository: the same two file
versions then produce the same patch in the terminal, in the editor and in CI.

The extension reads it exactly as the CLI does — the search starts at the directory of
the edited file and walks up, stopping at the repository root, so a config above the
repository never applies.

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

### Editor settings — your local override

Every key above is also an editor setting, so you can try something without touching a
file everyone shares. Precedence is the one a command-line flag has over the config file:

```
built-in defaults  <  hatch.config.json  <  editor settings
```

| Setting | Config key |
|---|---|
| `hatch.out` | `generate.out` |
| `hatch.mirror` | `generate.mirror` |
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

**A setting you never touched is not sent to the core at all**, so it cannot silently
override the project config. Set one — even to the value that is already the default —
and it wins for you.

Which is which is written to the log on every run:

```
config: /repo/hatch.config.json applied generate.parents.min; overridden by editor settings: generate.bridgeGap
config: none, built-in defaults only
```

A setting that quietly did not apply is the failure that line exists to prevent.

## Development

```bash
npm install        # requires the hatch dependency to be reachable
npm run build      # bundle into dist/extension.cjs
npm run watch      # rebuild on change
npm run check      # typecheck and tests
```

Then press F5, or launch the development host directly:

```bash
code --extensionDevelopmentPath=. /path/to/a/project
```

Code and manifest changes are picked up only after **Developer: Reload Window** in the
window titled *Extension Development Host*.
