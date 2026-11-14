/*
   Copyright 2025 Mario Enrico Ragucci

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

      http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.
*/

// Shared parts of the QA harness: finding a Chromium, building the server and
// the Go tools the suites shell out to, giving each suite a directory of its own
// to run in, and reporting what the pages did. The suites in this directory are
// separate processes; docu/qa/run-qa.cjs starts them concurrently, and one suite
// can still be run by hand.

const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..');

// ============================================================================
// PLAYWRIGHT
// ============================================================================

// Playwright is a declared devDependency in frontend/adventure/package.json
// and pinned by the committed lockfile with it. The harness still resolves
// whatever copy is installed on the machine: each place it may live is
// tried in turn.
const PLAYWRIGHT_VERSION = '1.65.1';

function playwrightCandidates() {
    const direct = [
        path.join(repoRoot, 'frontend', 'adventure', 'node_modules'),
        repoRoot,
        path.join(os.homedir(), 'node_modules'),
        '/opt/homebrew/lib/node_modules',
        path.join(os.homedir(), '.local', 'share', 'pnpm-global'),
        path.join(os.homedir(), '.local', 'lib', 'node_modules')
    ];

    const npxCache = path.join(os.homedir(), '.npm', '_npx');
    const fromCache = [];
    if (fs.existsSync(npxCache)) {
        for (const entry of fs.readdirSync(npxCache)) {
            fromCache.push(path.join(npxCache, entry, 'node_modules'));
        }
    }
    return { direct, fromCache };
}

function requirePlaywright() {
    const { direct, fromCache } = playwrightCandidates();
    for (const base of [...direct, ...fromCache]) {
        const manifest = path.join(base, 'playwright', 'package.json');
        if (fs.existsSync(manifest)) {
            return require(path.join(base, 'playwright'));
        }
    }
    for (const base of direct) {
        try {
            return require(require.resolve('playwright', { paths: [base] }));
        } catch (error) {
            // Try the next place.
        }
    }
    throw new Error(
        `Playwright was not found. Run "npm ci" in frontend/adventure, then "npx playwright install chromium" there; the harness reads the installed copy (pinned to ${PLAYWRIGHT_VERSION} by the manifest).`
    );
}

// ============================================================================
// BUILD, ARTIFACTS, RUN ROOTS
// ============================================================================

function run(command, args, options = {}) {
    const result = spawnSync(command, args, {
        cwd: options.cwd || repoRoot,
        encoding: 'utf8',
        maxBuffer: 32 * 1024 * 1024
    });
    if (result.status !== 0) {
        throw new Error(
            `${command} ${args.join(' ')} failed (exit ${result.status}):\n${result.stderr || result.stdout}`
        );
    }
    return result.stdout;
}

// sleep blocks this process for a moment. The harness is synchronous on purpose
// (a suite's phases run one after another), so the synchronous wait is how a
// suite waits for an artifact another suite's process is compiling.
function sleep(ms) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// The run directory is what one QA run owns: <run>/bin holds the compiled server
// and QA tools, <run>/roots holds one run root per suite. run-qa.cjs sets
// QA_RUN_DIR for the suites it starts; a suite run by hand makes its own scratch
// directory and removes it again when the process ends.
const runDir = process.env.QA_RUN_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'rego-qa-'));
const binDir = path.join(runDir, 'bin');

// A suite run by hand has nowhere else to put its artifacts, so its scratch run
// directory goes away with the process. run-qa.cjs owns the run directory it made
// and decides for itself whether to keep it, so it calls keepRunDir() first.
let removeRunDirOnExit = !process.env.QA_RUN_DIR;

process.on('exit', () => {
    if (removeRunDirOnExit) {
        fs.rmSync(runDir, { recursive: true, force: true });
    }
});

function keepRunDir() {
    removeRunDirOnExit = false;
}

// A lock left behind by a process that died on a signal is taken over once it is
// this old; a Go build of this tree does not run longer than this.
const LOCK_STALE_MS = 180000;

