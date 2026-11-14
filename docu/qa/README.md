# The QA suites

Six suites run the re-run matrix that the unit tests cannot reach:

| Suite | What it drives | Needs a server | Needs a browser |
| ----- | -------------- | -------------- | --------------- |
| `spa-qa.cjs` | The adventure SPA: start screen, pack entry, playing, epilogue, the guided tour, reduced motion | yes | yes |
| `dialog-qa.cjs` | The dialog machine: every dialog's open/close paths, effects and their timers | yes | yes |
| `session-qa.cjs` | A signed session token: renewal refused on the start screen and inside a quest | yes | yes |
| `save-compat.cjs` | Saved states recorded by the pre-refactor app, resumed by the current one | yes | yes |
| `editor-qa.cjs` | The quest editor as a page: identity, deletion, export rules | no | yes |
| `cli-qa.cjs` | Processes and their output: signals, `solutionverifier`, `assetgen` rollback | yes | no |

Run one suite by hand with `node docu/qa/<suite>.cjs`, or all of them with
`node docu/qa/run-qa.cjs`. The runner builds the server and the two Go QA tools
once, gives every suite its own run root, and runs the suites concurrently.

```
node docu/qa/run-qa.cjs                       # all six, concurrency sized to the machine
node docu/qa/run-qa.cjs --only spa-qa,dialog-qa
node docu/qa/run-qa.cjs --parallel 1          # the old serial order
node docu/qa/run-qa.cjs --keep-run            # keep the run root for inspection
```

`save-compat --capture` is hand-run only: it checks the refactor's base commit out
into a worktree, plays the pack on that app, and rewrites
`docu/qa/testdata/base-save.json` on purpose. The runner passes no arguments
through to a suite, so a runner-driven `save-compat` reads the recorded fixture.

## What the suites spend their wall clock on

Measured on a 14-core development machine (a four-core CI runner multiplies every
CPU-bound step and every browser interaction); the numbers are whole-suite wall
clocks, and the profiled columns come from timing each `waitFor*` call in the run:

| Suite | wall | of which bounded waits | the waits that always burn their full timeout |
| ----- | ---- | ---------------------- | --------------------------------------------- |
| `dialog-qa` | 20.4 s | 15.3 s | 11 × 1500 ms |
| `spa-qa` | 13.0 s | 8.5 s | 1 × 2000 ms (a predicate the app can no longer satisfy) |
| `session-qa` | 5.9 s | 3.2 s | 2.4 s waiting out a token expiry (deliberate: the suite *is* the expiry) |
| `editor-qa` | 4.3 s | 1.2 s | 1 × 1200 ms (waiting for a download that must not arrive) |
| `cli-qa` | 3.0 s | – | – |
| `save-compat` | 2.5 s | 0.4 s | – |

Three separate reasons add up to the 1-2 minutes per suite a CI runner reports.

### 1. Nothing ran in parallel

`frontend-ci.yml` ran the suites in a shell loop:

```sh
for suite in cli-qa dialog-qa editor-qa save-compat session-qa spa-qa; do
  node "docu/qa/$suite.cjs"
done
```

One process at a time, each starting its own Chromium, its own server and its own
quest packs. Six suites, six full start-ups, no overlap.

### 2. Shared state made parallelism unsafe as written

The suites were written to be run one after another, and they communicate through
the filesystem:

- Every suite builds the server to the same path, `$TMPDIR/rego-qa/rego-server`
  (`buildServer` takes a `binaryName` that every browser suite leaves at its
  default). Two `go build -o` writing one path is a corrupt binary, not a race.
- `spa-qa` deletes `$TMPDIR/rego-qa` in its `finally` block — which is where a
  concurrently running suite keeps the binary it is executing.
- Packs are generated into the *working tree*, `frontend/quests/<theme>`, and
  `spa-qa` asserts at the start of its first phase that this directory is empty.
  A second suite generating a pack there breaks that check, and two suites
  generating the same theme write over each other.
- Each suite compiled its own copy of the server and of `cmd/assetgen` with `go
  build`/`go run`. In a serial loop the first compile is cold and the rest are
  warm; started together, all six compile the same packages at once, which is
  exactly the duplicate work a shared build avoids.

So parallelism first needs isolation (Sprints 1 and 2 below), and only then a
pool (Sprint 3).

### 3. Waits that cannot succeed still cost their full timeout

