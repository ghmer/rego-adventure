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

// Browser QA for the dialog machine: the seven <dialog> elements and the tutorial
// prompt, walked against the dismissal policy that ModalManager states at its
// class - open mode, backdrop, ESC, focus on open, and what a close cleans up.
//
// Confetti is a canvas animation, so it is observed through the interval that
// feeds it: the harness records setInterval/clearInterval calls of that period
// before the app loads, which makes "the celebration stops when its dialog
// closes" and "a player with effects off gets no celebration" checkable without
// reading pixels.
//
// Run: node docu/qa/dialog-qa.cjs

const fs = require('node:fs');
const path = require('node:path');

const {
    repoRoot,
    gitStatus,
    leftoverChanges,
    buildServer,
    pickFreePort,
    generatePack,
    removePack,
    Server,
    withBrowser,
    newPage,
    Report
} = require('./qa-lib.cjs');

const PACK = 'qadialog';
const TIMING_CONFETTI_INTERVAL_MS = 250;

const CORRECT = {
    1: 'package play\n\ndefault allow = false\n\nallow if {\n    input.password = "secret"\n}\n',
    2: 'package play\n\ndefault allow = false\n\nallow if {\n    input.user.inventory[_] == "pass"\n}\n',
    3: 'package play\n\ndefault allow = false\n\nallow if {\n    input.user.name == "Alice"\n}\n'
};
// A policy that fails every test of the quest it is aimed at, and one that cannot
// be evaluated at all.
const WRONG = 'package play\n\ndefault allow = false\n';
const UNPARSEABLE = 'package play\n\nallow if {\n';

// A support module on the first quest, so the support-modules dialog has
// something to show and its button is enabled.
function addSupportModule(packDir) {
    const file = path.join(packDir, 'quests.json');
    const pack = JSON.parse(fs.readFileSync(file, 'utf8'));
    pack.quests[0].support_modules = ['package support\n\ngranted if {\n    input.password = "secret"\n}\n'];
    fs.writeFileSync(file, JSON.stringify(pack, null, 4));
}

// watchIntervals records the setInterval/clearInterval pairs the app produces at
// the confetti period, in order, so the checks can name who started what.
function watchIntervals(page) {
    return page.addInitScript((period) => {
        window.__tick = { started: [], cleared: [], closes: [] };
        document.addEventListener('close', (event) => {
            window.__tick.closes.push(event.target.id || event.target.className);
        }, true);
        const realSet = window.setInterval;
        const realClear = window.clearInterval;
        window.setInterval = function (fn, delay, ...rest) {
            const handle = realSet.call(window, fn, delay, ...rest);
            if (delay === period) {
                window.__tick.started.push({ handle, delay });
            }
            return handle;
        };
        // Every clear is recorded: a handle that was cleared without the harness
        // having seen its start means the effect was started before the watch.
        window.clearInterval = function (handle) {
            window.__tick.cleared.push(handle);
            return realClear.call(window, handle);
        };
    }, TIMING_CONFETTI_INTERVAL_MS);
}

// withinWindow waits for the confetti interval feeding a celebration to be
// cleared, and gives up inside the celebration's own lifetime (3s), so the check
// measures the dialog's cleanup rather than the animation ending by itself.
async function clearedWithinWindow(page, ms = 700) {
    await page.waitForFunction(() => {
        const state = window.__tick;
        return state.started.every((entry) => state.cleared.includes(entry.handle));
    }, null, { timeout: ms }).catch(() => {});
    return tickState(page);
}

async function tickState(page) {
    return page.evaluate(() => {
        const started = window.__tick.started.map((entry) => entry.handle);
        const cleared = window.__tick.cleared;
        return {
            started: started.length,
            cleared: cleared.length,
            closes: window.__tick.closes.slice(-3),
            outstanding: started.filter((handle) => !cleared.includes(handle))
        };
    });
}