// withLock runs body while this process holds an exclusive marker directory.
// mkdir is the atomic operation the CommonJS toolchain gives us without a
// thread, and removing the marker is the release.
function withLock(marker, body) {
    const giveUpAfter = Date.now() + LOCK_STALE_MS;
    for (;;) {
        try {
            fs.mkdirSync(marker);
            break;
        } catch (error) {
            if (error.code !== 'EEXIST') {
                throw error;
            }
            let age = 0;
            try {
                age = Date.now() - fs.statSync(marker).mtimeMs;
            } catch (missing) {
                // Released between the mkdir and the stat: take it now.
                continue;
            }
            if (age > LOCK_STALE_MS) {
                fs.rmSync(marker, { recursive: true, force: true });
                continue;
            }
            if (Date.now() > giveUpAfter) {
                throw new Error(`${marker} is still held by another QA process after ${LOCK_STALE_MS}ms`);
            }
            sleep(50);
        }
    }
    try {
        return body();
    } finally {
        fs.rmSync(marker, { recursive: true, force: true });
    }
}

// artifact returns the path of a Go binary the suites shell out to, compiling it
// into the run directory the first time anything asks for it. The compile writes
// a uniquely named file and renames it into place: a rename is atomic, so a suite
// that starts while another is still compiling either sees no artifact or a
// complete one, never half a binary. The lock is what keeps the compile from
// happening once per concurrent suite.
function artifact(name, packagePath, cwd = repoRoot) {
    fs.mkdirSync(binDir, { recursive: true });
    const target = path.join(binDir, name);
    if (fs.existsSync(target)) {
        return target;
    }
    return withLock(`${target}.lock`, () => {
        if (!fs.existsSync(target)) {
            const staged = `${target}.staging-${process.pid}`;
            run('go', ['build', '-o', staged, packagePath], { cwd });
            fs.renameSync(staged, target);
        }
        return target;
    });
}

// buildServer compiles the server the suites run. A build of the working tree
// under the default name is shared for the whole run: every suite drives the same
// bytes, and one compile per run is the point of the run directory. A build of
// another tree or under another name - the base commit's server that save-compat
// re-records a save against - belongs to this process alone, so it cannot be
// mistaken for the artifact another suite is executing.
function buildServer(cwd, binaryName = 'rego-server') {
    if (cwd === repoRoot && binaryName === 'rego-server') {
        return artifact(binaryName, '.');
    }
    fs.mkdirSync(binDir, { recursive: true });
    const target = path.join(binDir, `${binaryName}-${process.pid}`);
    run('go', ['build', '-o', target, '.'], { cwd });
    return target;
}

// goTool is a compiled tool from cmd/: the suites used to `go run` assetgen and
// solutionverifier inside every suite, which repeats the same compile per suite.
function goTool(name) {
    return artifact(name, `./cmd/${name}`);
}

// The parts of the frontend a server only reads are shared with the working tree;
// frontend/quests is the part it is handed generated packs for, and stays a real
// directory of the suite's own.
const LINKED_FRONTEND = ['adventure', 'shared'];

// suiteRoot is the working directory a suite starts its servers in. The suites
// used to generate their packs into the working tree, which made them share state
// they were not aware of: one suite's pack list was another suite's assertion, and
// a pack regenerated for one was regenerated over the other. In a run root every
// suite sees its own packs, so the suites can run at the same time and the
// working tree stays as it was.
function suiteRoot(suite) {
    const root = path.join(runDir, 'roots', suite);
    const frontend = path.join(root, 'frontend');
    fs.mkdirSync(path.join(frontend, 'quests'), { recursive: true });
    for (const dir of LINKED_FRONTEND) {
        const link = path.join(frontend, dir);
        if (fs.existsSync(link)) {
            continue;
        }
        try {
            fs.symlinkSync(path.join(repoRoot, 'frontend', dir), link, 'dir');
        } catch (error) {
            // A filesystem that refuses links (Windows without the privilege) gets
            // the same content copied, without the toolchain the server never
            // serves. The server's own containment checks resolve a linked base
            // directory and still reject a linked final component, so a copied
            // tree behaves exactly like a linked one.
            fs.cpSync(path.join(repoRoot, 'frontend', dir), link, {
                recursive: true,
                filter: (source) => !source.endsWith('node_modules')
            });
        }
    }
    return root;
}

// scratch is this suite's own writable area inside the run directory.
function scratch(suite) {
    const dir = path.join(runDir, 'scratch', suite);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
}

function packDir(cwd, themeName) {
    return path.join(cwd, 'frontend', 'quests', themeName);
}