`waitForSelector('#hint-modal:not([open])', { timeout: 1500 })` is meant to wait
for a dialog to close. Its default state is `visible`, and a closed `<dialog>` is
`display: none`, so the selector can never be satisfied: the call *always* returns
after 1500 ms, and the `.catch(() => {})` next to it hides the fact that nothing
was ever observed. `dialog-qa` carries eleven of these; they are 15 s of its 20 s.
The same shape appears as a stale predicate (`spa-qa` waits for `Quest 1/` after a
restart that leaves the app on the prologue), and as a fixed pause where the app
has already said what it was going to say (`waitForTimeout(300)` after a tour
whose driver failed to start, `waitForTimeout(400)` before reading a toast).

## Sprints

The work splits along those three causes.

**Sprint 1 — one build per run.** `qa-lib` resolves the run directory
(`QA_RUN_DIR`, created per `run-qa.cjs` invocation, per-process temporary
directory when a suite runs alone), builds `rego-server`, `assetgen` and
`solutionverifier` into `<run>/bin` once, and publishes each artifact by an atomic
rename under a lock file, so concurrent suites that start alone share the compile
instead of repeating it. `save-compat --capture` still builds the base commit's
server under its own name: it must be that commit's binary.

**Sprint 2 — one run root per suite.** `suiteRoot(suite)` gives a suite
`<run>/roots/<suite>/frontend/{adventure,shared}` as links to the working tree
and `frontend/quests` as a real directory it owns. The server starts with that as
its cwd, so generated packs land inside the run directory: no working-tree
writes, no pack races, and the "the quests directory starts empty" check stays
meaningful inside a suite (its own earlier phases are the only thing that can
fill it). Symlinks rather than copies because `frontend/adventure` holds
`node_modules`; the server's `resolveContained` resolves a symlinked base
directory and still rejects a symlinked final component, which is what the run
root relies on. `Server.start` retries on another port when a concurrently
picked port turns out to be taken.

**Sprint 3 — the runner.** `run-qa.cjs` builds once, spawns the suites through a
bounded pool, buffers each suite's output and prints it as one block so the logs
of concurrent suites do not interleave, and ends with a per-suite timing table.
Concurrency defaults to `min(suites, max(2, floor(cpus * 0.75)))`: six suites on
a development machine, three on a four-core runner, where three Chromium
instances fit without oversubscribing the cores. `--parallel` and `QA_PARALLEL`
override it. Each suite keeps its own watchdog so a hang names the phase that was
running; the budget is multiplied by `ceil(concurrency / cpus)`, so a suite is
never blamed for the CPU pressure the runner chose. The runner also compares the
working tree before and after the run and fails it if the run changed anything,
which is the assertion that the isolation holds rather than a suite's own
bookkeeping. `frontend-ci.yml` runs the runner instead of the loop.

**Sprint 4 — wait for the signal, not the timeout.** `qa-lib` gains
`dialogClosed(page, id)`, which waits on the dialog's own `open` property (and then
lets the page go quiet, because `close()` only queues the close event the app
cleans up behind), and `settle(page)`, which waits for the page to go quiet (two
animation frames and a macrotask). `dialog-qa` closes its dialogs through the
first, `spa-qa` replaces a stale predicate and a 300 ms pause with the app's own
signal (the tour prompt leaving the document) plus a settle, `editor-qa` records
the page's downloads from the moment the page exists so a refused export is judged
by what never arrived instead of by a 1200 ms wait, and `save-compat` waits for the
announcement it is about to read instead of pausing 400 ms first.

The deliberate fixed wait in `session-qa` — a token that must expire while the
quest screen is open — stays a fixed wait: the expiry it models is the thing under
test.

## Cost of a run

The shared build, the run roots and the pool mean a full run pays one cold
compile, then six suites whose start-up is a link farm, one `assetgen` call per
pack and one Chromium. Measured on the same 14-core machine, the whole set of six
suites went from 47 s in a serial loop to 12 s of wall clock, with the longest
suite (`spa-qa`, 4.5 s of which is the app's own 1500 ms autosave debounce three
times) setting the floor. A four-core runner pays one cold compile instead of six
warm-plus-cold ones and overlaps the six suites three at a time.

The suites' own `leftoverChanges` report still names anything a run added to the
working tree, and `run-qa.cjs` fails a run that added anything: with the packs
inside run roots, a tree change means the isolation leaked.
