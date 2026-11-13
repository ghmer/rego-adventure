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

// Save compatibility: an adventure started under the pre-refactor app must still
// resume under the current one.
//
// The save under test is not written by hand. It was produced by the app as it
// stood at the refactor's base commit, playing the same placeholder pack, and
// recorded in docu/qa/testdata/base-save.json. `--capture` replays that run: a
// worktree at the base commit serves the same pack bytes, a quest is solved in
// it, and the resulting localStorage entries are written out again.
//
// Run:  node docu/qa/save-compat.cjs            (fast, uses the recorded save)
//       node docu/qa/save-compat.cjs --capture  (re-records it, a few minutes)

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
    repoRoot,
    gitStatus,
    leftoverChanges,
    buildServer,
    pickFreePort,
    Server,
    generatePack,
    removePack,
    withBrowser,
    newPage,
    Report
} = require('./qa-lib.cjs');

const { execFileSync } = require('node:child_process');

// The refactor's base commit: the last state of the app before any sprint.
const BASE_COMMIT = '6ee2d94';
const SAVE_FIXTURE = path.join(repoRoot, 'docu', 'qa', 'testdata', 'base-save.json');
const PACK = 'qasave';
const POLICY = 'package play\n\ndefault allow = false\n\nallow if {\n    input.password = "secret"\n}\n';

function git(args, cwd) {
    return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

// solveQuestOne plays the placeholder pack's first quest in whichever app is in
// front of the browser, then returns the browser's whole localStorage.
async function solveQuestOne(page, port) {
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.quest-pack-card', { timeout: 3000 });
    await page.locator('.quest-pack-card').first().click();
    await page.waitForSelector('#game-interface:not(.hidden)', { timeout: 3000 });

    // The tour offer (current app) and the tour itself (older app) both sit over
    // the first quest. Declining or closing it is not what this suite is about.
    const decline = page.locator('#tutorial-decline-btn');
    if (await decline.isVisible().catch(() => false)) {
        await decline.click();
    }
    await page.keyboard.press('Escape');

    await page.click('#start-adventure');
    await page.waitForSelector('#editor-pane', { timeout: 3000 });

    const area = page.locator('#rego-editor textarea').first();
    await area.click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.press('Delete');
    await page.keyboard.insertText(POLICY);

    await page.click('#verify-btn');
    await page.waitForSelector('#result-modal[open]', { timeout: 3000 });
    // The save happens before the result dialog is dismissed; the indicator is
    // what says it reached storage.
    await page.waitForFunction(() => {
        const badge = document.querySelector('#save-indicator, .save-indicator');
        return badge ? /saved|idle/i.test(badge.textContent) : true;
    }, null, { timeout: 3000 }).catch(() => {});

    return page.evaluate(() => {
        const entries = {};
        for (let i = 0; i < localStorage.length; i += 1) {
            const key = localStorage.key(i);
            entries[key] = localStorage.getItem(key);
        }
        return entries;
    });
}

// capture plays the pack on the app at the base commit and records its save.
async function capture(report) {
    const worktree = path.join(os.tmpdir(), 'rego-qa-base-worktree');
    fs.rmSync(worktree, { recursive: true, force: true });
    git(['worktree', 'add', '--detach', worktree, BASE_COMMIT], repoRoot);

    // The pack is copied, not generated twice: both apps must serve the same
    // bytes, or the save belongs to a different adventure.
    generatePack(repoRoot, PACK);
    const packSource = path.join(repoRoot, 'frontend', 'quests', PACK);
    const packTarget = path.join(worktree, 'frontend', 'quests', PACK);
    fs.mkdirSync(path.dirname(packTarget), { recursive: true });
    fs.cpSync(packSource, packTarget, { recursive: true });

    let base;
    try {
        const baseBinary = buildServer(worktree, 'rego-server-base');
        const basePort = await pickFreePort();
        base = new Server({ cwd: worktree, port: basePort, binary: baseBinary });
        await base.start();

        await withBrowser(async (browser) => {
            const harness = await newPage(browser, basePort);
            const keys = await solveQuestOne(harness.page, basePort);
            const packState = keys[`rego_pack_state_${PACK}`];
            report.check(
                'the pre-refactor app wrote a pack state to storage',
                Boolean(packState) && Boolean(JSON.parse(packState).questScores?.['1']),
                packState
            );
            fs.writeFileSync(SAVE_FIXTURE, JSON.stringify({
                capturedFrom: `${BASE_COMMIT} (the refactor's base commit)`,
                pack: PACK,
                policy: POLICY,
                keys
            }, null, 2) + '\n');
            await harness.context.close();
        });
    } finally {
        if (base) {
            await base.stop();
        }
        removePack(repoRoot, PACK);
        fs.rmSync(packTarget, { recursive: true, force: true });
        git(['worktree', 'remove', '--force', worktree], repoRoot);
    }
}

// resume plays the recorded save on the current app.
// seededPage opens a page that already holds the given storage, which is what a
// returning player looks like to the app.
async function seededPage(browser, port, keys) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    page.setDefaultTimeout(1500);
    await page.addInitScript((payload) => {
        for (const [key, value] of Object.entries(payload)) {
            localStorage.setItem(key, value);
        }
    }, keys);
    return { context, page };
}