// generatePack writes a playable quest pack into the run root's quests directory
// and returns its directory. The pack is placeholder content from cmd/assetgen:
// three quests with solvable test cases, a silent music track and theme assets.
function generatePack(cwd, themeName) {
    run(goTool('assetgen'), ['-theme', themeName, '-output', path.join(cwd, 'frontend', 'quests')]);
    return packDir(cwd, themeName);
}

function removePack(cwd, themeName) {
    fs.rmSync(packDir(cwd, themeName), { recursive: true, force: true });
}

function request(port, pathName, options = {}) {
    return new Promise((resolve, reject) => {
        const req = http.request(
            { host: '127.0.0.1', port, path: pathName, method: options.method || 'GET', timeout: 5000 },
            (res) => {
                let body = '';
                res.setEncoding('utf8');
                res.on('data', (chunk) => { body += chunk; });
                res.on('end', () => resolve({ status: res.statusCode, body }));
            }
        );
        req.on('error', reject);
        req.on('timeout', () => req.destroy(new Error(`request to ${pathName} timed out`)));
        req.end();
    });
}

// pickFreePort asks the operating system for a port no one is holding, so a
// leftover process from an interrupted run cannot be mistaken for the app.
function pickFreePort() {
    return new Promise((resolve, reject) => {
        const probe = net.createServer();
        probe.once('error', reject);
        probe.listen(0, '127.0.0.1', () => {
            const port = probe.address().port;
            probe.close(() => resolve(port));
        });
    });
}

// startedServers keeps every started server reachable, so the end of a suite -
// or of an interrupted one - cannot leave a process holding a port.
const startedServers = new Set();

class Server {
    constructor({ cwd, port, binary, env = {} }) {
        this.cwd = cwd;
        this.port = port;
        this.binary = binary;
        this.extraEnv = env;
        this.child = null;
        this.log = '';
    }

    // DOMAIN is the allowed CORS origin the server insists on; the harness
    // serves the SPA and the API from the same origin, so it is this port.
    // A value the caller supplies may name the port it belongs to with {PORT}:
    // the substitution happens once the port is final, which is what keeps an
    // invented OIDC issuer consistent with the origin it is meant to match when
    // the port turns out to be taken.
    envFor(port) {
        const supplied = {};
        for (const [key, value] of Object.entries(this.extraEnv)) {
            supplied[key] = typeof value === 'string' ? value.replaceAll('{PORT}', String(port)) : value;
        }
        return {
            ...process.env,
            PORT: String(port),
            LOG_LEVEL: 'warn',
            DOMAIN: `http://127.0.0.1:${port}`,
            AUTH_ENABLED: 'false',
            ...supplied
        };
    }

    // start brings the server up on this.port and hands it any packs the phase
    // needs. Two suites picking a free port in the same moment can pick the same
    // one, because the probe that finds the port closes it again before this
    // process binds it: with no developer-chosen port to honour, a taken port is
    // answered by asking for another, and a port that is taken between the probe
    // and the bind - the server dies on EADDRINUSE - is answered the same way.
    async start({ packs = [] } = {}) {
        const attempts = process.env.QA_PORT ? 1 : 3;
        for (let attempt = 1; attempt <= attempts; attempt += 1) {
            const occupied = await request(this.port, '/health').catch(() => null);
            if (occupied) {
                if (attempt === attempts) {
                    throw new Error(
                        `port ${this.port} already answers; it is not the app under test. ` +
                        'Free it or set QA_PORT to another port.'
                    );
                }
                this.port = await pickFreePort();
                continue;
            }
            try {
                return await this.startOnPort(packs);
            } catch (error) {
                // The bind race: the probe saw the port free and the server died
                // on the bind. Another port, while this call has attempts left.
                if (attempt === attempts || !/server exited early/.test(error.message)) {
                    throw error;
                }
                this.port = await pickFreePort();
            }
        }
    }

    async startOnPort(packs) {
        for (const pack of packs) {
            generatePack(this.cwd, pack);
        }
        // A process group, so an interrupted run cannot leave a server behind.
        this.child = spawn(this.binary, {
            cwd: this.cwd,
            env: this.envFor(this.port),
            stdio: ['ignore', 'pipe', 'pipe'],
            detached: true
        });
        startedServers.add(this);
        this.child.stdout.on('data', (chunk) => { this.log += chunk.toString(); });
        this.child.stderr.on('data', (chunk) => { this.log += chunk.toString(); });
        this.child.stdout.resume();

        const deadline = Date.now() + 8000;
        for (;;) {
            if (this.child.exitCode !== null) {
                // A dead server is not a drain target: stop keeping it reachable.
                startedServers.delete(this);
                throw new Error(`server exited early (code ${this.child.exitCode}):\n${this.log}`);
            }
            try {
                const response = await request(this.port, '/health');
                if (response.status === 200) {
                    return this;
                }
            } catch (error) {
                // Not listening yet.
            }
            if (Date.now() > deadline) {
                throw new Error(`server did not become healthy on ${this.port}:\n${this.log}`);
            }
            await new Promise((resolve) => setTimeout(resolve, 100));
        }
    }

