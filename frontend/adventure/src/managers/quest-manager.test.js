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

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QuestManager } from './quest-manager.js';
import { GameState } from '../services/state-service.js';
import { DEFAULT_TEXT, DEFAULT_REGO_CODE, SaveStatus } from '../services/constants.js';
import { getLocalStorage, getPackKey, STORAGE_KEYS } from '../services/storage-service.js';

const apiMock = vi.hoisted(() => ({
    fetchQuestHint: vi.fn(),
    fetchQuestSolution: vi.fn()
}));

vi.mock('../services/api-service.js', async (importOriginal) => {
    const actual = await importOriginal();
    return { ...actual, fetchQuestHint: apiMock.fetchQuestHint, fetchQuestSolution: apiMock.fetchQuestSolution };
});
vi.mock('../services/error-service.js', () => ({ handleApiError: vi.fn() }));

import { ApiError } from '../services/api-service.js';
import { handleApiError } from '../services/error-service.js';

const PACK_ID = 'testpack';

/**
 * Create a game state with pack data for the given quests loaded.
 * @param {Array<Object>} quests - Quest definitions
 * @returns {GameState} State with pack data loaded
 */
function createState(quests) {
    const state = new GameState();
    state.setCurrentPack(PACK_ID);
    state.loadPackData({
        quests,
        prologue: ['p'],
        epilogue: ['e'],
        meta: null,
        ui_labels: {}
    });
    return state;
}

/**
 * Create a UI double: real DOM elements for element-driven behavior,
 * vi.fn() mocks for the rendering methods.
 * @returns {Object} UI manager double
 */
function createUi() {
    return {
        elements: {
            hintsList: document.createElement('ul'),
            hintBtn: document.createElement('button'),
            questBackBtn: document.createElement('button'),
            questForwardBtn: document.createElement('button'),
            editor: document.createElement('textarea'),
            editorPane: document.createElement('section'),
            questTask: document.createElement('p'),
            questCounter: document.createElement('span'),
            questTitle: document.createElement('h2'),
            startAdventureBtn: document.createElement('button'),
            perfectScoreBtn: document.createElement('button')
        },
        renderQuest: vi.fn(),
        resetQuestUI: vi.fn(),
        renderPerfectScoreButton: vi.fn(),
        renderInteractionGate: vi.fn(),
        renderQuestFooter: vi.fn(),
        renderQuestButtonVisibility: vi.fn(),
        renderSaveStatus: vi.fn(),
        updateHintButtonText: vi.fn(),
        updateSupportModulesButton: vi.fn(),
        renderLore: vi.fn(),
        setEditorValue: vi.fn()
    };
}

/**
 * An autosave double: the quest screen only tells it to drop a pending write.
 * @returns {Object} Autosave double
 */
function createAutosave() {
    return { markDirty: vi.fn(), flush: vi.fn(), cancel: vi.fn() };
}

/**
 * Create a quest manager wired to fresh state and UI doubles.
 * @param {Array<Object>} quests - Quest definitions
 * @param {Object} [autosave] - Autosave collaborator double
 * @returns {Object} { state, ui, autosave, qm }
 */
function createFixture(quests, autosave = createAutosave()) {
    const state = createState(quests);
    const ui = createUi();
    return { state, ui, autosave, qm: new QuestManager(state, ui, autosave) };
}

