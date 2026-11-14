#!/usr/bin/env node
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

// The QA suites as one command. Six suites used to run one after another in a
// shell loop, each compiling its own server, generating its own packs beside the
// others' and launching its own Chromium; the run below pays one build, gives
// every suite a run root of its own (see qa-lib.cjs), and starts the suites
// concurrently.
//
// Run: node docu/qa/run-qa.cjs [suite ...] [--only name[,name]] [--parallel n]
//      [--keep-run] [--serial]
//
// The suites are ordered by the wall clock they were measured to need, longest
// first, which is also the order that puts the browser suites ahead of the
// process-level one: a pool that starts the long suites first does not spend the
// tail of the run waiting for one.

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
    repoRoot,
    runDir,
    keepRunDir,
    gitStatus,
    requirePlaywright,
    buildServer,
    goTool
} = require('./qa-lib.cjs');

// The runner owns the run directory: it is the one that decides whether a failed
// run keeps it for inspection, and a suite process exiting must not take it with
// it.
keepRunDir();

// kind separates what a browser and a server are needed for: the browser suites
// cover the shipped interface and the quest editor, the process suite covers what
// an operator sees from a shell.
const SUITES = [
    { name: 'spa-qa', file: 'spa-qa.cjs', kind: 'browser', covers: 'the adventure SPA' },
    { name: 'dialog-qa', file: 'dialog-qa.cjs', kind: 'browser', covers: 'the dialog machine' },
    { name: 'session-qa', file: 'session-qa.cjs', kind: 'browser', covers: 'a session token that expires' },
    { name: 'save-compat', file: 'save-compat.cjs', kind: 'browser', covers: 'saved states across the refactor' },
    { name: 'editor-qa', file: 'editor-qa.cjs', kind: 'browser', covers: 'the quest editor as a page' },
    { name: 'cli-qa', file: 'cli-qa.cjs', kind: 'process', covers: 'signals and the command-line tools' }
];

// The default pool: enough suites to keep the cores busy without asking each of
// them to share a core with two others. A four-core runner runs three at a time,
// which is the point at which the browser suites stop overlapping on latency and
// start overlapping on CPU. QA_PARALLEL and --parallel override it, and a machine
// with few cores is not made to oversubscribe: the floor only applies when there
// are at least that many suites to run.
function defaultParallel(count) {
    const cores = Math.max(1, os.availableParallelism ? os.availableParallelism() : os.cpus().length);
    const share = Math.max(2, Math.floor(cores * 0.75));
    return Math.max(1, Math.min(count, share));
}

// envParallel lets a runner configuration set the pool without editing the
// workflow that starts the run.
function envParallel(options) {
    if (!process.env.QA_PARALLEL) {
        return;
    }
    const value = Number(process.env.QA_PARALLEL);
    if (!Number.isInteger(value) || value < 1) {
        throw new Error(`QA_PARALLEL wants a positive whole number, got ${process.env.QA_PARALLEL}`);
    }
    options.parallel = value;
}

function parseArgs(argv) {
    const options = { names: [], only: null, parallel: null, keepRun: false };
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '--parallel') {
            options.parallel = Number(argv[++index]);
            if (!Number.isInteger(options.parallel) || options.parallel < 1) {
                throw new Error('--parallel wants a positive whole number');
            }
        } else if (arg === '--only') {
            options.only = String(argv[++index] || '').split(',').map((name) => name.trim()).filter(Boolean);
        } else if (arg === '--serial') {
            options.parallel = 1;
        } else if (arg === '--keep-run') {
            options.keepRun = true;
        } else if (arg === '--help' || arg === '-h') {
            options.help = true;
        } else if (arg.startsWith('-')) {
            throw new Error(`unknown option ${arg}`);
        } else {
            options.names.push(arg.replace(/\.cjs$/, ''));
        }
    }
    if (options.only) {
        options.names = [...options.names, ...options.only];
    }
    envParallel(options);

    const selected = options.names.length > 0
        ? SUITES.filter((suite) => options.names.includes(suite.name))
        : SUITES;
    const unknown = options.names.filter((name) => !SUITES.some((suite) => suite.name === name));
    if (unknown.length > 0) {
        throw new Error(`no such suite: ${unknown.join(', ')} (known: ${SUITES.map((s) => s.name).join(', ')})`);
    }
    // Keep the measured-longest-first order even for a subset chosen by hand.
    return { suites: selected, ...options };
}

