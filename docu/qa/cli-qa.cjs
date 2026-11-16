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

// Command-line QA: the behaviour an operator sees, driven from a shell rather
// than a browser.
//
// It answers the parts of the re-run matrix that belong to the processes: what
// /api/packs says with an empty quests directory, what a signalled run logs,
// what solutionverifier prints when a quest cannot be evaluated, what an
// interrupted assetgen run leaves on disk, and how questmigrate and the server
// between them handle a pre-v2 pack.
//
// The listener-ended line is not reachable from outside a process, so it stays
// covered by TestRunWithGracefulShutdown_ListenerClosedWithoutAShutdownRequest.
//
// Run: node docu/qa/cli-qa.cjs

const fs = require('node:fs');
const path = require('node:path');

const { spawnSync } = require('node:child_process');

const {
    repoRoot,
    gitStatus,
    leftoverChanges,
    buildServer,
    goTool,
    pickFreePort,
    scratch,
    suiteRoot,
    armWatchdog,
    stopServersSync,
    Server,
    Report
} = require('./qa-lib.cjs');

// sh runs a command and hands back what it printed, whether it succeeded or
// not: several of these checks are about a command that is expected to fail.
function sh(command, args, options = {}) {
    const result = spawnSync(command, args, {
        cwd: options.cwd || repoRoot,
        encoding: 'utf8',
        maxBuffer: 32 * 1024 * 1024
    });
    return {
        status: result.status,
        output: `${result.stdout || ''}${result.stderr || ''}`
    };
}

// The suite's own writable area, inside the run directory: an assetgen run that
// is expected to fail still gets a tree of its own to fail in, so it cannot collide
// with a suite running at the same time.
const work = scratch('cli-qa');
// The run root the servers start in: their quests directory is empty and theirs,
// which is what the first phase is about.
const ROOT = suiteRoot('cli-qa');

function writeJSON(file, value) {
    fs.writeFileSync(file, JSON.stringify(value, null, 2));
    return file;
}

// A pack whose third quest cannot be evaluated: its solution is not valid Rego,
// so verifying that quest errors while its test cases still count. The pack is
// the same generated one the other suites use, with one solution broken, so it
// is a pack the server would accept.
function brokenPack() {
    const pack = JSON.parse(fs.readFileSync(path.join(repoRoot, 'docu', 'qa', 'testdata', 'qa-editor-pack.json'), 'utf8'));
    pack.id = 'cliqabroken';
    // An unterminated rule body: rego_parse_error, not a failing test.
    pack.quests[2].solution = 'package play\n\ndefault allow = false\n\nallow if {\n';
    return pack;
}


async function serverSignals(report, binary) {
    const port = await pickFreePort();
    const server = new Server({ cwd: ROOT, port, binary, env: { LOG_LEVEL: 'info' } });
    await server.start();

    const packs = await server.packs();
    report.check('an empty quests directory answers an empty JSON array', packs.body === '[]', `${packs.status} ${packs.body}`);

    const drained = await server.stop('SIGTERM');
    report.check(
        'a SIGTERM run logs the drain it performed',
        /"level":"INFO"[^\n]*server stopped gracefully/.test(drained.log),
        drained.log.trim().split('\n').slice(-2).join(' ;; ')
    );
    report.check('a SIGTERM run exits cleanly', drained.code === 0, String(drained.code));

    const interrupted = new Server({ cwd: ROOT, port: await pickFreePort(), binary, env: { LOG_LEVEL: 'info' } });
    await interrupted.start();
    const signalled = await interrupted.stop('SIGINT');
    report.check(
        'a SIGINT run drains the same way',
        /server stopped gracefully/.test(signalled.log) && signalled.code === 0,
        `${signalled.code} ;; ${signalled.log.trim().split('\n').slice(-1)[0]}`
    );
}

