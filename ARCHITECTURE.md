# Architecture

How the extension is put together, for someone about to change it. What it does for a
user is in the [README](./README.md); the rules a change must keep are in
[CONTRIBUTING.md](./CONTRIBUTING.md). The protocol itself is the core's:
[PROTOCOL.md](https://github.com/Danil-Varakin/hatchTs/blob/main/PROTOCOL.md).

## The boundary

```
┌───────────── VS Code extension host ─────────────┐          ┌──────── hatch core ────────┐
│ commands · lenses · diagnostics · status bar      │  JSON    │ parser · matcher · patcher │
│            │                                      │  lines   │ generate · config · pair   │
│   Project ─┼─ IndexBuilder ─ IndexStore ─ views   │ ◄──────► │ tree-sitter (wasm)         │
│            │                                      │  stdio   │                            │
│        HatchService ── ServiceProcess ────────────┼──────────┤ node_modules/hatch/dist/   │
└───────────────────────────────────────────────────┘          │   service/index.js         │
                                                               └────────────────────────────┘
```

**The extension holds no Hatch logic.** The core runs as a child process on the editor's
own Node (`ELECTRON_RUN_AS_NODE=1`), and everything about patches — parsing, matching,
where a hunk lands, where a patch is written, which file it belongs to, which base is in
force — is its answer to a request. Reasons, each sufficient on its own: a second copy of
the core's rules would drift silently; the core is ESM on Node 22 while the host loads the
extension as CommonJS; `web-tree-sitter` finds its `.wasm` relative to its own file, which
bundling breaks; synthesis can run for minutes, and cancelling a child process is easy.

The boundary between the two repositories is therefore the **protocol**, not an API. Its
types are re-exported from `hatch/protocol`, so a mismatch is a compile error.

## The service

| Module | Job |
|---|---|
| `service/process.ts` | `ServiceProcess`: spawns the core, owns its pipes, cuts stdout into lines. A framer per process, so the tail of a killed one can never prefix the first reply of the next |
| `service/client.ts` | `HatchService`: requests by `id` (replies come as requests finish, not in order), progress, cancellation, timeouts, restart |
| `service/protocol.ts` | protocol types, the `Methods` table that types `request`, `SUPPORTED_PROTOCOL` |

- **Handshake.** Every request but `version` and `cancel` waits for `version` first, and
  goes out only if the two protocol ranges overlap. The extension speaks
  `min(core's protocol, its own max)`.
- **Cancellation.** The waiting caller is told at once; the core is sent `cancel { id }`
  and `generate` stops before its next change. A core that cannot cancel, or does not stop
  within 10 s, is killed and restarted on the next request; everything else in flight is
  failed with `ServiceGoneError` rather than left hanging.
- **Timeouts** are per method (`version` 15 s, `config`/`pair` 30 s, `resolve`/`apply`
  60 s, `generate` none). A timeout fails its own request and restarts the process.
- One process per window, started lazily. stderr goes to the *Hatch* output channel.

## The project

`project/project.ts` — `Project` asks the core two questions and keeps the answers:

- `config { path, overrides }` — the settings `generate` would apply to this file, the
  base in force (`text`, `git` with its commit, or `unavailable` with the reason), the
  repository root, and `watch`: the paths whose change may change the answer (config
  files up the tree, `HEAD`, the branch's ref, `packed-refs`).
- `pair { path, patch?, overrides? }` — a file of code and its patch, either way: the target
  the header's `Target` first, then `generate.out` and `upstream`, then the patch beside the file; or
  the reason there is none.

Answers are dropped when a watched path, any `hatch.config.json` in the workspace, a
`hatch.*` setting or workspace trust changes. `overrides` are the `hatch.*` settings a
person actually set (`settings.ts` reads them with `inspect`, never `get`), so a setting
nobody touched cannot override the project config. `project/base.ts` turns a `config`
answer into the base to send: the saved file as text, or the git coordinates.

## The table of links

One table per patch is the only state navigation and feedback have
(`navigation/patch-index.ts`):

```
PatchIndex = { mdUri, mdText, targetUri, targetText,
               base (saved | git sha), baselineUri, baselineText,
               hunks: HunkLink[]   ← resolve, as the core sent it
               warnings }          ← resolve's warningsAt, for the patch as it is now
```

The `md*` prefix is the protocol's: `HunkLink.mdSpan` and `ServiceError.detail.mdLine` are
named that way in `hatch/protocol`, from before patches were `.hatch`. The fields here
keep it so the two sides read alike; everything the prose calls a patch is a `.hatch`, and
what it is called in one place is `src/patch-files.ts`.

Every way building it can end is a state of its own — `ready`, `parse-error`,
`unlinked`, `no-target`, `no-baseline`, `failed` — and each has its own words
(`feedback/state.ts`).

```
editor events, disk watchers, Project.onDidChange
          │
PatchIndexCache ── tells the store which keys changed, closed or are shown
          │
IndexStore ─────── pure: dependencies, staleness, 300 ms debounce, LRU of 32;
          │        rebuilds only patches that have a tab, forgets the rest
IndexBuilder ───── pair → target → base → resolve (skipped when the .hatch and the base
          │        are unchanged: typing in the code never calls resolve)
          ▼
onDidChange ─► lenses · diagnostics · highlights · status bar
get()       ─► commands (always fresh; a failure is never replayed to a command)
```

A build overtaken by an invalidation is never kept; a change landing while a build runs
leaves the result stale and schedules another. Closing a patch means its last tab going
away — `onDidCloseTextDocument` arrives minutes late.

## Coordinates

Three systems, never mixed: lines of the `.hatch` (`mdSpan`, from 1), offsets in the base
(`base` — what a hunk replaces), offsets in the applied text (`final` — what it writes).
Offsets are UTF-16 code units, what `document.positionAt` takes, so they are used as they
come. The extension's arithmetic on them is limited to `positionAt`, "is the cursor inside
this span", trimming whitespace off the edges, and — only when the buffer has drifted from
the patch — finding a line again, which is always reported as approximate.

The base is shown as a read-only `hatch-baseline:` document (`baseline/documents.ts`)
holding exactly the text the `base` offsets were measured in: the saved file shares its
path with the edited file, and a git base is on no disk at all.

## One verdict per hunk

`feedback/verdict.ts` decides each hunk once — `placed`, `unapplied` (the code is still
its base), `drifted` (the code no longer holds what the hunk writes), `unresolved` — and
the lens, the squiggle, the highlight and `alt+O` all read that verdict, so they cannot
disagree about a hunk.

The verdict is shown twice, because one of the two cannot carry a colour. A `CodeLens` has
only `title` and `tooltip`, and the editor paints every lens in the theme's
`editorCodeLens.foreground`, which no extension can set per lens — so the lens opens with
an emoji, which brings its own colour (`GLYPH`, `feedback/verdict.ts`). The hunk's header
line also gets a mark in a real theme colour, `hatch.brokenHunkForeground` or
`hatch.driftedHunkForeground` (`feedback/highlight.ts`, drawn by `ui/highlight.ts`).

## Commands

| Command | Module |
|---|---|
| Generate Patch, Generate Patch Against File… | `commands/generate.ts` |
| Go to the Other Side, Go to What the Hunk Replaces | `commands/navigate.ts`, `navigation/locate.ts`, `navigation/show.ts` |
| what to say when there is no hunk to go to | `commands/refusals.ts` |
| Show Base | `commands/base.ts` |
| Init Config | `commands/config.ts` |

Command ids live in `package.json` and `commands/ids.ts` only.

## Rules that shape the code

- **Never jump somewhere plausible.** Each failure is a named case with its own message
  and a next action; the alternative was always a jump to a wrong place that looked right.
- **Write only patches.** The extension writes `.hatch` files (and `hatch.config.json` on
  Init Config). Changes to an open document go through `WorkspaceEdit`, so they show and
  can be undone. It never downloads anything.
- **Trust.** In an untrusted workspace the workspace's own `hatch.out`
  are ignored, writing outside it asks first, and no config is created.
- **Pure where possible.** Everything that can be tested without an editor lives in
  modules that import no `vscode` value: `navigation/hunks.ts`, `text.ts`, `failure.ts`,
  `dependencies.ts`, `index-store.ts`, `feedback/verdict.ts`, `feedback/highlight.ts`,
  `feedback/repairs.ts`, `feedback/destination.ts` (which modal a generate puts up before
  it writes), `feedback/patch-report.ts`, `project/base.ts`, `project/languages.ts`,
  `settings.ts`, `lru.ts`, `hash.ts`, `duration.ts`, `patch-files.ts`.

## Tests

`npm test` runs without an editor: pure modules alone; the client, `config`, `pair` and
the coordinates against the real core (never against hand-written hunks); cancellation
paths against a fake core (`test/fixtures/fake-service.mjs`).
