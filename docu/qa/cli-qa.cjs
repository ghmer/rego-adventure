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
// what solutionverifier prints when a quest cannot be evaluated, and what an
// interrupted assetgen run leaves on disk.
//
// The listener-ended line is not reachable from outside a process, so it stays
// covered by TestRunWithGracefulShutdown_ListenerClosedWithoutAShutdownRequest.
//
// Run: node docu/qa/cli-qa.cjs

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { spawnSync } = require('node:child_process');

const {
    repoRoot,
    gitStatus,
    leftoverChanges,
    buildServer,
    pickFreePort,
    Server,
    run,
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

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'rego-cli-qa-'));

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
    const server = new Server({ cwd: repoRoot, port, binary, env: { LOG_LEVEL: 'info' } });
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

    const interrupted = new Server({ cwd: repoRoot, port: await pickFreePort(), binary, env: { LOG_LEVEL: 'info' } });
    await interrupted.start();
    const signalled = await interrupted.stop('SIGINT');
    report.check(
        'a SIGINT run drains the same way',
        /server stopped gracefully/.test(signalled.log) && signalled.code === 0,
        `${signalled.code} ;; ${signalled.log.trim().split('\n').slice(-1)[0]}`
    );
}

function solutionVerifier(report) {
    const packFile = writeJSON(path.join(scratch, 'broken-quests.json'), brokenPack());
    const output = sh('go', ['run', './cmd/solutionverifier', '-questsfile', packFile]).output;

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
    const output = path.join(scratch, 'assetgen');
    const packDir = path.join(output, 'qacli');
    fs.mkdirSync(packDir, { recursive: true });
    // An authored file that must survive, and a directory where a generated file
    // wants to go, which is what makes a later step fail.
    fs.writeFileSync(path.join(packDir, 'quests.json'), '{"authored":true}');
    fs.mkdirSync(path.join(packDir, 'theme.css'));

    const result = sh('go', ['run', './cmd/assetgen', '-theme', 'qacli', '-output', output]);
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
    const clean = sh('go', ['run', './cmd/assetgen', '-theme', 'qacli-clean', '-output', output]);
    report.check(
        'a complete run afterwards produces a pack',
        clean.status === 0 && fs.existsSync(path.join(output, 'qacli-clean', 'quests.json')),
        `status ${clean.status}`
    );
}

function main() {
    // Judged on what the run adds to the tree, not on what was already there.
    const baseline = gitStatus(repoRoot);

    const report = new Report('command-line QA');
    let phase = 'startup';

    const watchdog = setTimeout(() => {
        console.error(`\ncommand-line QA exceeded 90s during "${phase}"`);
        process.exit(2);
    }, 90000);
    process.on('SIGINT', () => {
        fs.rmSync(scratch, { recursive: true, force: true });
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
        } catch (error) {
            report.check('the suite ran to the end', false, error.message.split('\n')[0]);
        }

        clearTimeout(watchdog);
        const clean = report.done();
        const left = leftoverChanges(repoRoot, baseline);
        if (left.length > 0) {
            console.log(`\nleft behind by the run:\n${left.join('\n')}`);
        }
        fs.rmSync(scratch, { recursive: true, force: true });
        process.exit(clean ? 0 : 1);
    })();
}

main();