function solutionVerifier(report) {
    const packFile = writeJSON(path.join(work, 'broken-quests.json'), brokenPack());
    // The compiled tool, not `go run`: the run directory holds one build of it for
    // every suite that shells out to it.
    const output = sh(goTool('solutionverifier'), ['-questsfile', packFile]).output;

    report.check(
        'a quest that cannot be evaluated says so',
        /ERROR|Quest error/i.test(output),
        output.split('\n').filter((line) => /error/i.test(line)).slice(0, 3).join(' ;; ')
    );
    const perQuest = output.split('\n').filter((line) => /tests passed/.test(line));
    const overall = output.match(/Overall: (\d+)\/(\d+)/);
    report.check(
        'the test cases of the quest that could not be evaluated still count in the total',
        overall !== null && Number(overall[1]) === 4 && Number(overall[2]) === 6,
        `${perQuest.join(' ;; ')} ;; ${overall ? overall[0] : 'no overall line'}`
    );
    report.check(
        'a run with an unevaluable quest cannot report total success',
        !/All tests PASSED!/.test(output) && /Some tests FAILED!/.test(output),
        output.trim().split('\n').slice(-3).join(' ;; ')
    );
}

function assetgenRollback(report) {
    const output = path.join(work, 'assetgen');
    const packDir = path.join(output, 'qacli');
    fs.mkdirSync(packDir, { recursive: true });
    // An authored file that must survive, and a directory where a generated file
    // wants to go, which is what makes a later step fail.
    fs.writeFileSync(path.join(packDir, 'quests.json'), '{"authored":true}');
    fs.mkdirSync(path.join(packDir, 'theme.css'));

    const result = sh(goTool('assetgen'), ['-theme', 'qacli', '-output', output]);
    const listing = fs.existsSync(packDir) ? fs.readdirSync(packDir).sort() : [];

    report.check('an unwritable step fails the assetgen run', result.status !== 0, `status ${result.status}`);
    report.check(
        'the failed run leaves the pack directory holding only what it held before',
        JSON.stringify(listing) === JSON.stringify(['quests.json', 'theme.css']),
        listing.join(', ')
    );
    report.check(
        'the authored file keeps its content',
        fs.readFileSync(path.join(packDir, 'quests.json'), 'utf8') === '{"authored":true}',
        fs.readFileSync(path.join(packDir, 'quests.json'), 'utf8').slice(0, 40)
    );

    // A clean run into the same tree still works afterwards.
    const clean = sh(goTool('assetgen'), ['-theme', 'qacli-clean', '-output', output]);
    report.check(
        'a complete run afterwards produces a pack',
        clean.status === 0 && fs.existsSync(path.join(output, 'qacli-clean', 'quests.json')),
        `status ${clean.status}`
    );
}