    // packDir is where a generated pack of this theme lives for this server,
    // which is a phase that edits a generated pack's own file.
    packDir(themeName) {
        return packDir(this.cwd, themeName);
    }

    // url is where this server's pages live. It reads the port the server ended
    // up on, which is the same port the suite navigates to.
    url(route = '') {
        return `http://127.0.0.1:${this.port}/${route}`;
    }

    async packs() {
        const response = await request(this.port, '/api/packs');
        return { status: response.status, body: response.body, packs: JSON.parse(response.body) };
    }

    // stop returns the server's exit outcome: the signal used, plus what it
    // logged on the way out, so a run can report which shutdown path was taken.
    async stop(signal = 'SIGTERM') {
        startedServers.delete(this);
        if (!this.child || this.child.exitCode !== null) {
            return { code: this.child ? this.child.exitCode : null, log: this.log };
        }
        const exited = new Promise((resolve) => this.child.once('exit', (code, sig) => resolve({ code, sig })));
        this.signalGroup(signal);
        const outcome = await Promise.race([
            exited,
            new Promise((resolve) => setTimeout(() => resolve({ code: null, sig: 'timeout' }), 1500))
        ]);
        if (outcome.sig === 'timeout') {
            this.signalGroup('SIGKILL');
            await exited;
        }
        return { code: outcome.code, log: this.log };
    }

    signalGroup(signal) {
        try {
            process.kill(-this.child.pid, signal);
        } catch (error) {
            this.child.kill(signal);
        }
    }
}

// ============================================================================
// REPORT
// ============================================================================

class Report {
    constructor(suite) {
        this.suite = suite;
        this.results = [];
    }

    check(name, ok, detail) {
        this.results.push({ name, ok: Boolean(ok), detail });
        const mark = ok ? 'ok  ' : 'FAIL';
        console.log(`  ${mark} ${name}${detail && !ok ? ` - ${detail}` : ''}`);
        return Boolean(ok);
    }

    // expect throws when a precondition for the following checks is missing, so
    // a broken page shows one failure instead of twenty.
    expect(name, ok, detail) {
        if (!this.check(name, ok, detail)) {
            const error = new Error(`precondition failed: ${name}${detail ? ` (${detail})` : ''}`);
            error.reported = true;
            throw error;
        }
    }

    done() {
        const failed = this.results.filter((result) => !result.ok);
        console.log(`\n${this.suite}: ${this.results.length - failed.length}/${this.results.length} checks passed`);
        for (const failure of failed) {
            console.log(`  failed: ${failure.name}${failure.detail ? ` - ${failure.detail}` : ''}`);
        }
        return failed.length === 0;
    }
}

// gitStatus lists the working tree changes, and leftoverChanges subtracts what
// was already there when the suite started. A suite reports what it added, since
// whatever else the tree holds is the developer's business. The optional locks
// are switched off because a suite running in parallel with another one must not
// take the index lock a concurrent `git worktree add` is holding.
function gitStatus(root) {
    return spawnSync('git', ['--no-optional-locks', 'status', '--porcelain'], { cwd: root, encoding: 'utf8' })
        .stdout.split('\n').map((line) => line.trim()).filter((line) => line !== '');
}

function leftoverChanges(root, baseline) {
    return gitStatus(root).filter((line) => !baseline.includes(line));
}

function stopServersSync() {
    for (const server of startedServers) {
        server.signalGroup('SIGKILL');
    }
    startedServers.clear();
}