// backdropClick aims a real mouse click at the area that the app treats as the
// dialog's backdrop. For the dialogs that sit in the middle of the page that is
// the darkened area around them, which a hit test gives to the dialog element;
// for the result dialog, which spans the viewport, it is the padding inside it.
async function backdropClick(page, id) {
    const point = await page.evaluate((dialogId) => {
        const dialog = document.getElementById(dialogId);
        const box = dialog.getBoundingClientRect();
        const inside = [
            [box.x + 6, box.y + 6],
            [box.right - 6, box.bottom - 6],
            [box.x + box.width / 2, box.bottom - 4]
        ];
        const around = [
            [box.x + box.width / 2, box.y - 20],
            [box.x - 20, box.y + box.height / 2],
            [box.right + 20, box.y + box.height / 2],
            [box.x + box.width / 2, box.bottom + 20]
        ];
        const visible = ([x, y]) => x > 0 && y > 0 && x < innerWidth && y < innerHeight;
        for (const [x, y] of [...inside, ...around].filter(visible)) {
            if (document.elementFromPoint(x, y) === dialog) {
                return { x, y, found: true };
            }
        }
        return { found: false, box };
    }, id);
    if (!point.found) {
        return { clicked: false, reason: 'no point of the dialog is exposed as its own target' };
    }
    await page.mouse.click(point.x, point.y);
    return { clicked: true, x: point.x, y: point.y };
}

async function dialogOpen(page, id) {
    return page.evaluate((dialogId) => {
        const dialog = document.getElementById(dialogId);
        return {
            present: Boolean(dialog),
            open: Boolean(dialog) && dialog.open,
            modal: Boolean(dialog) && dialog.matches(':modal'),
            focus: document.activeElement ? `${document.activeElement.tagName.toLowerCase()}#${document.activeElement.id}` : 'none'
        };
    }, id);
}

// whatIsAt reports which element a point belongs to: the proof that a control
// behind a modal dialog cannot be reached.
async function whatIsAt(page, selector) {
    return page.evaluate((sel) => {
        const target = document.querySelector(sel);
        const box = target.getBoundingClientRect();
        const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
        const dialog = hit ? hit.closest('dialog') : null;
        return {
            hit: hit ? `${hit.tagName.toLowerCase()}${hit.id ? `#${hit.id}` : ''}` : 'nothing',
            insideDialog: dialog ? dialog.id : null
        };
    }, selector);
}

// clickOffer presses a pulsing call to action (components.css keeps
// .action-btn.success and .perfect-score-btn animating), which never settles and
// so is never "stable" for an ordinary click. Modality is checked separately.
async function clickOffer(page, id) {
    await page.locator(`#${id}`).click({ force: true, timeout: 1500 });
}

async function typePolicy(page, text) {
    const area = page.locator('#rego-editor textarea').first();
    await area.click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.press('Delete');
    await page.keyboard.insertText(text);
}

// verifyWith submits a policy and waits for the result dialog.
async function verifyWith(page, policy) {
    await typePolicy(page, policy);
    await page.click('#verify-btn');
    await page.waitForSelector('#result-modal[open]', { timeout: 3000 });
}

async function declinePrompt(page) {
    await page.waitForSelector('.tutorial-prompt-modal', { timeout: 1500 }).catch(() => {});
    if (await page.locator('.tutorial-prompt-modal').count()) {
        await page.click('#tutorial-decline-btn');
    }
}