// The migration tool's whole contract, from the outside: the dry run says
// without doing, the run migrates in place with a backup, a rerun skips,
// and the point of it all - a pre-v2 pack the server refuses by name in
// its log becomes a pack the same server serves after the tool ran.
function migrationTool(report, binary) {
    const fixture = path.join(repoRoot, 'docu', 'qa', 'testdata', 'qa-editor-pack-v1.json');

    const root = path.join(work, 'migrate');
    const packDir = path.join(root, 'qa-v1');
    fs.mkdirSync(packDir, { recursive: true });
    const packFile = path.join(packDir, 'quests.json');
    fs.copyFileSync(fixture, packFile);

    const dry = sh(goTool('questmigrate'), ['-dir', root, '-dry-run']);
    report.check(
        'a dry run names the pack it would migrate and writes nothing',
        dry.status === 0 && /qa-v1: would migrate/.test(dry.output) &&
        !fs.existsSync(path.join(packDir, 'quests.json.v1.bak')) &&
        fs.readFileSync(packFile, 'utf8') === fs.readFileSync(fixture, 'utf8'),
        dry.output.trim().split('\n').slice(0, 2).join(' ;; ')
    );

    const migrated = sh(goTool('questmigrate'), ['-dir', root]);
    const pack = JSON.parse(fs.readFileSync(packFile, 'utf8'));
    report.check(
        'the run migrates in place: version 2, a default speaker, the original kept as a backup',
        migrated.status === 0 && pack.version === 2 &&
        pack.npcs.default_npc === 'assets/npc-questgiver.png' &&
        pack.prologue.every((entry) => entry.npc === 'default_npc' && typeof entry.text === 'string') &&
        pack.quests.every((quest) => (quest.description_lore || []).every((entry) => entry.npc === 'default_npc')) &&
        fs.existsSync(path.join(packDir, 'quests.json.v1.bak')),
        `status ${migrated.status}`
    );

    const rerun = sh(goTool('questmigrate'), ['-dir', root]);
    report.check(
        'a second run leaves the migrated pack alone',
        rerun.status === 0 && /already, left alone/.test(rerun.output),
        rerun.output.trim().split('\n')[0]
    );

    // The server side of the contract, in a run root of its own: the linked
    // frontend a bootable server needs, and the pack to be refused.
    const servedRoot = suiteRoot('cli-qa-migrate');
    const servedPack = path.join(servedRoot, 'frontend', 'quests', 'qa-v1');
    fs.mkdirSync(servedPack, { recursive: true });
    fs.copyFileSync(fixture, path.join(servedPack, 'quests.json'));

    return (async () => {
        const refused = new Server({ cwd: servedRoot, port: await pickFreePort(), binary, env: { LOG_LEVEL: 'info' } });
        await refused.start();
        const before = await refused.packs();
        const refusedLog = (await refused.stop('SIGTERM')).log;
        report.check(
            'a pre-v2 pack is refused at startup with the migration tool named in the log',
            /skipping quest pack.*qa-v1.*questmigrate/.test(refusedLog),
            refusedLog.trim().split('\n').filter((line) => /qa-v1/.test(line)).slice(0, 2).join(' ;; ')
        );
        report.check(
            'the refused pack is not served',
            !before.body.includes('qa-v1'),
            `${before.status} ${before.body}`
        );

        sh(goTool('questmigrate'), ['-dir', path.join(servedRoot, 'frontend', 'quests')]);
        const after = new Server({ cwd: servedRoot, port: await pickFreePort(), binary, env: { LOG_LEVEL: 'info' } });
        await after.start();
        const served = await after.packs();
        await after.stop('SIGTERM');
        report.check(
            'the migrated pack loads into the same server setup',
            served.body.includes('qa-v1'),
            `${served.status} ${served.body}`
        );
    })();
}

function main() {
    // Judged on what the run adds to the tree, not on what was already there.
    const baseline = gitStatus(repoRoot);

    const report = new Report('command-line QA');
    let phase = 'startup';

    const watchdog = armWatchdog({ suite: 'command-line QA', baseMs: 90000, phase: () => phase });
    // SIGTERM is what run-qa.cjs's ceiling sends when the net catches a hung
    // suite: the servers it spawned live in process groups of their own, so only
    // this handler can stop them before the process ends.
    process.on('SIGINT', () => {
        stopServersSync();
        process.exit(130);
    });
    process.on('SIGTERM', () => {
        stopServersSync();
        process.exit(130);
    });

    (async () => {
        try {
            phase = 'the server signals';
            const binary = buildServer(repoRoot);
            await serverSignals(report, binary);

            phase = 'solutionverifier';
            solutionVerifier(report);

            phase = 'assetgen';
            assetgenRollback(report);

            phase = 'questmigrate';
            await migrationTool(report, binary);
        } catch (error) {
            report.check('the suite ran to the end', false, error.message.split('\n')[0]);
        }

        watchdog.cancel();
        const clean = report.done();
        const left = leftoverChanges(repoRoot, baseline);
        if (left.length > 0) {
            console.log(`\nleft behind by the run:\n${left.join('\n')}`);
        }
        process.exit(clean ? 0 : 1);
    })();
}

main();