describe('quest-manager', () => {
    beforeEach(() => {
        localStorage.clear();
        vi.clearAllMocks();
        apiMock.fetchQuestHint.mockImplementation(async (_packId, _questId, hintId) => ({ hint: `h${hintId}` }));
        apiMock.fetchQuestSolution.mockImplementation(async () => ({ solution: 'sol' }));
        // showHint/restoreQuestHints clone their items from these templates
        document.body.innerHTML = `
            <template id="hint-item-template"><li><code></code></li></template>
            <template id="hint-solution-template"><li><code></code></li></template>
        `;
    });

    describe('screen render', () => {
        it('recomputes the quest footer once per screen', () => {
            const fixture = createFixture([{ id: 1 }, { id: 2 }]);

            fixture.qm.loadQuest(0);
            expect(fixture.ui.renderQuestFooter).toHaveBeenCalledTimes(1);

            fixture.qm.loadQuest(1);
            expect(fixture.ui.renderQuestFooter).toHaveBeenCalledTimes(2);

            fixture.qm.loadQuest(3);
            expect(fixture.ui.renderQuestFooter).toHaveBeenCalledTimes(3);
        });

        it('renders the adventure offer into the footer the markup put it in', () => {
            const fixture = createFixture([{ id: 1 }, { id: 2 }]);
            const footer = document.createElement('div');
            footer.className = 'quest-footer';
            footer.appendChild(fixture.ui.elements.startAdventureBtn);
            document.body.appendChild(footer);

            fixture.qm.loadQuest(0);

            expect(fixture.ui.elements.startAdventureBtn.parentNode).toBe(footer);
            expect(fixture.ui.renderQuestButtonVisibility)
                .toHaveBeenCalledWith(true, expect.any(String));
        });

        it('withdraws the adventure offer when a quest screen replaces it', () => {
            const fixture = createFixture([{ id: 1 }, { id: 2 }]);

            fixture.qm.loadQuest(0);
            fixture.qm.loadQuest(1);

            expect(fixture.ui.renderQuestButtonVisibility).toHaveBeenLastCalledWith(false);
        });

        it('withdraws the adventure offer when the epilogue replaces it', () => {
            const fixture = createFixture([{ id: 1 }, { id: 2 }]);

            fixture.qm.loadQuest(0);
            fixture.qm.loadQuest(3);

            expect(fixture.ui.renderQuestButtonVisibility).toHaveBeenLastCalledWith(false);
        });

        it('withdraws the offer itself when no screen follows the prologue', () => {
            const fixture = createFixture([{ id: 1 }, { id: 2 }]);
            fixture.qm.loadQuest(0);
            vi.spyOn(fixture.qm, 'proceedToNextQuest').mockReturnValue(false);

            const advanced = fixture.qm.leavePrologue();

            expect(advanced).toBe(false);
            expect(fixture.ui.renderQuestButtonVisibility).toHaveBeenLastCalledWith(false);
            expect(fixture.ui.renderQuestFooter).toHaveBeenCalledTimes(2);
        });

        it('recomputes the footer through the screen when the prologue advances', () => {
            const fixture = createFixture([{ id: 1 }, { id: 2 }]);
            fixture.qm.loadQuest(0);

            const advanced = fixture.qm.leavePrologue();

            expect(advanced).toBe(true);
            expect(fixture.ui.renderQuestButtonVisibility).toHaveBeenLastCalledWith(false);
            expect(fixture.ui.renderQuestFooter).toHaveBeenCalledTimes(2);
        });
    });

    describe('loadQuestCode', () => {
        it('prefers saved code over the template', () => {
            const { state, ui, qm } = createFixture([{ id: 1, apply_template: true, template: 'package tpl' }]);
            state.saveGrimoire(1, 'package saved');
            state.currentQuest = { id: 1, apply_template: true, template: 'package tpl' };

            qm.loadQuestCode(1);

            expect(ui.setEditorValue).toHaveBeenCalledWith('package saved');
        });

        it('falls back to the quest template', () => {
            const { state, ui, qm } = createFixture([{ id: 1, apply_template: true, template: 'package tpl' }]);
            state.currentQuest = { id: 1, apply_template: true, template: 'package tpl' };

            qm.loadQuestCode(1);

            expect(ui.setEditorValue).toHaveBeenCalledWith('package tpl');
        });

        it('falls back to the default rego code without a template', () => {
            const { state, ui, qm } = createFixture([{ id: 1 }]);
            state.currentQuest = { id: 1 };

            qm.loadQuestCode(1);

            expect(ui.setEditorValue).toHaveBeenCalledWith(DEFAULT_REGO_CODE);
        });
    });

    describe('showHint', () => {
        it('reveals hints one at a time and persists the state', async () => {
            const { state, ui, qm } = createFixture([
                { id: 1, hints_count: 2, has_solution: true }
            ]);
            state.currentQuest = state.quests[0];
            qm.loadQuest(1);

            await qm.showHint();

            expect(apiMock.fetchQuestHint).toHaveBeenCalledWith(PACK_ID, 1, 1);
            expect(ui.elements.hintsList.children).toHaveLength(1);
            expect(ui.elements.hintsList.children[0].querySelector('code').textContent).toBe('h1');
            expect(state.currentQuestHintsUsed).toBe(1);
            expect(ui.updateHintButtonText).toHaveBeenCalledWith(state.currentQuest, 1, DEFAULT_TEXT.HINT_BUTTON);
            const packed = JSON.parse(getLocalStorage(getPackKey(STORAGE_KEYS.PACK_STATE, PACK_ID)));
            expect(packed.questHints[1]).toEqual({ hintsUsed: 1, solutionViewed: false });

            await qm.showHint();

            expect(apiMock.fetchQuestHint).toHaveBeenCalledWith(PACK_ID, 1, 2);
            expect(ui.elements.hintsList.children).toHaveLength(2);
            expect(ui.elements.hintsList.children[1].querySelector('code').textContent).toBe('h2');
        });

        it('caches hint texts and refetches nothing within a session', async () => {
            const { state, ui, qm } = createFixture([{ id: 1, hints_count: 2, has_solution: true }]);
            state.currentQuest = state.quests[0];
            qm.loadQuest(1);

            await qm.showHint(); // fetches h1
            expect(apiMock.fetchQuestHint).toHaveBeenCalledTimes(1);

            qm.loadQuest(1); // restore re-renders h1 from the cache
            ui.elements.hintsList.innerHTML = ''; // the real resetQuestUI clears the list
            await vi.waitFor(() => expect(ui.elements.hintsList.children).toHaveLength(1));

            await qm.showHint(); // fetches h2

            expect(apiMock.fetchQuestHint).toHaveBeenCalledTimes(2);
            expect(apiMock.fetchQuestHint).toHaveBeenNthCalledWith(1, PACK_ID, 1, 1);
            expect(apiMock.fetchQuestHint).toHaveBeenNthCalledWith(2, PACK_ID, 1, 2);
            expect(ui.elements.hintsList.children).toHaveLength(2);
            expect(ui.elements.hintsList.children[0].querySelector('code').textContent).toBe('h1');
        });

        it('reveals the solution after the last hint and hides the button', async () => {
            const { state, ui, qm } = createFixture([
                { id: 1, hints_count: 1, has_solution: true }
            ]);
            qm.loadQuest(1);

            await qm.showHint(); // hint
            await qm.showHint(); // solution

            expect(apiMock.fetchQuestSolution).toHaveBeenCalledWith(PACK_ID, 1);
            expect(state.currentQuestSolutionViewed).toBe(true);
            expect(ui.elements.hintsList.children[1].querySelector('code').textContent).toBe('sol');
            expect(ui.elements.hintBtn.classList.contains('hidden')).toBe(true);
            const packed = JSON.parse(getLocalStorage(getPackKey(STORAGE_KEYS.PACK_STATE, PACK_ID)));
            expect(packed.questHints[1]).toEqual({ hintsUsed: 1, solutionViewed: true });
        });

        it('is a no-op for quests without hints', async () => {
            const { state, ui, qm } = createFixture([{ id: 1 }]);
            state.currentQuest = state.quests[0];

            await qm.showHint();

            expect(ui.elements.hintsList.children).toHaveLength(0);
            expect(state.currentQuestHintsUsed).toBe(0);
            expect(apiMock.fetchQuestHint).not.toHaveBeenCalled();
            expect(apiMock.fetchQuestSolution).not.toHaveBeenCalled();
        });

        it('ignores a second reveal request while one is in flight', async () => {
            const { state, ui, qm } = createFixture([{ id: 1, hints_count: 2, has_solution: true }]);
            state.currentQuest = state.quests[0];
            qm.loadQuest(1);

            const first = qm.showHint();
            const second = qm.showHint();
            await Promise.all([first, second]);

            expect(apiMock.fetchQuestHint).toHaveBeenCalledTimes(1);
            expect(ui.elements.hintsList.children).toHaveLength(1);
        });

        it('reports fetch failures and records nothing', async () => {
            const { state, ui, qm } = createFixture([{ id: 1, hints_count: 2, has_solution: true }]);
            state.currentQuest = state.quests[0];
            qm.loadQuest(1);
            apiMock.fetchQuestHint.mockRejectedValueOnce(new ApiError('boom', 500));

            await qm.showHint();

            expect(handleApiError).toHaveBeenCalledWith(expect.any(ApiError), 'reveal hint');
            expect(ui.elements.hintsList.children).toHaveLength(0);
            expect(state.currentQuestHintsUsed).toBe(0);
            expect(state.currentQuestSolutionViewed).toBe(false);
        });

        it('hides the hint button after the solution was revealed', async () => {
            const { ui, qm } = createFixture([{ id: 1, hints_count: 1, has_solution: true }]);
            qm.loadQuest(1);
            await qm.showHint();
            await qm.showHint();

            // The button stays hidden; a further reveal attempt must not
            // unhide it
            await qm.showHint();
            expect(ui.elements.hintBtn.classList.contains('hidden')).toBe(true);
        });
    });

    describe('restoreQuestHints', () => {
        it('re-renders hints revealed in a previous session', async () => {
            const quests = [{ id: 1, hints_count: 2, has_solution: true }];

            // First session: reveal both hints
            const first = createFixture(quests);
            first.qm.loadQuest(1);
            await first.qm.showHint();
            await first.qm.showHint();

            // Second session: same persisted state, fresh UI and cache
            const ui = createUi();
            const qm = new QuestManager(first.state, ui, createAutosave());
            qm.loadQuest(1);
            await vi.waitFor(() => expect(ui.elements.hintsList.children).toHaveLength(2));

            expect(ui.elements.hintsList.children[0].querySelector('code').textContent).toBe('h1');
            expect(ui.elements.hintsList.children[1].querySelector('code').textContent).toBe('h2');
            expect(ui.elements.hintBtn.classList.contains('hidden')).toBe(false);
            expect(ui.updateHintButtonText).toHaveBeenCalledWith(
                first.state.currentQuest, 2, DEFAULT_TEXT.HINT_BUTTON
            );
        });

        it('hides the hint button when the solution was already revealed', async () => {
            const quests = [{ id: 1, hints_count: 1, has_solution: true }];

            const first = createFixture(quests);
            first.qm.loadQuest(1);
            await first.qm.showHint();
            await first.qm.showHint();

            const ui = createUi();
            const qm = new QuestManager(first.state, ui, createAutosave());
            qm.loadQuest(1);
            await vi.waitFor(() => expect(ui.elements.hintsList.children).toHaveLength(2));

            expect(ui.elements.hintBtn.classList.contains('hidden')).toBe(true);
            expect(first.state.currentQuestSolutionViewed).toBe(true);
        });

        it('does nothing for quests without saved hint state', () => {
            const { ui, qm } = createFixture([{ id: 1, hints_count: 1, has_solution: true }]);
            qm.loadQuest(1);

            expect(ui.elements.hintsList.children).toHaveLength(0);
            expect(ui.elements.hintBtn.classList.contains('hidden')).toBe(false);
        });

        it('restores hints for completed quests from the quest score', async () => {
            const { state, ui, qm } = createFixture([{ id: 1, hints_count: 1, has_solution: true }]);
            state.currentQuestHintsUsed = 1;
            state.completeQuest(1);
            state.currentQuestId = 2;

            qm.loadQuest(1);
            await vi.waitFor(() => expect(ui.elements.hintsList.children).toHaveLength(1));

            expect(ui.elements.hintsList.children[0].querySelector('code').textContent).toBe('h1');
            expect(state.currentQuestHintsUsed).toBe(1);
        });

        it('keeps the paid reveal accounting when the stored reveals cannot be fetched', async () => {
            const { state, ui, qm } = createFixture([{ id: 1, hints_count: 2, has_solution: false }]);
            state.enterQuest(1);
            state.currentQuest = state.quests[0];
            state.currentQuestHintsUsed = 1;
            state.persistQuestHintState();

            apiMock.fetchQuestHint.mockRejectedValueOnce(new ApiError('boom', 500));
            await qm.restoreQuestHints(1);

            // the texts did not arrive, but what the player paid for still counts
            expect(state.currentQuestHintsUsed).toBe(1);
            expect(ui.updateHintButtonText).toHaveBeenCalledWith(state.currentQuest, 1, expect.any(String));

            // the next reveal is the second hint, not a second charge for the first
            await qm.showHint();

            expect(apiMock.fetchQuestHint).toHaveBeenLastCalledWith(PACK_ID, 1, 2);
            expect(state.currentQuestHintsUsed).toBe(2);
        });

        it('restores the same reveal record the score was computed from, even when the refetch fails', async () => {
            const { state, qm } = createFixture([{ id: 1, hints_count: 2, has_solution: false }]);
            state.enterQuest(1);
            state.currentQuest = state.quests[0];
            state.currentQuestHintsUsed = 1;
            state.completeQuest(1);
            state.resetQuestState();

            apiMock.fetchQuestHint.mockRejectedValue(new ApiError('boom', 500));
            await qm.restoreQuestHints(1);

            // score and reveal counters keep describing the same run
            expect(state.questScores[1].hintsUsed).toBe(1);
            expect(state.currentQuestHintsUsed).toBe(1);
        });

        it('settles the reveal overlay back to idle and clears the pending restore', async () => {
            const { state, qm } = createFixture([{ id: 1, hints_count: 1, has_solution: false }]);
            state.enterQuest(1);
            state.currentQuest = state.quests[0];
            state.currentQuestHintsUsed = 1;
            state.persistQuestHintState();

            const pending = qm.restoreQuestHints(1);

            expect(qm.revealPhase).toBe('restoring');

            await pending;

            expect(qm.revealPhase).toBe('idle');
            expect(qm.revealPromise).toBeNull();
        });

        it('waits for a restore in flight instead of racing it', async () => {
            const { state, ui, qm } = createFixture([{ id: 1, hints_count: 2, has_solution: false }]);
            state.enterQuest(1);
            state.currentQuest = state.quests[0];
            state.currentQuestHintsUsed = 1;
            state.persistQuestHintState();

            let settle;
            apiMock.fetchQuestHint.mockImplementationOnce((_packId, _questId, hintId) => new Promise(resolve => {
                settle = () => resolve({ hint: `h${hintId}` });
            }));

            const restoring = qm.restoreQuestHints(1);
            const revealing = qm.showHint();

            settle();
            await Promise.all([restoring, revealing]);

            // one restore fetched hint 1; showHint waited for it and then asked
            // for the next reveal rather than refetching hint 1
            expect(apiMock.fetchQuestHint.mock.calls.map(call => call[2])).toEqual([1, 2]);
            expect(ui.elements.hintsList.children).toHaveLength(2);
            expect(state.currentQuestHintsUsed).toBe(2);
        });

        it('drops fetched hints when the user navigated away meanwhile', async () => {
            const { state, ui, qm } = createFixture([
                { id: 1, hints_count: 1, has_solution: false },
                { id: 2, hints_count: 0, has_solution: false }
            ]);
            state.currentQuestId = 1;
            state.currentQuestHintsUsed = 1;
            state.persistQuestHintState();

            let resolveFetch;
            apiMock.fetchQuestHint.mockImplementationOnce(
                () => new Promise(resolve => { resolveFetch = resolve; })
            );

            qm.loadQuest(1); // initiates the restore fetch for quest 1
            qm.loadQuest(2); // navigate away while the fetch is pending
            resolveFetch({ hint: 'h1' });
            await new Promise(resolve => setTimeout(resolve, 0));

            expect(ui.elements.hintsList.children).toHaveLength(0);
            expect(handleApiError).not.toHaveBeenCalled();
        });
    });

    describe('caches of the current pack visit', () => {
        it('drops the reveal texts it fetched', async () => {
            const { state, qm } = createFixture([{ id: 1, hints_count: 1, has_solution: false }]);
            state.currentQuest = state.quests[0];
            qm.loadQuest(1);
            await qm.showHint();

            expect(qm.revealCache.size).toBe(1);

            qm.clearCaches();

            expect(qm.revealCache.size).toBe(0);
            expect(qm.revealPhase).toBe('idle');
        });
    });

    describe('navigation guards', () => {
        it('does not navigate before the first quest', () => {
            const { state, ui, qm } = createFixture([{ id: 1 }]);
            qm.loadQuest(1);
            const callsBefore = ui.renderQuest.mock.calls.length;

            qm.navigateToPreviousQuest();

            expect(state.currentQuestId).toBe(1);
            expect(ui.renderQuest.mock.calls.length).toBe(callsBefore);
        });

        it('does not navigate forward beyond the last quest', () => {
            const { state, ui, qm } = createFixture([{ id: 1 }]);
            qm.loadQuest(1);
            const callsBefore = ui.renderQuest.mock.calls.length;

            qm.navigateToNextQuest();

            expect(state.currentQuestId).toBe(1);
            expect(ui.renderQuest.mock.calls.length).toBe(callsBefore);
        });

        it('navigates to completed quests (history)', () => {
            const { state, ui, qm } = createFixture([{ id: 1 }, { id: 2 }]);
            state.questScores[2] = { hintsUsed: 0, solutionViewed: false, pointsEarned: 10 };
            state.activeQuestId = 2;
            qm.loadQuest(1);
            const callsBefore = ui.renderQuest.mock.calls.length;

            qm.navigateToNextQuest();

            expect(state.currentQuestId).toBe(2);
            expect(ui.renderQuest.mock.calls.length).toBe(callsBefore + 1);
        });

        it('holds the arrow at the frontier instead of skipping an uncompleted quest', () => {
            const { state, ui, qm } = createFixture([{ id: 1 }, { id: 2 }, { id: 3 }]);
            state.questScores[1] = { hintsUsed: 0, solutionViewed: false, pointsEarned: 10 };
            state.activeQuestId = 2;
            qm.loadQuest(2);
            const callsBefore = ui.renderQuest.mock.calls.length;

            qm.navigateToNextQuest();

            // quest 3 is not completed and this is not history view, so the
            // single forward rule refuses the step the button would take
            expect(state.currentQuestId).toBe(2);
            expect(ui.renderQuest.mock.calls.length).toBe(callsBefore);
        });

        it('takes the same forward decision as the guard that enables the button', () => {
            const cases = [
                { completed: [], frontier: 1, cursor: 1 },
                { completed: [1], frontier: 2, cursor: 1 },
                { completed: [1], frontier: 2, cursor: 2 },
                { completed: [1, 2], frontier: 3, cursor: 1 },
                { completed: [1, 2], frontier: 3, cursor: 2 },
                { completed: [1, 2], frontier: 3, cursor: 3 },
                { completed: [1, 2, 3], frontier: 4, cursor: 3 },
                { completed: [1, 2, 3], frontier: 4, cursor: 4 }
            ];

            for (const testCase of cases) {
                const { state, qm } = createFixture([{ id: 1 }, { id: 2 }, { id: 3 }]);
                for (const id of testCase.completed) {
                    state.questScores[id] = { hintsUsed: 0, solutionViewed: false, pointsEarned: 10 };
                }
                state.activeQuestId = testCase.frontier;
                qm.loadQuest(testCase.cursor);

                const guardAllows = state.canNavigateForward();
                const cursorBefore = state.currentQuestId;
                qm.navigateToNextQuest();

                expect({
                    case: testCase,
                    moved: state.currentQuestId !== cursorBefore
                }).toEqual({ case: testCase, moved: guardAllows });
            }
        });

        it('keeps the unlocked frontier when the back arrow is followed by the flow action', () => {
            const { state, qm } = createFixture([{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }]);
            for (const id of [1, 2, 3]) {
                qm.loadQuest(id);
                state.completeQuest(id);
            }
            expect(state.activeQuestId).toBe(4);

            qm.navigateToPreviousQuest();
            qm.proceedToNextQuest();

            // the player stands on quest 3 with quest 4 still unlocked
            expect(state.currentQuestId).toBe(3);
            expect(state.activeQuestId).toBe(4);
        });
    });

    describe('narrative screens', () => {
        function createNarrativeFixture() {
            const quests = [{ id: 1 }, { id: 2 }, { id: 3 }];
            const fixture = createFixture(quests);
            for (const id of [1, 2, 3]) {
                fixture.state.questScores[id] = { hintsUsed: 0, solutionViewed: false, pointsEarned: 10 };
            }
            fixture.state.activeQuestId = 4;
            return fixture;
        }

        it('renders the epilogue without touching progression state', () => {
            const { state, qm } = createNarrativeFixture();
            state.enterQuest(4);

            qm.showEpilogue();

            expect(state.currentQuestId).toBe(4);
            expect(state.activeQuestId).toBe(4);
            expect(state.isHistoryMode).toBe(false);
        });

        it('takes the epilogue transition while loading it, and persists it', () => {
            const { state, ui, qm } = createNarrativeFixture();

            qm.loadQuest(4);

            expect(state.currentQuestId).toBe(4);
            expect(state.activeQuestId).toBe(4);
            expect(state.isHistoryMode).toBe(false);
            expect(ui.elements.questCounter.textContent).toBe('Epilogue');
            expect(JSON.parse(getLocalStorage(getPackKey(STORAGE_KEYS.PACK_STATE, PACK_ID))).questId).toBe(4);
        });

        it('resumes a saved epilogue cursor onto the epilogue', () => {
            const quests = [{ id: 1 }, { id: 2 }, { id: 3 }];

            // A page that finished the pack and stayed on the epilogue
            const finished = createFixture(quests);
            for (const id of [1, 2, 3]) {
                finished.state.questScores[id] = { hintsUsed: 0, solutionViewed: false, pointsEarned: 10 };
            }
            finished.state.visitEpilogue();

            // The next page load resumes from storage, then loads the pack
            const resumed = new GameState();
            resumed.setCurrentPack(PACK_ID);
            resumed.loadPackData({ quests, prologue: ['p'], epilogue: ['e'], meta: null, ui_labels: {} });
            const ui = createUi();
            const qm = new QuestManager(resumed, ui, createAutosave());

            expect(resumed.currentQuestId).toBe(4);

            qm.loadQuest(resumed.currentQuestId);

            expect(resumed.currentQuestId).toBe(4);
            expect(resumed.activeQuestId).toBe(4);
            expect(ui.elements.questCounter.textContent).toBe('Epilogue');
        });

        it('normalizes a cursor past the last quest onto the epilogue', () => {
            const { state, qm } = createNarrativeFixture();

            qm.loadQuest(99);

            expect(state.currentQuestId).toBe(4);
            expect(state.activeQuestId).toBe(4);
        });
    });

    describe('loadQuest', () => {
        it('renders the read-only gate for a completed quest behind the frontier', () => {
            const { state, ui, qm } = createFixture([{ id: 1 }]);
            state.questScores[1] = { hintsUsed: 0, solutionViewed: false, pointsEarned: 10 };
            state.activeQuestId = 2;
            state.saveGrimoire(1, 'package done');

            qm.loadQuest(1);

            expect(state.isHistoryMode).toBe(true);
            expect(ui.renderInteractionGate).toHaveBeenCalledWith({
                editorReadOnly: true, verifyEnabled: false, hintEnabled: false, editorVisible: true
            });
            expect(ui.setEditorValue).toHaveBeenCalledWith('package done');
        });

        it('renders the playable gate for the quest the player may act on', () => {
            const { state, ui, qm } = createFixture([{ id: 1 }]);

            qm.loadQuest(1);

            expect(state.isHistoryMode).toBe(false);
            expect(ui.renderInteractionGate).toHaveBeenCalledWith({
                editorReadOnly: false, verifyEnabled: true, hintEnabled: true, editorVisible: true
            });
        });

        it('applies the gate after the cursor moved, for prologue and epilogue alike', () => {
            const quests = [{ id: 1 }];
            const prologue = createFixture(quests);
            prologue.qm.loadQuest(0);
            expect(prologue.ui.renderInteractionGate).toHaveBeenLastCalledWith({
                editorReadOnly: true, verifyEnabled: false, hintEnabled: false, editorVisible: false
            });

            const epilogue = createFixture(quests);
            epilogue.state.questScores[1] = { hintsUsed: 0, solutionViewed: false, pointsEarned: 10 };
            epilogue.qm.loadQuest(2);
            expect(epilogue.ui.renderInteractionGate).toHaveBeenLastCalledWith({
                editorReadOnly: true, verifyEnabled: false, hintEnabled: false, editorVisible: false
            });
        });
    });

    describe('pending editor write', () => {
        it('drops a pending editor write when a new screen takes the editor', () => {
            const { qm, autosave } = createFixture([{ id: 1 }]);

            qm.loadQuest(1);

            expect(autosave.cancel).toHaveBeenCalledTimes(1);
        });

        it('drops a pending editor write on a narrative screen as well', () => {
            const { qm, autosave } = createFixture([{ id: 1 }]);

            qm.loadQuest(0);

            expect(autosave.cancel).toHaveBeenCalledTimes(1);
        });

        it('says a narrative screen has nothing to save, rather than reporting the last write', () => {
            const quests = [{ id: 1 }];

            const questScreen = createFixture(quests);
            questScreen.ui.renderSaveStatus(SaveStatus.SAVED);
            questScreen.qm.loadQuest(1);
            expect(questScreen.ui.renderSaveStatus).toHaveBeenLastCalledWith(SaveStatus.SAVED);

            const prologue = createFixture(quests);
            prologue.qm.loadQuest(0);
            expect(prologue.ui.renderSaveStatus).toHaveBeenLastCalledWith(SaveStatus.IDLE);

            const epilogue = createFixture(quests);
            epilogue.state.questScores[1] = { hintsUsed: 0, solutionViewed: false, pointsEarned: 10 };
            epilogue.qm.loadQuest(2);
            expect(epilogue.ui.renderSaveStatus).toHaveBeenLastCalledWith(SaveStatus.IDLE);
        });
    });

    describe('perfect score button', () => {
        /**
         * Record a run that finished the pack without paying for a reveal.
         * @param {Object} state - State with one quest loaded
         */
        function recordPerfectRun(state) {
            state.questScores[1] = { hintsUsed: 0, solutionViewed: false, pointsEarned: 10 };
            state.totalScore = 10;
        }

        it('appears on the epilogue of a pack finished without reveals', () => {
            const { state, ui, qm } = createFixture([{ id: 1 }]);
            recordPerfectRun(state);

            qm.loadQuest(2);

            expect(ui.renderPerfectScoreButton)
                .toHaveBeenLastCalledWith(true, DEFAULT_TEXT.PERFECT_SCORE_BUTTON);
        });

        it('stays hidden on an epilogue that is not a perfect score', () => {
            const { ui, qm } = createFixture([{ id: 1 }]);

            qm.loadQuest(2);

            expect(ui.renderPerfectScoreButton).toHaveBeenLastCalledWith(false);
        });

        it('is gone from the footer when the player walks back from the epilogue', () => {
            const { state, ui, qm } = createFixture([{ id: 1 }]);
            recordPerfectRun(state);
            qm.loadQuest(2);
            expect(ui.renderPerfectScoreButton.mock.calls.at(-1)[0]).toBe(true);

            qm.loadQuest(1);

            expect(ui.renderPerfectScoreButton).toHaveBeenLastCalledWith(false);
        });

        it('is gone from the footer on the prologue of the same pack', () => {
            const { state, ui, qm } = createFixture([{ id: 1 }]);
            recordPerfectRun(state);
            qm.loadQuest(2);

            qm.loadQuest(0);

            expect(ui.renderPerfectScoreButton).toHaveBeenLastCalledWith(false);
        });
    });
});