async function main() {
    // Judged on what the run adds to the tree, not on what was already there.
    const baseline = gitStatus(repoRoot);

    const report = new Report('dialog machine browser QA');
    let phase = 'startup';

    const watchdog = setTimeout(() => {
        console.error(`\ndialog QA exceeded 60s during "${phase}"`);
        process.exit(2);
    }, 60000);
    const quit = (code) => {
        removePack(repoRoot, PACK);
        const { stopServersSync } = require('./qa-lib.cjs');
        stopServersSync();
        process.exit(code);
    };
    process.on('SIGINT', () => quit(130));
    process.on('SIGTERM', () => quit(130));

    try {
        const binary = buildServer(repoRoot);
        const port = await pickFreePort();
        const server = new Server({ cwd: repoRoot, port, binary });
        await server.start({ packs: [PACK] });
        addSupportModule(path.join(repoRoot, 'frontend', 'quests', PACK));
        // The pack must be read again now that it carries a support module.
        await server.stop('SIGTERM');
        await server.start();

        await withBrowser(async (browser) => {
            phase = 'the tutorial prompt';
            const first = await newPage(browser, port);
            const page = first.page;
            const apiPaths = [];
            page.on('request', (request) => {
                if (request.url().includes('/api/')) {
                    apiPaths.push(request.url());
                }
            });
            await watchIntervals(page);
            await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded' });
            await page.locator('.quest-pack-card').first().click();
            await page.waitForSelector('#game-interface:not(.hidden)', { timeout: 3000 });
            await page.waitForSelector('.tutorial-prompt-modal', { timeout: 1500 }).catch(() => {});

            const prompt = await page.evaluate(() => {
                const dialog = document.querySelector('.tutorial-prompt-modal');
                return {
                    present: Boolean(dialog),
                    open: Boolean(dialog) && dialog.open,
                    modal: Boolean(dialog) && dialog.matches(':modal'),
                    focus: document.activeElement ? document.activeElement.id : 'none'
                };
            });
            report.check('the tour offer opens as a modal dialog', prompt.present && prompt.open && prompt.modal, JSON.stringify(prompt));
            await page.keyboard.press('Escape');
            const afterEscape = await page.evaluate(() => {
                const dialog = document.querySelector('.tutorial-prompt-modal');
                return {
                    open: Boolean(dialog) && dialog.open,
                    tour: Boolean(document.querySelector('.driver-popover, #driver-highlighted-element-stage'))
                };
            });
            report.check(
                'ESC on the tour offer declines it and starts no tour',
                afterEscape.open === false && afterEscape.tour === false,
                JSON.stringify(afterEscape)
            );

            phase = 'the five dialogs a quest offers';
            await page.click('#start-adventure');
            await page.waitForSelector('#editor-pane', { timeout: 3000 });

            const matrix = [
                { id: 'manual-modal', opener: '#check-manual-btn', focus: 'close-manual-btn', backdrop: true, esc: true },
                { id: 'test-payload-modal', opener: '#check-test-payload-btn', focus: 'close-test-payload-btn', backdrop: true, esc: true },
                { id: 'support-modules-modal', opener: '#check-support-modules-btn', focus: 'close-support-modules-btn', backdrop: true, esc: true },
                { id: 'hint-modal', opener: '#hint-btn', focus: 'cancel-hint-btn', backdrop: true, esc: true },
                { id: 'restart-modal', opener: '#restart-btn', focus: 'cancel-restart-btn', backdrop: false, esc: false }
            ];
            for (const item of matrix) {
                await page.click(item.opener);
                await page.waitForSelector(`#${item.id}[open]`, { timeout: 1500 }).catch(() => {});
                const opened = await dialogOpen(page, item.id);
                report.check(`${item.id} opens modally`, opened.open && opened.modal, JSON.stringify(opened));
                report.check(
                    `${item.id} focuses ${item.focus} when it opens`,
                    opened.focus === `button#${item.focus}`,
                    opened.focus
                );

                const click = await backdropClick(page, item.id);
                const afterBackdrop = await dialogOpen(page, item.id);
                report.check(
                    `${item.id} ${item.backdrop ? 'closes on a backdrop click' : 'survives a backdrop click'}`,
                    click.clicked && afterBackdrop.open === !item.backdrop,
                    `${JSON.stringify(click)} ;; ${JSON.stringify(afterBackdrop)}`
                );

                if (!item.backdrop) {
                    // Still open, as the policy says; ESC must not close it either.
                    await page.keyboard.press('Escape');
                    const afterEscapeOfRestart = await dialogOpen(page, item.id);
                    report.check(`${item.id} stays open under ESC: it confirms by button only`, afterEscapeOfRestart.open === true, JSON.stringify(afterEscapeOfRestart));
                    await page.click('#cancel-restart-btn');
                    report.check(`${item.id} closes from its cancel button`, (await dialogOpen(page, item.id)).open === false);
                    continue;
                }

                await page.waitForSelector(`#${item.id}:not([open])`, { timeout: 1500 }).catch(() => {});
                await page.click(item.opener).catch(() => {});
                await page.waitForSelector(`#${item.id}[open]`, { timeout: 1500 }).catch(() => {});
                await page.keyboard.press('Escape');
                const afterEsc = await dialogOpen(page, item.id);
                report.check(`${item.id} closes under ESC`, afterEsc.open === false, JSON.stringify(afterEsc));
            }

            phase = 'what the pack payload carries, and what it does not';
            const payload = await page.evaluate(async (packId) => {
                const text = await (await fetch(`/api/packs/${packId}`)).text();
                const quests = JSON.parse(text).quests || [];
                return {
                    quests: quests.length,
                    questsWithTests: quests.filter((q) => 'tests' in q).length,
                    payloadKeys: text.includes('"payload"'),
                    // The keys of a serialized test case, not the words a quest
                    // description may contain.
                    testData: text.includes('"input":') || text.includes('"expected_value":'),
                    hintsCount: quests.reduce((sum, q) => sum + (q.hints_count || 0), 0)
                };
            }, PACK);
            report.check(
                'the pack payload carries no test cases',
                payload.quests > 0 && payload.questsWithTests === 0
                    && !payload.payloadKeys && !payload.testData,
                JSON.stringify(payload)
            );
            report.check(
                'the payload still says what can be revealed',
                payload.hintsCount > 0,
                JSON.stringify(payload)
            );

            await page.click('#check-test-payload-btn');
            await page.waitForSelector('#test-payload-modal[open]', { timeout: 1500 }).catch(() => {});
            const modal = await page.evaluate(() => ({
                cases: document.querySelectorAll('#test-payload-modal .test-case-title').length,
                inputs: (document.getElementById('test-payload-data') || {}).textContent || '',
                expected: [...document.querySelectorAll('#test-payload-modal .test-case-expected')]
                    .map((el) => el.textContent.trim())
            }));
            report.check(
                'the test modal is filled by the test-payload endpoint',
                apiPaths.some((url) => url.includes('/test-payload'))
                    && modal.cases === 2
                    && modal.inputs.includes('"password"')
                    && modal.expected.some((text) => /true/i.test(text))
                    && modal.expected.some((text) => /false/i.test(text)),
                `${JSON.stringify({ paths: apiPaths.length, ...modal })}`
            );
            await page.click('#close-test-payload-btn');

            phase = 'a result over a live page, with effects off';
            await verifyWith(page, WRONG);
            const failure = await page.evaluate(() => ({
                title: document.getElementById('result-title').textContent.trim(),
                effects: document.body.className,
                toggle: document.getElementById('effects-btn').getAttribute('aria-label'),
                overlay: (() => {
                    const overlay = document.getElementById('dark-overlay');
                    return overlay ? overlay.classList.contains('active') : false;
                })(),
                focus: document.activeElement ? document.activeElement.id : 'none'
            }));
            report.check('a failed verification is reported in the result dialog', failure.title === 'Quest Failed', JSON.stringify(failure));
            report.check(
                'effects are off until the player asks for them',
                failure.effects.includes('effects-disabled') && /enable/i.test(failure.toggle || ''),
                JSON.stringify({ effects: failure.effects, toggle: failure.toggle })
            );
            report.check('a player with effects off gets no failure overlay', failure.overlay === false, JSON.stringify(failure));
            report.check(
                'the result dialog focuses the control that ends it',
                failure.focus === 'close-result-btn',
                failure.focus
            );
            const reach = await whatIsAt(page, '#verify-btn');
            report.check('verify behind an open result dialog is unreachable', reach.insideDialog === 'result-modal', JSON.stringify(reach));
            const reachHint = await whatIsAt(page, '#hint-btn');
            report.check('a reveal behind an open result dialog is unreachable', reachHint.insideDialog === 'result-modal', JSON.stringify(reachHint));
            const reachArrow = await whatIsAt(page, '#quest-back-btn');
            report.check('navigation behind an open result dialog is unreachable', reachArrow.insideDialog === 'result-modal', JSON.stringify(reachArrow));
            await page.keyboard.press('Escape');
            await page.waitForSelector('#result-modal:not([open])', { timeout: 1500 }).catch(() => {});

            phase = 'the effects a player turns on';
            await page.click('#effects-btn');
            const effectsOn = await page.evaluate(() => ({
                disabled: document.body.classList.contains('effects-disabled'),
                toggle: document.getElementById('effects-btn').getAttribute('aria-label')
            }));
            report.check('the settings control turns effects on', effectsOn.disabled === false && /disable/i.test(effectsOn.toggle || ''), JSON.stringify(effectsOn));

            await verifyWith(page, WRONG);
            const darkened = await page.evaluate(() => {
                const overlay = document.getElementById('dark-overlay');
                return { overlay: overlay ? overlay.classList.contains('active') : false };
            });
            report.check('a player with effects on gets the failure overlay', darkened.overlay === true, JSON.stringify(darkened));
            await page.keyboard.press('Escape');
            await page.waitForSelector('#result-modal:not([open])', { timeout: 1500 }).catch(() => {});
            const overlayAfter = await page.evaluate(() => {
                const overlay = document.getElementById('dark-overlay');
                return { overlayActive: overlay ? overlay.classList.contains('active') : false };
            });
            report.check('closing a result removes the overlay it started', overlayAfter.overlayActive === false, JSON.stringify(overlayAfter));

            phase = 'the success effect and its cleanup';
            const beforeSuccess = await tickState(page);
            await verifyWith(page, CORRECT[1]);
            const afterSuccess = await tickState(page);
            report.check(
                'a success celebrates with confetti',
                afterSuccess.started > beforeSuccess.started,
                JSON.stringify({ before: beforeSuccess, after: afterSuccess })
            );
            await clickOffer(page, 'next-quest-btn');
            await page.waitForFunction(() => /Quest 2\/3/.test(document.getElementById('quest-counter').textContent), null, { timeout: 2000 });
            const ticksAfterClose = await clearedWithinWindow(page);
            report.check(
                'the confetti stops when the dialog that started it closes',
                ticksAfterClose.outstanding.length === 0 && ticksAfterClose.started >= 1,
                JSON.stringify({ success: afterSuccess, after: ticksAfterClose })
            );

            phase = 'a policy that cannot be evaluated';
            await typePolicy(page, UNPARSEABLE);
            await page.click('#verify-btn');
            await page.waitForSelector('#result-modal[open]', { timeout: 3000 });
            const unparseable = await page.evaluate(() => ({
                title: document.getElementById('result-title').textContent.trim(),
                errors: Array.from(document.querySelectorAll('#result-test-list li')).map((li) => li.textContent.trim())
            }));
            report.check(
                'a policy that cannot be evaluated is reported as an error, not as a passing or failing test',
                /error/i.test(unparseable.title) && unparseable.errors.length > 0,
                JSON.stringify(unparseable)
            );
            await page.keyboard.press('Escape');
            await page.waitForSelector('#result-modal:not([open])', { timeout: 1500 }).catch(() => {});

            phase = 'a clean run to the epilogue';
            await verifyWith(page, CORRECT[2]);
            await clickOffer(page, 'next-quest-btn');
            await page.waitForFunction(() => /Quest 3\/3/.test(document.getElementById('quest-counter').textContent), null, { timeout: 2000 });
            await verifyWith(page, CORRECT[3]);
            const scored = await page.evaluate((pack) => JSON.parse(localStorage.getItem(`rego_pack_state_${pack}`) || '{}'), PACK);
            report.check(
                'finishing the last quest records all three quests',
                Object.keys(scored.questScores).length === 3 && scored.questId === 3,
                JSON.stringify({ scores: scored.questScores, cursor: scored.questId, frontier: scored.activeQuestId })
            );
            await page.keyboard.press('Escape');
            await page.waitForSelector('#result-modal:not([open])', { timeout: 1500 }).catch(() => {});

            phase = 'the opt-out honoured at the edge of every effect';
            await page.click('#effects-btn');
            const offAgain = await page.evaluate(() => document.body.classList.contains('effects-disabled'));
            report.check('the settings control turns effects off again', offAgain === true);

            const quietBefore = await tickState(page);
            await verifyWith(page, WRONG);
            const failedQuietly = await page.evaluate(() => {
                const overlay = document.getElementById('dark-overlay');
                return { overlay: overlay ? overlay.classList.contains('active') : false };
            });
            report.check('a player with effects off gets no failure overlay either', failedQuietly.overlay === false, JSON.stringify(failedQuietly));
            const ticksQuiet = await tickState(page);
            report.check('and no confetti for a result they did not ask for', ticksQuiet.started === quietBefore.started, JSON.stringify({ before: quietBefore, after: ticksQuiet }));
            const afterFailure = await page.evaluate((pack) => JSON.parse(localStorage.getItem(`rego_pack_state_${pack}`) || '{}'), PACK);
            report.check(
                'a failed attempt against a scored quest leaves the record alone',
                JSON.stringify(afterFailure.questScores) === JSON.stringify(scored.questScores) && afterFailure.activeQuestId === scored.activeQuestId,
                JSON.stringify({ before: scored.questScores, after: afterFailure.questScores, frontier: [scored.activeQuestId, afterFailure.activeQuestId] })
            );
            await page.keyboard.press('Escape');
            await page.waitForSelector('#result-modal:not([open])', { timeout: 1500 }).catch(() => {});

            // The epilogue is reached with the opt-out still on: the offer is
            // made, but the celebration it would start is not.
            await verifyWith(page, CORRECT[3]);
            await clickOffer(page, 'next-quest-btn');
            await page.waitForFunction(() => document.getElementById('quest-counter').textContent.trim() === 'Epilogue', null, { timeout: 2000 }).catch(() => {});
            report.check(
                'the epilogue follows the last quest',
                (await page.textContent('#quest-counter')).trim() === 'Epilogue',
                await page.textContent('#quest-counter')
            );
            report.check(
                'a run that spent nothing on hints is offered its celebration',
                (await page.locator('#perfect-score-btn:not(.hidden)').count()) === 1,
                await page.evaluate(() => document.getElementById('perfect-score-btn').className)
            );

            const refused = await tickState(page);
            await clickOffer(page, 'perfect-score-btn');
            await page.waitForSelector('#perfect-score-modal[open]', { timeout: 1500 }).catch(() => {});
            const refusedAfterOpen = await tickState(page);
            report.check(
                'a perfect run with effects off is offered but not celebrated',
                refusedAfterOpen.started === refused.started,
                JSON.stringify({ before: refused, after: refusedAfterOpen })
            );
            await page.click('#close-perfect-score-btn');

            // The same player, effects back on: the celebration starts and stops
            // with the dialog.
            await page.click('#effects-btn');
            const beforeCelebration = await tickState(page);
            await clickOffer(page, 'perfect-score-btn');
            await page.waitForSelector('#perfect-score-modal[open]', { timeout: 1500 }).catch(() => {});
            const celebration = await dialogOpen(page, 'perfect-score-modal');
            const afterCelebration = await tickState(page);
            report.check('the perfect-score dialog opens modally', celebration.open && celebration.modal, JSON.stringify(celebration));
            report.check(
                'a perfect run with effects on is celebrated',
                afterCelebration.started > beforeCelebration.started,
                JSON.stringify({ before: beforeCelebration, after: afterCelebration })
            );
            await page.click('#close-perfect-score-btn');
            await page.waitForSelector('#perfect-score-modal:not([open])', { timeout: 1500 }).catch(() => {});
            const afterCelebrationClose = await clearedWithinWindow(page);
            report.check(
                'the celebration does not outlive the dialog that started it',
                afterCelebrationClose.outstanding.length === 0,
                JSON.stringify({ after: afterCelebration, close: afterCelebrationClose })
            );

            report.check('no page errors during the run', first.consoleErrors.length === 0, first.consoleErrors.slice(0, 4).join(' ;; '));
            await first.context.close();
        });

        await server.stop('SIGTERM');
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

main().catch((error) => {
    console.error(error);
    process.exit(2);
});