function format(seconds) {
    return `${seconds.toFixed(1)}s`;
}

// checksLine is the report the suite ends with; the summary quotes it so a failing
// run says which suite stopped answering, not only that one did.
function checksLine(output) {
    const match = output.match(/^(.*): (\d+)\/(\d+) checks passed$/m);
    return match ? `${match[2]}/${match[3]} checks` : '';
}

// runSuite starts one suite as its own process and hands back what it printed as
// one block. The suites' output is deliberately not streamed live: concurrent
// suites would interleave line by line, and a QA report is read as a whole.
async function runSuite(suite, env, index, total) {
    const started = Date.now();
    console.log(`  running ${suite.name} (${index + 1}/${total})`);

    const child = spawn(process.execPath, [path.join(__dirname, suite.file)], {
        cwd: repoRoot,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: true
    });

    let output = '';
    // A failed spawn gives no streams at all; the failure is reported from the
    // exit outcome below, so the output capture simply stays empty.
    child.stdout?.on('data', (chunk) => { output += chunk.toString(); });
    child.stderr?.on('data', (chunk) => { output += chunk.toString(); });

    // The suites arm their own watchdogs; this is the net under a process that
    // hangs before arming one. SIGTERM is what the suite handles by stopping its
    // servers, so the ceiling asks for that path and only insists when it does
    // not arrive.
    const ceiling = Number(env.QA_CEILING_MS || 600000);
    let timedOut = false;
    const guard = setTimeout(() => {
        timedOut = true;
        signalGroup(child, 'SIGTERM');
        setTimeout(() => signalGroup(child, 'SIGKILL'), 15000).unref();
    }, ceiling);

    const outcome = await new Promise((resolve) => {
        child.once('error', (error) => resolve({ error: error.message }));
        child.once('exit', (code, signal) => resolve({ code, signal }));
    });
    clearTimeout(guard);

    const seconds = (Date.now() - started) / 1000;
    const failed = Boolean(outcome.error) || outcome.code !== 0 || timedOut;
    const line = checksLine(output);
    return {
        suite,
        seconds,
        failed,
        line,
        output,
        note: timedOut
            ? `no progress for ${format(ceiling / 1000)}`
            : (outcome.error || outcome.signal || `exit ${outcome.code}`)
    };
}

function signalGroup(child, signal) {
    try {
        process.kill(-child.pid, signal);
    } catch (error) {
        try {
            child.kill(signal);
        } catch (gone) {
            // The process already ended; nothing to signal.
        }
    }
}

// buildFirst compiles the artifacts every suite needs. Doing it here, once, is
// what keeps a parallel start from turning into concurrent compiles of the same
// packages: a suite run alone reaches the same artifacts through the same lock,
// so the shared build is not a privilege of the runner.
function buildFirst() {
    const started = Date.now();
    const artifacts = [
        ['rego-server', () => buildServer(repoRoot)],
        ['assetgen', () => goTool('assetgen')],
        ['solutionverifier', () => goTool('solutionverifier')]
    ];
    for (const [name, build] of artifacts) {
        build();
    }
    return { seconds: (Date.now() - started) / 1000, names: artifacts.map(([name]) => name) };
}

// probeChromium fails here, once, rather than letting every browser suite fail on
// the same missing browser binary.
async function probeChromium() {
    const started = Date.now();
    try {
        const { chromium } = requirePlaywright();
        const browser = await chromium.launch();
        await browser.close();
        return { seconds: (Date.now() - started) / 1000, ok: true, output: '' };
    } catch (error) {
        return { seconds: (Date.now() - started) / 1000, ok: false, output: error.message.split('\n')[0] };
    }
}