// withState is the recorded save with one thing changed about its body.
function withState(keys, change) {
    const key = `rego_pack_state_${PACK}`;
    const state = JSON.parse(keys[key]);
    change(state);
    return { ...keys, [key]: JSON.stringify(state) };
}

// saveVariants covers the save shapes the matrix asks for: a stored total that
// disagrees with the per-quest records, a cursor sitting on the epilogue, and
// stored reveals whose reveal fetch now answers an error.
async function saveVariants(report, browser, port, keys) {
    const stateKey = `rego_pack_state_${PACK}`;

    // A stored total that disagrees with the records: the records win, because
    // the total is derived from them.
    const inflatedKeys = withState(keys, (state) => { state.totalScore = 999; });
    const inflated = await seededPage(browser, port, inflatedKeys);
    await inflated.page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded' });
    await inflated.page.waitForSelector('#game-interface:not(.hidden)', { timeout: 3000 });
    const corrected = await inflated.page.evaluate((key) => JSON.parse(localStorage.getItem(key)), stateKey);
    const recordedState = JSON.parse(keys[stateKey]);
    report.check(
        'a stored total that disagrees with the quest records is replaced by their sum',
        corrected.totalScore === Object.values(recordedState.questScores).reduce((sum, score) => sum + score.pointsEarned, 0),
        JSON.stringify({ stored: 999, now: corrected.totalScore, records: corrected.questScores })
    );
    await inflated.context.close();

    // A cursor on the epilogue: the adventure resumes where it ended, not at the
    // beginning, and no editor is offered.
    const epilogueKeys = withState(keys, (state) => {
        state.questId = 4;
        state.activeQuestId = 4;
    });
    const epilogue = await seededPage(browser, port, epilogueKeys);
    await epilogue.page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded' });
    await epilogue.page.waitForSelector('#game-interface:not(.hidden)', { timeout: 3000 });
    const epilogueState = await epilogue.page.evaluate(() => ({
        counter: document.getElementById('quest-counter').textContent.trim(),
        title: document.getElementById('quest-title').textContent.trim(),
        editorVisible: Boolean(document.getElementById('editor-pane') && document.getElementById('editor-pane').offsetParent),
        backDisabled: document.getElementById('quest-back-btn').disabled
    }));
    report.check(
        'a save whose cursor sits on the epilogue resumes at the epilogue',
        epilogueState.counter === 'Epilogue' && /Adventure Complete/.test(epilogueState.title) && !epilogueState.editorVisible,
        JSON.stringify(epilogueState)
    );
    report.check('the epilogue can be left behind: the back arrow still walks into the last quest', epilogueState.backDisabled === false, JSON.stringify(epilogueState));
    await epilogue.context.close();

    // Stored reveals that now answer an error: the quest still opens, the failure
    // is announced, and nothing is claimed as revealed that failed to load.
    const revealKeys = withState(keys, (state) => {
        state.questId = 1;
        state.activeQuestId = 1;
        state.questScores = {};
        state.totalScore = 0;
        state.questHints = { 1: { hintsUsed: 1, solutionViewed: false } };
    });
    const reveal = await seededPage(browser, port, revealKeys);
    let failures = 0;
    reveal.page.on('pageerror', () => { failures += 1; });
    await reveal.page.route('**/api/packs/*/quests/*/hints/*', (route) => route.fulfill({ status: 500, body: 'nope' }));
    await reveal.page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded' });
    await reveal.page.waitForSelector('#game-interface:not(.hidden)', { timeout: 3000 });
    await reveal.page.waitForTimeout(400);
    const revealState = await reveal.page.evaluate(() => ({
        counter: document.getElementById('quest-counter').textContent.trim(),
        hintsShown: document.querySelectorAll('#hints-list .hint-item, #hints-list code').length,
        hintsListHidden: document.getElementById('hints-list').classList.contains('hidden'),
        toast: (document.querySelector('.toast, .toast-message') || {}).textContent || '',
        stored: JSON.parse(localStorage.getItem('rego_pack_state_' + localStorage.getItem('rego_pack_id')) || '{}')
    }));
    report.check(
        'a quest with stored reveals still opens when the reveal fetch answers an error',
        revealState.counter === 'Quest 1/3' && failures === 0,
        `${JSON.stringify(revealState)} ;; pageerrors: ${failures}`
    );
    report.check(
        'the failed reveal is announced instead of leaving a silent half-restored list',
        /error|could not|failed|unable/i.test(revealState.toast) && revealState.hintsShown === 0,
        JSON.stringify({ toast: revealState.toast, hintsShown: revealState.hintsShown, hidden: revealState.hintsListHidden })
    );
    await reveal.context.close();
}