// armWatchdog ends a suite that stopped making progress and names the phase that
// was running. baseMs is what one suite needs on an idle machine; run-qa.cjs
// publishes how many suites share this machine through QA_CONTENTION, and a run
// that was given more suites than there are cores gives each of them that much
// longer, so the watchdog stays the hang detector it is instead of turning into a
// load-sensitive failure.
function armWatchdog({ suite, baseMs, phase, onFire = () => {} }) {
    const contention = Math.max(1, Math.ceil(Number(process.env.QA_CONTENTION || 1)));
    const budgetMs = baseMs * contention;
    const timer = setTimeout(() => {
        const note = contention > 1 ? ` (${contention} suites share this machine)` : '';
        console.error(`\n${suite} exceeded ${Math.round(budgetMs / 1000)}s during "${phase()}"${note}`);
        onFire();
        stopServersSync();
        process.exit(2);
    }, budgetMs);
    return { budgetMs, contention, cancel: () => clearTimeout(timer) };
}

// ============================================================================
// BROWSER HELPERS
// ============================================================================

// armPageTimeouts gives a page its two budgets. Arriving at the page is not the
// same cost as interacting with it: the app's modules come from a CDN, so a
// navigation carries the network and the browser warm-up, and a run that starts
// several suites at once shares both. Interactions keep the short budget: an
// element that is not going to appear should fail the check that waits on it
// quickly. QA_CONTENTION is the watchdog's factor, so a run that put more suites
// on this machine than it has cores gives both budgets that much more room.
function armPageTimeouts(page) {
    const contention = Math.max(1, Math.ceil(Number(process.env.QA_CONTENTION || 1)));
    page.setDefaultNavigationTimeout(5000 * contention);
    page.setDefaultTimeout(1500 * contention);
}

// withBrowser launches one Chromium for the whole suite; each phase gets its own
// context, which is what carries cookies and localStorage.
async function withBrowser(run) {
    const { chromium } = requirePlaywright();
    const browser = await chromium.launch();
    try {
        return await run(browser);
    } finally {
        await browser.close();
    }
}

function newPage(browser, port) {
    return (async () => {
        const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
        const page = await context.newPage();
        armPageTimeouts(page);
        const consoleErrors = [];
        page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.message}`));
        page.on('console', (message) => {
            if (message.type() === 'error') {
                consoleErrors.push(`console: ${message.text()}`);
            }
        });
        return { context, page, consoleErrors, url: (route = '') => `http://127.0.0.1:${port}/${route}` };
    })();
}

// settle waits for the page to go quiet: two animation frames, then a macrotask.
// A fixed pause in a suite is a bet about how long the app needs; this waits for
// the app to have done what it was going to do, and it bounds that.
async function settle(page, { frames = 2, graceMs = 25 } = {}) {
    await page.evaluate(async ({ frames: wanted, grace }) => {
        for (let frame = 0; frame < wanted; frame += 1) {
            await new Promise((resolve) => requestAnimationFrame(resolve));
        }
        await new Promise((resolve) => setTimeout(resolve, grace));
    }, { frames, grace: graceMs });
}

// dialogClosed waits for a dialog to stop being open and answers whether it did.
// Waiting for `#id:not([open])` is the wrong wait: its default state is visible,
// a closed <dialog> element is display: none, and a wait that can never be
// satisfied costs its whole timeout every time it runs. The open property is what
// the app changes, so the open property is what the wait watches.
async function dialogClosed(page, id, timeout = 1500) {
    try {
        await page.waitForFunction((dialogId) => {
            const dialog = document.getElementById(dialogId);
            return !dialog || dialog.open === false;
        }, id, { timeout });
    } catch (error) {
        return false;
    }
    // close() only queues the close event the app cleans up behind, so the
    // property flipping is not yet the end of what closing the dialog does: a
    // check that reads an effect of that event needs the page to have gone quiet.
    await settle(page);
    return true;
}

// toastText returns the text of any visible toast, or null.
async function toastText(page) {
    const toasts = await page.locator('.toast, [role="status"].toast, .toast-message').allTextContents();
    const joined = toasts.map((text) => text.trim()).filter(Boolean).join(' | ');
    return joined || null;
}

module.exports = {
    repoRoot,
    runDir,
    keepRunDir,
    scratch,
    suiteRoot,
    stopServersSync, gitStatus, leftoverChanges,
    pickFreePort,
    requirePlaywright,
    run,
    buildServer,
    goTool,
    generatePack,
    packDir,
    removePack,
    request,
    Server,
    Report,
    armWatchdog,
    withBrowser,
    newPage,
    armPageTimeouts,
    dialogClosed,
    settle,
    toastText
};