async function main() {
    // What the tree looked like before the run: the suites generate their packs
    // inside run roots now, so a run that changes the working tree broke the
    // isolation the pool depends on, whatever the suites themselves report.
    const baseline = gitStatus(repoRoot);

    let parsed;
    try {
        parsed = parseArgs(process.argv.slice(2));
    } catch (error) {
        console.error(error.message);
        process.exit(2);
    }

    if (parsed.help) {
        console.log(`usage: node docu/qa/run-qa.cjs [suite ...] [--only name[,name]] [--parallel n] [--serial] [--keep-run]

QA_PARALLEL does what --parallel does, for a configuration that starts the run
without passing arguments. QA_CEILING_MS is the ceiling for one suite process
(default 600000), the net under a suite that hangs before arming its watchdog.

suites, in the order the run starts them:
${SUITES.map((suite) => `  ${suite.name.padEnd(12)} ${suite.kind.padEnd(8)} ${suite.covers}`).join('\n')}

without arguments all suites run. The build of the server and of the Go QA tools
happens once for the run; each suite gets a run root, so no suite generates packs
beside another suite's.`);
        process.exit(0);
    }

    const parallel = parsed.parallel ?? defaultParallel(parsed.suites.length);
    const cores = Math.max(1, os.availableParallelism ? os.availableParallelism() : os.cpus().length);

    console.log(`run directory ${runDir}`);
    console.log(`suites ${parsed.suites.map((suite) => suite.name).join(', ')}`);
    console.log(`concurrency ${parallel} on ${cores} cores`);

    const build = buildFirst();
    console.log(`build ${build.seconds.toFixed(1)}s (${build.names.join(', ')})`);

    if (parsed.suites.some((suite) => suite.kind === 'browser')) {
        const probe = await probeChromium();
        if (!probe.ok) {
            console.error(`chromium is not usable; run "npx playwright install --with-deps chromium" in frontend/adventure\n${probe.output}`);
            fs.rmSync(runDir, { recursive: true, force: true });
            process.exit(2);
        }
        console.log(`chromium launch ${probe.seconds.toFixed(1)}s`);
    }

    // QA_CONTENTION is what the suites' watchdog budgets scale by: a run that
    // gives this machine more suites than it has cores must not then blame each
    // suite for the pressure the run chose.
    const env = {
        ...process.env,
        QA_RUN_DIR: runDir,
        QA_CONTENTION: String(parallel / cores)
    };

    const results = [];
    const queue = [...parsed.suites];
    let startedCount = 0;

    async function worker() {
        while (queue.length > 0) {
            const suite = queue.shift();
            const index = startedCount;
            startedCount += 1;
            const result = await runSuite(suite, env, index, parsed.suites.length);
            results.push(result);
            console.log(`\n=== ${suite.name} (${result.failed ? 'FAILED' : 'ok'}, ${format(result.seconds)}, ${result.note})`);
            console.log(result.output.trimEnd());
        }
    }

    const wall = Date.now();
    // The pool is a set of workers pulling from the shared queue: a suite starts
    // as soon as a slot frees, so a short suite fills the gap a long one leaves.
    const pool = [];
    for (let slot = 0; slot < Math.min(parallel, parsed.suites.length); slot += 1) {
        pool.push(worker());
    }
    await Promise.all(pool);

    // A failing suite keeps the run directory: its run roots are where its packs,
    // server logs and any leftover page state live, and a red CI run is read from
    // a developer's machine by pointing at that directory.
    const anyFailed = results.some((result) => result.failed);
    const left = gitStatus(repoRoot).filter((line) => !baseline.includes(line));
    if (!parsed.keepRun && !anyFailed && left.length === 0) {
        fs.rmSync(runDir, { recursive: true, force: true });
    }

    console.log('\nQA run summary');
    console.log(`  build        ${format(build.seconds)}  ${build.names.join(', ')}`);
    for (const suite of parsed.suites) {
        const result = results.find((entry) => entry.suite.name === suite.name);
        if (!result) {
            console.log(`  ${suite.name.padEnd(12)} did not run`);
            continue;
        }
        console.log(`  ${suite.name.padEnd(12)} ${format(result.seconds).padStart(7)}  ${(result.line || '').padEnd(14)} ${result.failed ? `FAILED (${result.note})` : 'ok'}`);
    }
    console.log(`  suites wall  ${format((Date.now() - wall) / 1000)}  concurrency ${parallel} on ${cores} cores`);
    console.log(`  working tree ${left.length === 0 ? 'unchanged by the run' : `changed by the run: ${left.join(' | ')}`}`);
    if (parsed.keepRun || anyFailed || left.length > 0) {
        console.log(`  run directory kept: ${runDir}`);
    }
    if (anyFailed) {
        console.log('\nat least one suite failed; the run directory is kept for inspection.');
    }
    if (left.length > 0) {
        console.log('\nthe run left something in the working tree, which the run roots were meant to prevent.');
    }

    process.exit(anyFailed || left.length > 0 ? 1 : 0);
}

main();