async function resume(report, binary) {
    const recorded = JSON.parse(fs.readFileSync(SAVE_FIXTURE, 'utf8'));
    report.check('the recorded save belongs to the pack under test', recorded.pack === PACK, recorded.pack);

    const server = new Server({ cwd: repoRoot, port: await pickFreePort(), binary });
    const port = server.port;
    await server.start({ packs: [PACK] });

    try {
        await withBrowser(async (browser) => {
            const harness = await newPage(browser, port);
            const { page, context } = harness;
            // The save has to be in storage before the app reads it, which is
            // what an arriving returning player looks like.
            await page.addInitScript((keys) => {
                for (const [key, value] of Object.entries(keys)) {
                    localStorage.setItem(key, value);
                }
            }, recorded.keys);

            await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded' });
            await page.waitForSelector('#game-interface:not(.hidden)', { timeout: 3000 });

            const tourOffer = await page.locator('.tutorial-prompt-modal').count();
            report.check('the recorded tutorial progress is honoured, no tour is offered', tourOffer === 0, `offers: ${tourOffer}`);

            const state = JSON.parse(recorded.keys[`rego_pack_state_${PACK}`]);
            const resumed = await page.evaluate(() => ({
                counter: document.getElementById('quest-counter').textContent.trim(),
                title: document.getElementById('quest-title').textContent.trim(),
                grimoire: document.querySelector('#rego-editor textarea') ? document.querySelector('#rego-editor textarea').value : null
            }));
            report.check(
                `the adventure resumes on quest ${state.questId}`,
                resumed.counter === `Quest ${state.questId}/3`,
                `${resumed.counter} (recorded questId ${state.questId})`
            );
            report.check(
                'the policy that was saved comes back in the editor',
                Boolean(resumed.grimoire) && resumed.grimoire.includes('input.password'),
                JSON.stringify(resumed.grimoire)
            );

            const storage = await page.evaluate(() => {
                const names = [];
                for (let i = 0; i < localStorage.length; i += 1) {
                    names.push(localStorage.key(i));
                }
                return names;
            });
            report.check(
                'a pre-refactor save is read, not quarantined as corrupt',
                !storage.some((key) => key.endsWith('_corrupt')),
                storage.join(', ')
            );

            // Playing on from the resumed state has to keep the recorded score:
            // the next attempt on top of the recorded points.
            // The recorded cursor stands on a quest that is already scored and
            // behind the frontier, which the current app treats as history and
            // therefore read-only. The route back to playable ground is the
            // forward arrow.
            const historyView = await page.evaluate(() => {
                const verify = document.getElementById('verify-btn');
                const area = document.querySelector('#rego-editor textarea');
                const forward = document.getElementById('quest-forward-btn');
                return {
                    counter: document.getElementById('quest-counter').textContent.trim(),
                    verifyDisabled: verify.disabled,
                    editorReadOnly: area ? area.readOnly : null,
                    forwardDisabled: forward.disabled,
                    notice: (document.querySelector('#interaction-notice, .interaction-notice, #quest-footer') || {}).textContent || ''
                };
            });
            report.check(
                'a save whose cursor stands on a completed quest resumes as history view',
                historyView.verifyDisabled === true && historyView.forwardDisabled === false,
                JSON.stringify(historyView)
            );
            report.check(
                'the history view is read-only in the editor as well as in the verify control',
                historyView.editorReadOnly === true,
                JSON.stringify({ editorReadOnly: historyView.editorReadOnly, verifyDisabled: historyView.verifyDisabled })
            );

            await page.click('#quest-forward-btn');
            await page.waitForFunction(() => /Quest 2\//.test(document.getElementById('quest-counter').textContent), null, { timeout: 2000 });
            report.check('the forward arrow returns the resumed adventure to its frontier', /Quest 2\/3/.test(await page.textContent('#quest-counter')));

            await page.locator('#rego-editor textarea').first().click();            await page.locator('#rego-editor textarea').first().click();
            await page.keyboard.press('ControlOrMeta+a');
            await page.keyboard.press('Delete');
            await page.keyboard.insertText('package play\n\ndefault allow = false\n\nallow if {\n    input.user.inventory[_] == "pass"\n}\n');
            await page.click('#verify-btn');
            await page.waitForSelector('#result-modal[open]', { timeout: 3000 });
            const earned = Number(await page.textContent('#points-earned').catch(() => '0'));
            report.check('the next quest can still be played and scored', earned > 0, `points: ${earned}`);
            const after = JSON.parse(await page.evaluate((key) => localStorage.getItem(key), `rego_pack_state_${PACK}`));
            report.check(
                'the resumed adventure keeps the recorded points alongside the new ones',
                Object.keys(after.questScores).length === 2 && after.totalScore === (state.questScores['1'].pointsEarned + earned),
                JSON.stringify({ totalScore: after.totalScore, scores: after.questScores })
            );

            // A save from before the storage-key rename is migrated, not ignored.
            const legacyContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
            const legacyPage = await legacyContext.newPage();
            legacyPage.setDefaultTimeout(1500);
            await legacyPage.addInitScript(() => {
                localStorage.setItem('adventureTutorialCompleted', 'true');
            });
            await legacyPage.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded' });
            await legacyPage.waitForSelector('#game-interface:not(.hidden), #start-screen:not(.hidden)', { timeout: 3000 });
            const migrated = await legacyPage.evaluate(() => ({
                current: localStorage.getItem('rego_tutorial_completed'),
                legacy: localStorage.getItem('adventureTutorialCompleted')
            }));
            report.check(
                'a legacy tutorial flag is carried to the current key and removed',
                migrated.current === 'true' && migrated.legacy === null,
                JSON.stringify(migrated)
            );
            await legacyContext.close();

            // The three save shapes the re-run matrix names, each built from the
            // recorded save by changing one thing about it.
            await saveVariants(report, browser, port, recorded.keys);
            await context.close();
        });
    } finally {
        await server.stop('SIGTERM');
    }
}

async function main() {
    // Judged on what the run adds to the tree, not on what was already there.
    const baseline = gitStatus(repoRoot);

    const captureRun = process.argv.includes('--capture');
    const report = new Report(`save compatibility${captureRun ? ' (capture)' : ''}`);
    let phase = 'startup';

    const watchdog = setTimeout(() => {
    console.error(`\nsave compatibility QA exceeded ${captureRun ? 240 : 45}s during "${phase}"`);
        process.exit(2);
    }, captureRun ? 240000 : 45000);
    process.on('SIGINT', () => {
        removePack(repoRoot, PACK);
        process.exit(130);
    });

    try {
        phase = 'server build';
        if (captureRun) {
            report.check('re-recording a pre-refactor save overwrites the fixture', true);
            await capture(report);
        }
        if (!fs.existsSync(SAVE_FIXTURE)) {
            report.check('a recorded pre-refactor save exists', false, `run: node docu/qa/save-compat.cjs --capture to create ${SAVE_FIXTURE}`);
        } else {
            report.check('a recorded pre-refactor save exists', true, `${SAVE_FIXTURE} (${recordedNote()})`);
        }

        if (fs.existsSync(SAVE_FIXTURE)) {
            phase = 'the current app resuming that save';
            const binary = buildServer(repoRoot);
            await resume(report, binary);
        }
    } catch (error) {
        report.check('the suite ran to the end', false, error.message.split('\n')[0]);
    } finally {
        removePack(repoRoot, PACK);
    }

    clearTimeout(watchdog);
    const clean = report.done();
    const left = leftoverChanges(repoRoot, baseline);
    if (left.length > 0) {
        console.log(`\nleft behind by the run:\n${left.join('\n')}`);
    }
    process.exit(clean ? 0 : 1);
}

function recordedNote() {
    try {
        return JSON.parse(fs.readFileSync(SAVE_FIXTURE, 'utf8')).capturedFrom;
    } catch (error) {
        return 'unreadable';
    }
}

main().catch((error) => {
    console.error(error);
    process.exit(2);
});
