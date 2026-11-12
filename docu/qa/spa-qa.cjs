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

// Browser QA for the adventure SPA: the flows the unit tests cannot reach.
// Run with: node docu/qa/spa-qa.cjs
//
// The suite starts its own server on a scratch port, generates placeholder quest
// packs with cmd/assetgen, and removes them again.

const fs = require('node:fs');
const path = require('node:path');

const {
    repoRoot,
    buildServer,
    gitStatus,
    leftoverChanges,
    Server,
    pickFreePort,
    stopServersSync,
    Report,
    withBrowser,
    newPage,
    removePack,
    toastText
} = require('./qa-lib.cjs');

let PORT = Number(process.env.QA_PORT || 0);
const PACKS = ['qaone', 'qatwo'];

// The placeholder pack's quests are solved with these policies. Rego 1 needs the
// `if` keyword before a rule body, which is what the editor's own manual shows.
const SOLUTIONS = {
    1: 'package play\n\ndefault allow = false\n\nallow if {\n    input.password = "secret"\n}\n',
    2: 'package play\n\ndefault allow = false\n\nallow if {\n    input.user.inventory[_] == "pass"\n}\n',
    3: 'package play\n\ndefault allow = false\n\nallow if {\n    input.user.name == "Alice"\n}\n'
};

// ----------------------------------------------------------------------------
// page helpers
// ----------------------------------------------------------------------------

async function openStartScreen(harness) {
    await harness.page.goto(harness.url(), { waitUntil: 'domcontentloaded' });
    await harness.page.waitForSelector('#start-screen');
}

function packCards(page) {
    return page.locator('#quest-pack-list .quest-pack-card');
}

async function enterPack(page, titleFragment) {
    await page.locator(`#quest-pack-list .quest-pack-card:has-text("${titleFragment}")`).first().click();
    await page.waitForSelector('#game-interface:not(.hidden)');
}

async function declineTour(page) {
    const prompt = page.locator('.tutorial-prompt-modal');
    if (await prompt.count() === 0) {
        return false;
    }
    await page.check('#tutorial-dont-show');
    await page.click('#tutorial-decline-btn');
    await prompt.waitFor({ state: 'detached', timeout: 3000 });
    return true;
}

function editorSelector() {
    return '#rego-editor textarea';
}

async function editorText(page) {
    return page.evaluate(() => {
        const area = document.querySelector('#rego-editor textarea');
        return area ? area.value : null;
    });
}

// setSolution puts a policy into the editor through the editor's own input
// handling: the content is inserted as one text input, which the editor's
// document sees. Writing textarea.value directly would leave the editor's model
// holding the old text, and a verify would send that.
async function setSolution(page, text) {
    const area = page.locator(editorSelector()).first();
    await area.click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.press('Delete');
    await page.keyboard.insertText(text);
    return 'insertText';
}

async function indicatorClass(page) {
    return page.getAttribute('#editor-save-indicator', 'class');
}

async function indicatorLabel(page) {
    return page.getAttribute('#editor-save-indicator', 'aria-label');
}

// The controls the tour borrows: on the prologue they are hidden, and the tour
// unhides them so it can point at them.
const TOUR_BORROWED = ['#editor-pane', '#rego-editor', '#verify-btn', '#check-manual-btn', '#quest-back-btn', '#quest-forward-btn'];

async function borrowedState(page) {
    return page.evaluate((selectors) => {
        const out = {};
        for (const selector of selectors) {
            const el = document.querySelector(selector);
            out[selector] = el ? { hiddenClass: el.classList.contains('hidden'), painted: Boolean(el.offsetParent) } : null;
        }
        out.artifacts = document.querySelectorAll('.driver-popover, .driver-overlay, .driver-active, .element-highlight').length;
        return out;
    }, TOUR_BORROWED);
}

async function dialogState(page, id) {
    return page.evaluate((dialogId) => {
        const dialog = document.getElementById(dialogId);
        if (!dialog) {
            return { present: false };
        }
        return {
            present: true,
            open: dialog.open,
            text: (dialog.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120)
        };
    }, id);
}

// verifyQuest types a policy, verifies, and returns with the result dialog open.
async function verifyQuest(page, policy) {
    await setSolution(page, policy);
    await page.click('#verify-btn');
    await page.waitForSelector('#result-modal[open]', { timeout: 3000 }).catch(() => {});
}

