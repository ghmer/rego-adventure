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

// Shared parts of the browser QA harness: finding a Chromium, running the
// server, giving it a quest pack, and reporting what the pages did. The suites
// in this directory are run by hand, one suite per process.

const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..');
const running = new Set();
const scratchRoot = path.join(os.tmpdir(), 'rego-qa');

// ============================================================================
// PLAYWRIGHT
// ============================================================================

// The repo declares no Playwright dependency: the harness runs against whatever
// is installed on the machine. Each place it may live is tried in turn.
const PLAYWRIGHT_VERSION = '1.65.0';

function playwrightCandidates() {
    const direct = [
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
        `Playwright was not found. Install it with "npx playwright@${PLAYWRIGHT_VERSION} install chromium" ` +
        'or point npm at an existing copy; the harness reads no dependency from package.json.'
    );
}

// ============================================================================
// BUILD, SERVER, PACKS
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

function ensureScratch() {
    fs.mkdirSync(scratchRoot, { recursive: true });
    return scratchRoot;
}

function buildServer(cwd, binaryName = 'rego-server') {
    const scratch = ensureScratch();
    const target = path.join(scratch, binaryName);
    run('go', ['build', '-o', target, '.'], { cwd });
    return target;
}

// generatePack writes a playable quest pack into cwd/frontend/quests and returns
// its directory name. The pack is placeholder content from cmd/assetgen: three
// quests with solvable test cases, a silent music track and theme assets.
function generatePack(cwd, themeName) {
    run('go', ['run', './cmd/assetgen', '-theme', themeName, '-output', 'frontend/quests'], { cwd });
    return path.join(cwd, 'frontend', 'quests', themeName);
}

function removePack(cwd, themeName) {
    fs.rmSync(path.join(cwd, 'frontend', 'quests', themeName), { recursive: true, force: true });
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

class Server {
    constructor({ cwd, port, binary, env = {} }) {
        this.cwd = cwd;
        this.port = port;
        this.binary = binary;
        // DOMAIN is the allowed CORS origin the server insists on; the harness
        // serves the SPA and the API from the same origin, so it is this port.
        this.env = {
            ...process.env,
            PORT: String(port),
            LOG_LEVEL: 'warn',
            DOMAIN: `http://127.0.0.1:${port}`,
            AUTH_ENABLED: 'false',
            ...env
        };
        this.child = null;
        this.log = '';
    }

    async start({ packs = [] } = {}) {
        const occupied = await request(this.port, '/health').catch(() => null);
        if (occupied) {
            throw new Error(
                `port ${this.port} already answers; it is not the app under test. ` +
                'Free it or set QA_PORT to another port.'
            );
        }
        for (const pack of packs) {
            generatePack(this.cwd, pack);
        }
        // A process group, so an interrupted run cannot leave a server behind.
        this.child = spawn(this.binary, {
            cwd: this.cwd,
            env: this.env,
            stdio: ['ignore', 'pipe', 'pipe'],
            detached: true
        });
        running.add(this);
        this.child.stdout.on('data', (chunk) => { this.log += chunk.toString(); });
        this.child.stderr.on('data', (chunk) => { this.log += chunk.toString(); });
        this.child.stdout.resume();

        const deadline = Date.now() + 8000;
        for (;;) {
            if (this.child.exitCode !== null) {
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

    async packs() {
        const response = await request(this.port, '/api/packs');
        return { status: response.status, body: response.body, packs: JSON.parse(response.body) };
    }

    // stop returns the server's exit outcome: the signal used, plus what it
    // logged on the way out, so a run can report which shutdown path was taken.
    async stop(signal = 'SIGTERM') {
        running.delete(this);
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

// ============================================================================
// BROWSER HELPERS
// ============================================================================

// runningServers keeps every started server reachable, so the end of a suite -
// or of an interrupted one - cannot leave a process holding a port.
const runningServers = new Set();

// gitStatus lists the working tree changes, and leftoverChanges subtracts what
// was already there when the suite started. A suite reports what it added, since
// whatever else the tree holds is the developer's business.
function gitStatus(repoRoot) {
    const { spawnSync } = require('node:child_process');
    return spawnSync('git', ['status', '--porcelain'], { cwd: repoRoot, encoding: 'utf8' })
        .stdout.split('\n').map((line) => line.trim()).filter((line) => line !== '');
}

function leftoverChanges(repoRoot, baseline) {
    return gitStatus(repoRoot).filter((line) => !baseline.includes(line));
}

function stopServersSync() {
    for (const server of runningServers) {
        server.signalGroup('SIGKILL');
    }
    runningServers.clear();
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
        // A page that is not progressing should fail the check that waits on it
        // rather than hold the whole run.
        page.setDefaultTimeout(1500);
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

// toastText returns the text of any visible toast, or null.
async function toastText(page) {
    const toasts = await page.locator('.toast, [role="status"].toast, .toast-message').allTextContents();
    const joined = toasts.map((text) => text.trim()).filter(Boolean).join(' | ');
    return joined || null;
}

module.exports = {
    repoRoot,
    stopServersSync, gitStatus, leftoverChanges,
    pickFreePort,
    scratchRoot,
    requirePlaywright,
    run,
    ensureScratch,
    buildServer,
    generatePack,
    removePack,
    request,
    Server,
    Report,
    withBrowser,
    newPage,
    toastText
};
