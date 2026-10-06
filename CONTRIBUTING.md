# Contributing

> Русская версия: [CONTRIBUTING.ru.md](./CONTRIBUTING.ru.md)

The extension is a client of the hatch service. The rules for all three of hatch's
numbers live in the core, in
[VERSIONING.md](https://github.com/Danil-Varakin/hatchTs/blob/main/VERSIONING.md), and
bind here as they bind there. What follows is the part that concerns this repository.
How the code is put together is in [ARCHITECTURE.md](./ARCHITECTURE.md).

## Setup

```bash
npm install        # the core: the release tarball named in package.json
npm run check      # typecheck and tests
npm run test:e2e   # the end-to-end tests, in a real VS Code
```

F5 starts an *Extension Development Host* (`.vscode/launch.json`, built by the `build`
task). Code and manifest changes need **Developer: Reload Window** in that window.

Against a core you are changing yourself, put the checkout next to this one and hand it to
npm without writing it down:

```
some-dir/
  HatchTS/                  git clone …/HatchTS && npm install && npm run build
  HatchVSCodeExtension-/    this repository
```

```bash
npm install --no-save ../HatchTS   # node_modules/hatch is a link to the checkout
```

Everything here then runs the core from `HatchTS/dist`: after a change or a `git pull`
there, run `npm run build` in it first. `npm install` without the flag puts the released
core back — and `npm run package` refuses the link, because a `.vsix` cannot carry a path
above its own root.

A package is built against the released core alone:

```bash
npm run package    # the bundle, the listing check, then hatch-vscode-<version>.vsix
npm run test:packaged   # installs that .vsix in a throwaway profile and runs the suite in it
```

## The one architectural rule

**The extension holds no Hatch logic.** It does not parse `.hatch`, match patterns, carry
positions between versions of a file, or work out where a patch goes or which file it
belongs to. It asks the core (`generate`, `resolve`, `apply`, `config`, `pair`) and shows
the answer. A second copy of any of these rules would drift from the core silently and
produce plausible, wrong coordinates. If a feature seems to need such a rule, the rule
goes into the core and reaches the extension through the protocol.

The other rule of thumb: **never jump somewhere plausible.** Every answer is an exact
place, a place named as approximate, or a refusal with its reason and a next step.

## The protocol range (R7–R9)

- The extension declares a **range**, `SUPPORTED_PROTOCOL = { min, max }` in
  `src/service/protocol.ts`: `max` is the newest protocol it was written and tested
  against, `min` the oldest core it still works with.
- It is compatible with a core when the ranges overlap: `min ≤ protocol` and
  `protocolMin ≤ max`. A core without `protocolMin` (protocol 2 and older) is read as
  `protocolMin = protocol`.
- **Never compare protocol numbers for equality** (R9): it breaks the extension on every
  raise of the protocol, compatible or not.
- `max` is raised only after the tests have run against a core of that protocol. `min` is
  raised only when the extension starts to rely on something older cores lack — and that
  is a breaking change for the extension.
- The extension speaks `min(protocol of the core, max)` and uses nothing newer.
- Paths in requests are absolute (protocol 2): the service has no working directory.
- Protocol types are re-exported from `hatch/protocol`, never copied: a mismatch with
  the core is a compile error, not a silent drift.

## Editor settings mirror the config (E1)

- Every `generate.*` key of `hatch.config.json` has a `hatch.*` setting with the same path
  minus `generate.` (`generate.base.eol` → `hatch.base.eol`), the same meaning and the
  same values. Unset by default (`null` or an empty string), which leaves the choice to
  the config; set, it overrides the config for that person only, as a CLI flag does.
- A setting ships **in the same release** as support for the config schema that brought
  its key. A key removed or renamed in the core goes the same way here.
- No `hatch.*` setting without a config key. An exception is written below, with its
  reason, before the setting ships.
- The default is the core's, except as listed here, with the reason:
  - `base.eol`: when neither the setting nor the config names it, the extension sends
    `worktree`, while the core and the CLI default to `repository`. The extension
    compares with the buffer, and the buffer is the file on disk: under `core.autocrlf` a
    base with the repository's endings would mark every line as changed.
- `test/settings-config.test.ts` checks `package.json` against the newest config schema of
  the core the extension is built with, and the settings an untrusted workspace may not
  set against the ones the code ignores there.

## Tests

`npm test` runs `node --test` over `test/**/*.test.ts`, with no editor:

- **Pure modules** — hunk picking, trimming, the index store, verdicts, settings —
  are tested alone. Keep new logic in pure modules for that reason: the
  editor glue stays thin.
- **Against the real core** — the client, `config`/`pair`/`resolve`, the coordinates
  navigation relies on. Coordinates are never tested against hand-written fixtures: a
  hand-made hunk can agree with a test and disagree with the service.
- **Against a fake core** (`test/fixtures/fake-service.mjs`) — only for what the real one
  cannot be made to do on cue: a `generate` that runs until cancelled, a core without
  `cancel`, one that never stops.

`npm run test:e2e` runs the extension in a real VS Code (`@vscode/test-cli`; the first run
downloads VS Code into `.vscode-test/`). `test/e2e/fixture.mjs` makes fresh workspaces in
the temp directory on every run — one repository with a git base, a project over an
`upstream`, a folder without git, and a `quiet` workspace with nothing of hatch — and the
tests in `test/e2e/*.e2e.ts` drive the extension only through its commands and what VS
Code shows: lenses, Problems, the Outline, the status bar, the diffs, the message boxes
(answered by a stub). The extension hands the tests a few read-only hooks from `activate`
(`HatchTestApi`): cores started, the gate, the status text, a table. A feature that shows
something in the editor gets its end-to-end test with it.

There are no tests inside VS Code yet (`@vscode/test-electron`); behaviour that needs the
editor — lenses, tab closing, file watchers — is checked by hand in the development host.

## Before a change goes in

- `npm run check` (typecheck and tests) is green, against a freshly built core.
- `README.md` and `README.ru.md` change together, and so do `CONTRIBUTING.md` and
  `CONTRIBUTING.ru.md`.
- A user-visible change has its line in `CHANGELOG.md` under *Unreleased*, breaking
  changes first.
- A new setting follows E1; a new protocol method or field is used only after `max` covers
  it.
- A command id is spelled in `package.json` and in `src/commands/ids.ts`, nowhere else.

## Releases

- `CHANGELOG.md` names four numbers for every release: the extension's version, the
  protocol range it speaks, the config schema its settings mirror, the patch format its
  grammar colors.
- **The extension's version.** Before 1.0.0, any new feature and any breaking change raise
  the minor (0.1.0 → 0.2.0), a fix alone the patch (0.1.0 → 0.1.1). From 1.0.0, semver:
  breaking — major, feature — minor, fix — patch.
- **What is breaking for the extension:** raising `min` of the protocol range (an older
  hatch stops working); removing or renaming a `hatch.*` setting, a command id or a
  keybinding; reading a config schema or a patch format no longer. Each is said in the
  CHANGELOG under *Breaking*, with what to do.
- Raising `max` of the protocol range, a setting for a new config key (E1), a new command
  — a feature.
- The `.vsix` carries the core it was tested with; the core's version is named in the
  CHANGELOG entry, and `max` is raised only after `npm run check` and `npm run test:e2e`
  pass against it (R7).
- A release of the extension that speaks a new protocol ships before, or together with,
  the hatch that raises `protocolMin` (VERSIONING.md, S3); the *Clients* table there is
  updated with it.