// The result dialog's primary call to action pulses indefinitely (components.css
// .action-btn.success), so it never settles and a plain click waits for nothing.
// These clicks are forced; whether a dialog is modal is asserted separately.
async function clickPulsing(page, selector) {
    await page.locator(selector).click({ force: true, timeout: 1500 });
}

// theTour walks the guided tour: one context where it runs and ends, one where
// its driver cannot start at all. What matters in both is that the controls the
// tour borrowed go back to being hidden and nothing the tour drew is left on the
// page.
async function theTour(browser, report, port, baseUrl) {
    const url = `${baseUrl}`;

    const started = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await started.newPage();
    page.setDefaultTimeout(1500);
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.locator('.quest-pack-card').first().click();
    await page.waitForSelector('#game-interface:not(.hidden)', { timeout: 3000 });
    await page.waitForSelector('.tutorial-prompt-modal', { timeout: 1500 }).catch(() => {});

    const before = await borrowedState(page);
    report.check(
        'the prologue keeps the controls the tour explains out of sight',
        TOUR_BORROWED.every((selector) => before[selector] && before[selector].painted === false),
        JSON.stringify(before)
    );

    await page.click('#tutorial-accept-btn');
    await page.waitForSelector('.driver-popover', { timeout: 2000 }).catch(() => {});
    const during = await borrowedState(page);
    report.check(
        'the tour shows the controls it points at',
        during['#editor-pane'].painted === true && during['#verify-btn'].painted === true && during.artifacts > 0,
        JSON.stringify({ painted: [during['#editor-pane'].painted, during['#verify-btn'].painted], artifacts: during.artifacts })
    );

    await page.keyboard.press('Escape');
    await page.waitForSelector('.driver-popover', { state: 'detached', timeout: 2000 }).catch(() => {});
    const after = await borrowedState(page);
    report.check('the tour leaves nothing of itself on the page', after.artifacts === 0, JSON.stringify({ artifacts: after.artifacts }));
    report.check(
        'the tour hides the controls it borrowed again',
        TOUR_BORROWED.every((selector) => after[selector].painted === before[selector].painted),
        JSON.stringify(after)
    );
    // The hand-off is deferred one frame, past the focus the driver restores.
    await page.waitForFunction(() => document.activeElement && document.activeElement.id === 'start-adventure', null, { timeout: 800 }).catch(() => {});
    const focus = await page.evaluate(() => document.activeElement ? (document.activeElement.id || document.activeElement.tagName.toLowerCase()) : 'none');
    report.check('when the tour ends, focus lands on the primary call to action', focus === 'start-adventure', focus);
    await started.close();

    // A driver that cannot start: the module resolves, but building the driver
    // throws. The app must still be usable and must not leave the borrowed
    // controls showing.
    const broken = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const quiet = await broken.newPage();
    quiet.setDefaultTimeout(1500);
    const pageErrors = [];
    quiet.on('pageerror', (error) => pageErrors.push(error.message));
    await quiet.route('**/esm.sh/driver.js*', (route) => route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: 'export const driver = () => { throw new Error("driver unavailable"); };\nexport default driver;\n'
    }));
    await quiet.goto(url, { waitUntil: 'domcontentloaded' });
    await quiet.locator('.quest-pack-card').first().click();
    await quiet.waitForSelector('#game-interface:not(.hidden)', { timeout: 3000 });
    await quiet.waitForSelector('.tutorial-prompt-modal', { timeout: 1500 }).catch(() => {});
    const brokenBefore = await borrowedState(quiet);
    await quiet.click('#tutorial-accept-btn');
    await quiet.waitForTimeout(300);
    const brokenAfter = await borrowedState(quiet);
    report.check(
        'a tour whose driver cannot start leaves nothing showing that was borrowed for it',
        brokenAfter.artifacts === 0 && TOUR_BORROWED.every((selector) => brokenAfter[selector].painted === brokenBefore[selector].painted),
        JSON.stringify({ artifacts: brokenAfter.artifacts, states: TOUR_BORROWED.map((selector) => brokenAfter[selector] && brokenAfter[selector].hiddenClass) })
    );
    await quiet.click('#start-adventure');
    await quiet.waitForSelector('#editor-pane', { timeout: 2000 }).catch(() => {});
    report.check(
        'the adventure still begins when the tour cannot be shown',
        await quiet.isVisible('#rego-editor'),
        `page errors: ${pageErrors.slice(0, 2).join(' ;; ') || 'none'}`
    );
    await broken.close();
}

