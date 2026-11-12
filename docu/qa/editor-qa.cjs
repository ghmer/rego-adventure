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

// Browser QA for the quest editor (docu/quest-editor).
//
// The editor is a static page, so this suite drives it from file:// with no
// server. It covers what only a click can cover: quest IDs following position
// when a quest is added, deleted or loaded from a hand-edited file; the export
// refusal for a pack the backend would reject; the test-ID policy; and the
// length budget the form fields carry.
//
// Run: node docu/qa/editor-qa.cjs

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
    repoRoot,
    gitStatus,
    leftoverChanges,
    withBrowser,
    newPage,
    Report
} = require('./qa-lib.cjs');

const EDITOR_URL = `file://${path.join(repoRoot, 'docu', 'quest-editor', 'index.html')}`;
const FIXTURE = path.join(repoRoot, 'docu', 'qa', 'testdata', 'qa-editor-pack.json');
const LOOSE_IDS = path.join(repoRoot, 'docu', 'qa', 'testdata', 'qa-editor-ids-loose.json');

// The fixture's content, restated here so each check says what it expects about
// the pack rather than comparing two files.
const TITLES = ['First Steps', 'Inventory Check', 'Data Lookup'];
const TEST_IDS = [[101, 102], [201, 202], [301, 302]];

// Quest fields live in a per-quest view; only one is active at a time. The
// untouched template sits in the same container, hidden, so every quest-field
// lookup is scoped to the active view.
function quest(page) {
    return page.locator('.quest-view.active');
}

async function loadPack(page, file) {
    await page.setInputFiles('#fileInput', file);
    await page.waitForSelector('#editorLayout:not(.hidden)', { timeout: 2000 });
}

async function navLabels(page) {
    return page.$$eval('#questNav .nav-item .nav-label', (labels) => labels.map((label) => label.textContent.trim()));
}

async function openQuest(page, index) {
    await page.locator('#questNav .nav-item').nth(index).click();
    await page.waitForSelector('.quest-view.active input[data-field="quest-title"]', { timeout: 1500 });
}

async function openTab(page, tab) {
    await quest(page).locator(`.tab-btn[data-tab="${tab}"]`).click();
}

function field(page, name) {
    return quest(page).locator(`[data-field="${name}"]`);
}

async function questIdValue(page) {
    return field(page, 'quest-id').inputValue();
}

async function titleValue(page) {
    return field(page, 'quest-title').inputValue();
}

async function testCount(page) {
    return quest(page).locator('[data-field="testsList"] .test-item').count();
}

async function modalState(page) {
    return page.evaluate(() => {
        const modal = document.getElementById('modal');
        const error = document.getElementById('modalError');
        return {
            open: modal.classList.contains('active'),
            testId: document.getElementById('modal-test-id').value,
            errorShown: !error.classList.contains('hidden'),
            errorText: error.textContent.trim()
        };
    });
}

// typeInto writes a field the way a person does: the value, then the events an
// input produces.
async function typeInto(page, selector, value) {
    await page.evaluate(({ sel, val }) => {
        const el = document.querySelector(sel);
        el.value = val;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
    }, { sel: selector, val: value });
}