// takeNextQuest steps forward from the result dialog's own offer, which is the
// path that moves past a frontier quest; the arrow deliberately does not.
async function takeNextQuest(page) {
    if ((await dialogState(page, 'perfect-score-modal')).open === true) {
            await clickPulsing(page, '#close-perfect-score-btn');
    }
    const offer = page.locator('#next-quest-btn');
    if (await offer.isVisible()) {
            await clickPulsing(page, '#next-quest-btn');
        return true;
    }
    await page.click('#close-result-btn');
    return false;
}

async function currentPackState(page) {
    return page.evaluate(() => ({
        packId: localStorage.getItem('rego_pack_id'),
        state: localStorage.getItem('rego_pack_state_qaone'),
        corrupt: localStorage.getItem('rego_pack_state_qaone_corrupt'),
        tutorial: localStorage.getItem('rego_tutorial_completed')
    }));
}

// ----------------------------------------------------------------------------
// suite
// ----------------------------------------------------------------------------

async function emptyPackDirectory(browser, report, binary) {
    console.log('\nempty quests directory');
    const packsOnDisk = fs.readdirSync(path.join(repoRoot, 'frontend', 'quests'))
        .filter((entry) => entry !== '.gitkeep');
    report.expect(`the quests directory starts empty (found: ${packsOnDisk.join(', ') || 'nothing'})`, packsOnDisk.length === 0);
    // INFO level, because the line under test is an INFO line about the drain.
    const server = new Server({ cwd: repoRoot, port: PORT, binary, env: { LOG_LEVEL: 'info' } });
    await server.start();

    const api = await server.packs();
    report.check('GET /api/packs answers an empty JSON array', api.body === '[]', `body was ${api.body}`);
    report.check('the server says the quests directory is empty', /no quest packs loaded/i.test(server.log), server.log.trim().split('\n').slice(-1)[0]);

    {
        const harness = await newPage(browser, PORT);
        await openStartScreen(harness);
        const notice = await harness.page.locator('.pack-list-empty').textContent().catch(() => null);
        report.check(
            'the start screen states that no packs are loaded',
            Boolean(notice && /no adventure packs are loaded/i.test(notice)),
            `notice: ${notice}`
        );
        report.check('no pack cards are offered', await packCards(harness.page).count() === 0);
        await harness.context.close();
    }

    const stopped = await server.stop('SIGTERM');
    report.check(
        'a signalled run logs the drain it performed',
        /server stopped gracefully/i.test(stopped.log),
        stopped.log.trim().split('\n').slice(-2).join(' / ')
    );
}

async function playingThePack(browser, report, binary) {
    console.log('\nentering a pack, playing it, leaving it');
    const server = new Server({ cwd: repoRoot, port: PORT, binary });
    await server.start({ packs: PACKS });

    {
        const harness = await newPage(browser, PORT);
        const { page } = harness;

        await openStartScreen(harness);
        report.check('two packs are offered', await packCards(page).count() === PACKS.length, `cards: ${await packCards(page).count()}`);

        await enterPack(page, 'Quest Pack: qaone');

        // The offer is made a moment after the screen is up.
        await page.waitForSelector('.tutorial-prompt-modal', { timeout: 1500 }).catch(() => {});
        report.expect('the tour prompt appears over the prologue', await page.locator('.tutorial-prompt-modal').count() === 1);
        const promptOpen = await page.evaluate(() => {
            const prompt = document.querySelector('.tutorial-prompt-modal');
            return prompt ? { open: prompt.open, modal: prompt.tagName === 'DIALOG' } : null;
        });
        report.check('the tour prompt is a modal dialog', Boolean(promptOpen && promptOpen.open && promptOpen.modal), JSON.stringify(promptOpen));
        report.check('the tour was declined and remembered', await declineTour(page));
        report.check('the choice is stored', (await currentPackState(page)).tutorial === 'true');

        const inFooter = await page.evaluate(() => {
            const button = document.getElementById('start-adventure');
            return Boolean(button && button.closest('.quest-footer') && !button.classList.contains('hidden'));
        });
        report.check('the Begin Adventure button sits in the quest footer', inFooter);

        // The prologue has no grimoire to write, so the indicator says so.
        report.check(
            'the save indicator says there is nothing to save on the prologue',
            /idle/.test(await indicatorClass(page)) && /No policy to save/.test(await indicatorLabel(page)),
            `${await indicatorClass(page)} / ${await indicatorLabel(page)}`
        );

        await page.click('#start-adventure');
        await page.waitForSelector('#editor-pane');
        report.check('beginning the adventure shows the editor pane', await page.isVisible('#rego-editor'));
        report.check('the counter shows the first quest', /Quest 1\/3/.test(await page.textContent('#quest-counter')));

        // --- save indicator ---------------------------------------------------
        report.check('the save indicator starts idle', /idle/.test(await indicatorClass(page)), await indicatorClass(page));
        const method = await setSolution(page, SOLUTIONS[1]);
        report.check(`the editor accepts a policy (${method})`, (await editorText(page) || '').includes('input.password'), await editorText(page));
        report.check('typing marks the grimoire dirty', /dirty/.test(await indicatorClass(page)), await indicatorClass(page));
        // The autosave debounce is 1500 ms itself, so nothing can land
        // sooner; a wait the length of the debounce races it.
        await page.waitForFunction(() => document.getElementById('editor-save-indicator').className.includes('saved'), null, { timeout: 2600 })
            .catch(() => {});
        report.check('the autosave settles to saved', /saved/.test(await indicatorClass(page)), await indicatorClass(page));

        // A write that storage refuses: the indicator tells the player the write
        // failed, which is what the tour promises in red. The instance is spied
        // on because happy-dom routes localStorage through it; the override is
        // removed again so the rest of the run sees a working storage.
        await page.evaluate(() => {
            window.__setItem = localStorage.setItem;
            localStorage.setItem = () => {
                const error = new Error('quota');
                error.name = 'QuotaExceededError';
                throw error;
            };
        });
        await page.locator('#rego-editor textarea').first().click();
        await page.keyboard.press('End');
        await page.keyboard.type(' ');
        await page.waitForFunction(() => document.getElementById('editor-save-indicator').className.includes('error'), null, { timeout: 2600 })
            .catch(() => {});
        const failedWrite = await page.evaluate(() => {
            const badge = document.getElementById('editor-save-indicator');
            return { cls: badge.className, label: badge.getAttribute('aria-label') || '' };
        });
        report.check(
            'a refused write turns the indicator red and says so',
            /error/.test(failedWrite.cls) && /failed/i.test(failedWrite.label),
            JSON.stringify(failedWrite)
        );
        await page.evaluate(() => {
            localStorage.setItem = window.__setItem;
            delete window.__setItem;
        });
        await page.locator('#rego-editor textarea').first().click();
        await page.keyboard.press('End');
        await page.keyboard.type('  ');
        await page.waitForFunction(() => document.getElementById('editor-save-indicator').className.includes('saved'), null, { timeout: 2600 })
            .catch(() => {});
        report.check('storage working again settles the indicator back to saved', /saved/.test(await indicatorClass(page)), await indicatorClass(page));

        // --- dialogs ----------------------------------------------------------
        for (const [id, opener, closer] of [
            ['manual-modal', '#check-manual-btn', '#close-manual-btn'],
            ['test-payload-modal', '#check-test-payload-btn', '#close-test-payload-btn'],
            ['hint-modal', '#hint-btn', '#cancel-hint-btn']
        ]) {
            await page.click(opener);
            // The test payload dialog opens once its fetch has answered.
            await page.waitForSelector(`#${id}[open]`, { timeout: 1500 }).catch(() => {});
            const opened = await dialogState(page, id);
            report.check(`${id} opens modally`, opened.open === true, JSON.stringify(opened));
            await page.click(closer);
            const closed = await dialogState(page, id);
            report.check(`${id} closes from its own control`, closed.open === false, JSON.stringify(closed));
        }

        await page.click('#restart-btn');
        report.check('the restart dialog opens modally', (await dialogState(page, 'restart-modal')).open === true);
        await page.keyboard.press('Escape');
        report.check(
            'Escape leaves the restart dialog open: it confirms by button only',
            (await dialogState(page, 'restart-modal')).open === true
        );
        report.check('the quest counter still reads 1/3 with the restart dialog up', /Quest 1\/3/.test(await page.textContent('#quest-counter')));
        await page.click('#cancel-restart-btn');
        report.check('the cancel button closes the restart dialog', (await dialogState(page, 'restart-modal')).open === false);

        // --- verify, advance, hints ------------------------------------------
        await verifyQuest(page, SOLUTIONS[1]);
        const result = await dialogState(page, 'result-modal');
        report.check('verifying a policy reports the result in a modal', result.open === true, JSON.stringify(result));
        report.check('the result lists per-test outcomes', await page.locator('#result-test-list li').count() >= 1);
        const earned = Number(await page.textContent('#points-earned').catch(() => '0'));
        report.check(
            'the score summary counts points',
            earned > 0,
            `points: ${earned}; result: ${result.text}; editor: ${await editorText(page)}`
        );
        report.check('the result dialog offers the next quest', await page.locator('#next-quest-btn').isVisible());
        report.check(
            'the forward arrow stays disabled: only a scored next quest opens it',
            await page.locator('#quest-forward-btn').isDisabled()
        );
        if ((await dialogState(page, 'perfect-score-modal')).open === true) {
            await clickPulsing(page, '#close-perfect-score-btn');
            report.check('a perfect run is celebrated in its own modal', true);
        }
        await clickPulsing(page, '#next-quest-btn');
        await page.waitForFunction(() => /Quest 2\/3/.test(document.getElementById('quest-counter').textContent), null, { timeout: 2000 });
        report.check('the result dialog\'s offer moves the cursor to the next quest', /Quest 2\/3/.test(await page.textContent('#quest-counter')));

        await page.click('#quest-back-btn');
        await page.waitForFunction(() => /Quest 1\/3/.test(document.getElementById('quest-counter').textContent), null, { timeout: 2000 });
        report.check('the back arrow walks the cursor back', /Quest 1\/3/.test(await page.textContent('#quest-counter')));
        report.check(
            'history view below the frontier allows the forward arrow',
            await page.locator('#quest-forward-btn').isEnabled()
        );
        await page.click('#quest-forward-btn');
        await page.waitForFunction(() => /Quest 2\/3/.test(document.getElementById('quest-counter').textContent), null, { timeout: 2000 });
        report.check('the forward arrow returns to the frontier', /Quest 2\/3/.test(await page.textContent('#quest-counter')));

        await page.click('#hint-btn');
        await page.click('#confirm-hint-btn');
        await page.waitForSelector('#hints-list li', { timeout: 2000 }).catch(() => {});
        report.check('confirming a hint reveal shows the hint', await page.locator('#hints-list li').count() >= 1);

        const persisted = await currentPackState(page);
        report.check('the pack pointer and pack state are stored', persisted.packId === 'qaone' && Boolean(persisted.state), JSON.stringify({ packId: persisted.packId, state: persisted.state ? 'set' : 'missing' }));

        // --- minimize across leaving, pack change, restart -------------------
        await page.click('#minimize-btn');
        report.check('minimize marks the interface and the button', (await page.getAttribute('#game-interface', 'class')).includes('minimized') && (await page.getAttribute('#minimize-btn', 'aria-label')) === 'Restore interface');

        await page.click('#home-btn');
        await page.waitForSelector('#start-screen:not(.hidden)');
        await enterPack(page, 'Quest Pack: qatwo');
        const restored = await page.evaluate(() => ({
            minimized: document.getElementById('game-interface').classList.contains('minimized'),
            label: document.getElementById('minimize-btn').getAttribute('aria-label')
        }));
        report.check('changing pack returns the interface to normal', restored.minimized === false && restored.label === 'Minimize interface', JSON.stringify(restored));

        await page.click('#minimize-btn');
        await page.click('#restart-btn');
        const confirm = await dialogState(page, 'restart-modal');
        report.check('the restart dialog is offered over the second pack', confirm.open === true);
        await page.click('#confirm-restart-btn');
        await page.waitForFunction(() => /Quest 1\//.test(document.getElementById('quest-counter').textContent), null, { timeout: 2000 }).catch(() => {});
        const afterRestart = await page.evaluate(() => ({
            counter: document.getElementById('quest-counter').textContent.trim(),
            minimized: document.getElementById('game-interface').classList.contains('minimized'),
            label: document.getElementById('minimize-btn').getAttribute('aria-label'),
            hidden: document.getElementById('game-interface').classList.contains('hidden'),
            startVisible: !document.getElementById('start-screen').classList.contains('hidden'),
            dialogs: Array.from(document.querySelectorAll('dialog')).filter((d) => d.open).map((d) => d.id)
        }));
        report.check('restarting progress returns the interface to normal', afterRestart.minimized === false && afterRestart.label === 'Minimize interface', JSON.stringify(afterRestart));

        // --- a click on another pack while one is loading --------------------
        await page.click('#home-btn');
        await page.waitForSelector('#start-screen:not(.hidden)');
        await page.route('**/api/packs/qaone*', (route) => setTimeout(() => route.continue(), 700));
        await page.locator('#quest-pack-list .quest-pack-card:has-text("Quest Pack: qaone")').first().click();
        await page.locator('#quest-pack-list .quest-pack-card:has-text("Quest Pack: qatwo")').first().click();
        const toast = await toastText(page);
        report.check('clicking another pack card while an adventure loads says so', Boolean(toast && /already|waiting|loading/i.test(toast)), `toast: ${toast}`);
        await page.waitForSelector('#game-interface:not(.hidden)', { timeout: 3000 });
        report.check('the first pack still wins the race', (await currentPackState(page)).packId === 'qaone', JSON.stringify(await currentPackState(page)));
        await page.unroute('**/api/packs/qaone*');
        await declineTour(page);

        // --- finish the run: epilogue ---------------------------------------
        for (const quest of [2, 3]) {
            const counter = await page.textContent('#quest-counter');
            if (!counter.includes(`Quest ${quest}/`)) {
                report.check(`the run reached quest ${quest}`, false, `counter showed ${counter}`);
                break;
            }
            await verifyQuest(page, SOLUTIONS[quest]);
            await takeNextQuest(page);
            await page.waitForFunction((q) => {
                const label = document.getElementById('quest-counter').textContent.trim();
                return label === 'Epilogue' || label.includes(`Quest ${q}/`);
            }, quest + 1, { timeout: 2000 }).catch(() => {});
        }

        await page.waitForFunction(() => document.getElementById('quest-counter').textContent.trim() === 'Epilogue', null, { timeout: 2000 }).catch(() => {});
        report.check('finishing the last quest shows the epilogue', (await page.textContent('#quest-counter')).trim() === 'Epilogue', await page.textContent('#quest-counter'));
        report.check('the epilogue carries its own heading', (await page.textContent('#quest-title')).includes('Adventure Complete'), await page.textContent('#quest-title'));
        // A hint was paid for earlier in this run, so the celebration is not on
        // offer: only a run that spent nothing on hints is celebrated.
        const celebration = await page.evaluate(() => {
            const button = document.getElementById('perfect-score-btn');
            return { offered: Boolean(button) && !button.classList.contains('hidden') };
        });
        report.check(
            'a run that paid for a hint is not celebrated as perfect',
            celebration.offered === false,
            JSON.stringify(celebration)
        );
        // The epilogue has no grimoire either.
        report.check(
            'the save indicator says there is nothing to save on the epilogue',
            /idle/.test(await indicatorClass(page)) && /No policy to save/.test(await indicatorLabel(page)),
            `${await indicatorClass(page)} / ${await indicatorLabel(page)}`
        );
        const xp = (await page.textContent('#experience-points')).trim();
        const xpMatch = xp.match(/(\d+)/);
        report.check('the run earned experience points', Boolean(xpMatch) && Number(xpMatch[1]) > 0, xp);

        // --- resume and corrupt state ---------------------------------------
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForSelector('#game-interface:not(.hidden)', { timeout: 3000 });
        await declineTour(page);
        report.check('a reload resumes the epilogue', (await page.textContent('#quest-counter')).trim() === 'Epilogue', await page.textContent('#quest-counter'));

        await page.evaluate(() => localStorage.setItem('rego_pack_state_qaone', '{ not json'));
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForSelector('#game-interface:not(.hidden)', { timeout: 3000 });
        const corrupt = await currentPackState(page);
        report.check('a corrupt pack state is copied aside', Boolean(corrupt.corrupt && corrupt.corrupt.includes('not json')), JSON.stringify(corrupt.corrupt));
        report.check('the corrupt copy is not read back on the next load', corrupt.state !== '{ not json', JSON.stringify(corrupt.state));
        const resumed = (await page.textContent('#quest-counter')).trim();
        // An unread state leaves the cursor where a fresh entry leaves it: the
        // prologue, before the first quest is opened.
        report.check('a corrupt pack state starts the adventure at its beginning', resumed === 'Prologue', resumed);
        const corruptToast = await toastText(page);
        report.check('the corrupt state is announced', Boolean(corruptToast && /corrupt|could not|damaged/i.test(corruptToast)), `toast: ${corruptToast}`);

        // The quota simulation above makes the app log a refused write; that is
        // the behaviour under test, not a fault of the run.
        const errors = harness.consoleErrors.filter((line) => !/favicon|net::ERR_|Failed to load resource|localStorage write failed|QuotaExceededError/i.test(line));
        report.check('no page errors during the run', errors.length === 0, errors.slice(0, 4).join(' ;; '));
        await harness.context.close();

        await theTour(browser, report, PORT, page.url());
    }

    await server.stop('SIGTERM');
}

// The pulsing call-to-action buttons are decoration, so a reduced-motion
// preference stops them. Both halves matter: the pulse is there when motion is
// welcome, and gone when it is not.
async function decorativeMotion(browser, report, binary) {
    console.log('\nreduced motion');
    const server = new Server({ cwd: repoRoot, port: PORT, binary });
    await server.start({ packs: [] });

    const harness = await newPage(browser, PORT);
    const { page } = harness;
    const SELECTORS = ['#next-quest-btn', '#perfect-score-btn'];

    const animationNames = async () => {
        const reading = await page.evaluate((selectors) => selectors.map((selector) => {
            const element = document.querySelector(selector);
            return `${selector}=${element ? getComputedStyle(element).animationName : 'missing'}`;
        }).join(' '), SELECTORS);
        const names = {};
        for (const entry of reading.split(' ')) {
            const at = entry.indexOf('=');
            names[entry.slice(0, at)] = entry.slice(at + 1);
        }
        return names;
    };

    await openStartScreen(harness);

    const pulsing = await animationNames();
    report.check(
        'the call-to-action buttons pulse while motion is welcome',
        Object.values(pulsing).every((name) => name === 'pulse'),
        JSON.stringify(pulsing)
    );

    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.reload({ waitUntil: 'domcontentloaded' });
    const calmed = await animationNames();
    report.check(
        'a reduced-motion preference stops the pulse',
        Object.values(calmed).every((name) => name === 'none'),
        JSON.stringify(calmed)
    );

    await harness.context.close();
    await server.stop('SIGTERM');
}

async function main() {
    // What the tree already looked like before this suite touched anything: the
    // run is judged on what it adds, not on what the developer had going.
    const baseline = gitStatus(repoRoot);

    if (!PORT) {
        PORT = await pickFreePort();
    }
    console.log(`port ${PORT}`);
    const report = new Report('adventure SPA browser QA');
    // A browser suite that stops making progress must not sit there: the wall
    // clock ends it and names the phase that was running.
    let phase = 'startup';
    const watchdog = setTimeout(() => {
        console.error(`\nadventure SPA QA exceeded 45s during "${phase}"`);
        stopServersSync();
        process.exit(2);
    }, 45000);
    const quit = (code) => {
        stopServersSync();
        for (const pack of PACKS) {
            removePack(repoRoot, pack);
        }
        process.exit(code);
    };
    process.on('SIGINT', () => quit(130));
    process.on('SIGTERM', () => quit(130));
    const binary = buildServer(repoRoot);

    for (const pack of PACKS) {
        removePack(repoRoot, pack);
    }
    try {
        await withBrowser(async (browser) => {
            phase = 'empty quests directory';
            await emptyPackDirectory(browser, report, binary);
            phase = 'entering a pack, playing it, leaving it';
            await playingThePack(browser, report, binary);
            phase = 'reduced motion';
            await decorativeMotion(browser, report, binary);
        });
    } catch (error) {
        if (!error.reported) {
            console.error(`\nadventure SPA QA stopped: ${error.message}`);
            if (error.stack) {
                console.error(error.stack.split('\n').slice(1, 4).join('\n'));
            }
            report.check('the suite ran to the end', false, error.message);
        }
    } finally {
        stopServersSync();
        for (const pack of PACKS) {
            removePack(repoRoot, pack);
        }
        fs.rmSync(require('node:path').join(require('node:os').tmpdir(), 'rego-qa'), { recursive: true, force: true });
    }

    clearTimeout(watchdog);
    const clean = report.done();
    const left = leftoverChanges(repoRoot, baseline);
    if (left.length > 0) {
        console.log(`\nleft behind by the run:\n${left.join('\n')}`);
    }
    process.exit(clean && left.length === 0 ? 0 : 1);
}

main();