async function main() {
    // Judged on what the run adds to the tree, not on what was already there.
    const baseline = gitStatus(repoRoot);

    const report = new Report('quest editor browser QA');
    const downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rego-editor-qa-'));

    let phase = 'startup';
    const watchdog = setTimeout(() => {
        console.error(`\nquest editor QA exceeded 30s during "${phase}"`);
        process.exit(2);
    }, 30000);
    const quit = (code) => {
        fs.rmSync(downloadDir, { recursive: true, force: true });
        process.exit(code);
    };
    process.on('SIGINT', () => quit(130));
    process.on('SIGTERM', () => quit(130));

    try {
        await withBrowser(async (browser) => {
            phase = 'the editor page';
            const harness = await newPage(browser, 0);
            const { page, context } = harness;
            // Deleting a quest asks for confirmation through a native confirm().
            page.on('dialog', (dialog) => dialog.accept());

            await page.goto(EDITOR_URL, { waitUntil: 'domcontentloaded' });
            const startState = await page.evaluate(() => ({
                indicator: document.getElementById('fileIndicator').textContent.trim(),
                emptyShown: !document.getElementById('emptyState').classList.contains('hidden'),
                layoutShown: !document.getElementById('editorLayout').classList.contains('hidden'),
                saveEnabled: !document.getElementById('saveBtn').disabled
            }));
            report.check(
                'the editor opens with nothing loaded and nothing to save',
                startState.indicator === 'No file loaded' && startState.emptyShown &&
                !startState.layoutShown && !startState.saveEnabled,
                JSON.stringify(startState)
            );

            phase = 'loading a pack';
            await loadPack(page, FIXTURE);
            const loaded = await page.evaluate(() => ({
                indicator: document.getElementById('fileIndicator').textContent.trim(),
                count: document.getElementById('questCount').textContent.trim(),
                saveEnabled: !document.getElementById('saveBtn').disabled
            }));
            report.check(
                'loading a pack opens the editor and enables Save',
                loaded.saveEnabled && loaded.count === '3 quests' && /loaded/.test(loaded.indicator),
                JSON.stringify(loaded)
            );
            const labels = await navLabels(page);
            report.check(
                'the sidebar numbers the quests by their position in the file',
                labels.join(' | ') === `1: ${TITLES[0]} | 2: ${TITLES[1]} | 3: ${TITLES[2]}`,
                labels.join(' | ')
            );

            phase = 'quest identity';
            await openQuest(page, 1);
            const idField = field(page, 'quest-id');
            report.check('the quest ID field shows the quest position', (await idField.inputValue()) === '2', await idField.inputValue());
            report.check('the quest ID field is read-only', await idField.evaluate((el) => el.readOnly === true));
            report.check(
                'the read-only ID field says where the ID comes from',
                (await quest(page).locator('.field-hint').count()) > 0,
                await quest(page).locator('.field-hint').allTextContents().then((texts) => texts.join(' | '))
            );

            phase = 'a hand-edited file with loose IDs';
            await loadPack(page, LOOSE_IDS);
            const relabelled = await navLabels(page);
            report.check(
                'a pack whose IDs do not match their positions is renumbered on load',
                relabelled.join(' | ') === `1: ${TITLES[0]} | 2: ${TITLES[1]} | 3: ${TITLES[2]}`,
                relabelled.join(' | ')
            );

            phase = 'deleting the middle quest';
            await openQuest(page, 1);
            await field(page, 'deleteQuestBtn').click();
            await page.waitForFunction(() => document.querySelectorAll('#questNav .nav-item').length === 2, null, { timeout: 1500 }).catch(() => {});
            const afterDelete = await navLabels(page);
            report.check(
                'deleting the middle quest leaves the others numbered from one',
                afterDelete.join(' | ') === `1: ${TITLES[0]} | 2: ${TITLES[2]}`,
                afterDelete.join(' | ')
            );
            report.check('the count follows the sidebar', (await page.textContent('#questCount')).trim() === '2 quests', await page.textContent('#questCount'));

            // A quest view is addressed by position, so a delete must not leave a
            // stale view showing the wrong quest.
            await openQuest(page, 1);
            report.check(
                'the second quest view shows the quest that moved into that position',
                (await titleValue(page)) === TITLES[2],
                await titleValue(page)
            );
            report.check('the quest that moved carries the new number', (await questIdValue(page)) === '2', await questIdValue(page));

            phase = 'adding a quest';
            await page.click('#addQuestBtn');
            await page.waitForSelector('#view-quest-2.active', { timeout: 1500 }).catch(() => {});
            const afterAdd = await navLabels(page);
            report.check('a new quest is appended and numbered by its position', afterAdd.join(' | ') === `1: ${TITLES[0]} | 2: ${TITLES[2]} | 3: New Quest`, afterAdd.join(' | '));
            report.check('the new quest starts empty', (await titleValue(page)) === 'New Quest' && (await questIdValue(page)) === '3', `${await titleValue(page)} / ${await questIdValue(page)}`);

            phase = 'export refusal';
            const refused = page.waitForEvent('download', { timeout: 1200 }).catch(() => null);
            await page.click('#saveBtn');
            report.check('a pack the backend would refuse is not exported', (await refused) === null);
            const validation = await page.evaluate(() => ({
                shown: !document.getElementById('validationReport').classList.contains('hidden'),
                title: document.getElementById('validationReportTitle').textContent.trim(),
                problems: Array.from(document.querySelectorAll('#validationReportList li')).map((li) => li.textContent.trim())
            }));
            report.check(
                'the refusal says what is wrong with the pack',
                validation.shown && validation.problems.length > 0,
                JSON.stringify(validation)
            );
            await page.click('#validationReportClose');
            report.check('the validation report can be dismissed', await page.evaluate(() => document.getElementById('validationReport').classList.contains('hidden')));

            phase = 'exporting a sound pack';
            await openQuest(page, 2);
            await field(page, 'deleteQuestBtn').click();
            await page.waitForFunction(() => document.querySelectorAll('#questNav .nav-item').length === 2, null, { timeout: 1500 }).catch(() => {});
            const downloaded = page.waitForEvent('download', { timeout: 2000 }).catch(() => null);
            await page.click('#saveBtn');
            const download = await downloaded;
            report.check('a sound pack is exported when Save is pressed', download !== null);
            if (download) {
                const exportedPath = path.join(downloadDir, 'quests.json');
                await download.saveAs(exportedPath);
                const exported = JSON.parse(fs.readFileSync(exportedPath, 'utf8'));
                report.check(
                    'the exported quests are numbered from one with no gap',
                    JSON.stringify(exported.quests.map((quest) => quest.id)) === '[1,2]',
                    JSON.stringify(exported.quests.map((quest) => quest.id))
                );
                report.check(
                    'the export keeps the surviving quests in order',
                    exported.quests.map((quest) => quest.title).join('|') === `${TITLES[0]}|${TITLES[2]}`,
                    exported.quests.map((quest) => quest.title).join('|')
                );
            }

            phase = 'test case identity';
            await openQuest(page, 0);
            await openTab(page, 'tests');
            report.check('the opened quest lists its test cases', (await testCount(page)) === TEST_IDS[0].length, String(await testCount(page)));

            await field(page, 'addTestBtn').click();
            const offered = await modalState(page);
            report.check(
                'the test modal offers an ID this quest does not use',
                offered.open && /^\d+$/.test(offered.testId) && !TEST_IDS[0].includes(Number(offered.testId)),
                JSON.stringify(offered)
            );

            await typeInto(page, '#modal-test-id', '');
            await page.click('#modalSave');
            const blank = await modalState(page);
            report.check(
                'a blank test ID is refused and the modal stays open',
                blank.open && blank.errorShown && blank.errorText.length > 0,
                JSON.stringify(blank)
            );
            report.check('the refused test is not added', (await testCount(page)) === TEST_IDS[0].length, String(await testCount(page)));

            await typeInto(page, '#modal-test-id', String(TEST_IDS[0][0]));
            await page.click('#modalSave');
            const clash = await modalState(page);
            report.check(
                `a test ID this quest already uses is refused (${TEST_IDS[0][0]})`,
                clash.open && clash.errorShown && /already has a test case/i.test(clash.errorText),
                JSON.stringify(clash)
            );

            await typeInto(page, '#modal-test-id', '999');
            await typeInto(page, '#modal-test-expected', 'true');
            await page.click('#modalSave');
            report.check('a new test ID is accepted', (await modalState(page)).open === false, JSON.stringify(await modalState(page)));
            report.check('the accepted test appears in the list', (await testCount(page)) === TEST_IDS[0].length + 1, String(await testCount(page)));

            // The collision rule is about the other tests of the quest: re-saving
            // a test with its own ID must not be refused.
            await quest(page).locator('[data-field="testsList"] .test-item').first().locator('.btn-secondary').click();
            const reopened = await modalState(page);
            report.check(
                'reopening a test shows the ID it already has',
                reopened.open && reopened.testId === String(TEST_IDS[0][0]),
                JSON.stringify(reopened)
            );
            await page.click('#modalSave');
            report.check('saving a test against its own ID is not a collision', (await modalState(page)).open === false, JSON.stringify(await modalState(page)));

            phase = 'field budgets';
            const limits = await page.evaluate(() => ({
                packTitle: document.getElementById('meta-title').maxLength,
                packGenre: document.getElementById('meta-genre').maxLength,
                questTitle: document.querySelector('.quest-view.active [data-field="quest-title"]').maxLength,
                questHint: document.querySelector('.quest-view.active [data-field="addHintBtn"]') ? PACK_LIMITS.MaxQuestHint : 0,
                budget: { packTitle: PACK_LIMITS.MaxPackTitle, packGenre: PACK_LIMITS.MaxPackGenre, questTitle: PACK_LIMITS.MaxQuestTitle }
            }));
            report.check(
                'the form fields carry the length budget the backend enforces',
                limits.packTitle === limits.budget.packTitle &&
                limits.packGenre === limits.budget.packGenre &&
                limits.questTitle === limits.budget.questTitle,
                JSON.stringify(limits)
            );

            const errors = harness.consoleErrors.filter((line) => !/favicon|net::ERR_|Failed to load resource/i.test(line));
            report.check('no page errors during the run', errors.length === 0, errors.slice(0, 4).join(' ;; '));

            await context.close();
        });
    } catch (error) {
        report.check('the suite ran to the end', false, error.message.split('\n')[0]);
    }

    clearTimeout(watchdog);
    const clean = report.done();
    const left = leftoverChanges(repoRoot, baseline);
    if (left.length > 0) {
        console.log(`\nleft behind by the run:\n${left.join('\n')}`);
    }
    fs.rmSync(downloadDir, { recursive: true, force: true });
    process.exit(clean ? 0 : 1);
}

main().catch((error) => {
    console.error(error);
    process.exit(2);
});
