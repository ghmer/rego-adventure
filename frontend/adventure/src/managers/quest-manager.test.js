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
import { DEFAULT_TEXT, DEFAULT_REGO_CODE } from '../services/constants.js';
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
            outcomeArea: document.createElement('section'),
            editorPane: document.createElement('section'),
            questTask: document.createElement('p'),
            startAdventureBtn: document.createElement('button')
        },
        renderQuest: vi.fn(),
        resetQuestUI: vi.fn(),
        updateQuestFooterVisibility: vi.fn(),
        updateHintButtonText: vi.fn(),
        renderLore: vi.fn(),
        setEditorReadOnly: vi.fn(),
        setEditorValue: vi.fn()
    };
}

/**
 * Create a quest manager wired to fresh state and UI doubles.
 * @param {Array<Object>} quests - Quest definitions
 * @returns {Object} { state, ui, qm }
 */
function createFixture(quests) {
    const state = createState(quests);
    const ui = createUi();
    return { state, ui, qm: new QuestManager(state, ui) };
}

describe('quest-manager', () => {
    beforeEach(() => {
        localStorage.clear();
        vi.clearAllMocks();
        apiMock.fetchQuestHint.mockImplementation(async (packId, questId, hintId) => ({ hint: `h${hintId}` }));
        apiMock.fetchQuestSolution.mockImplementation(async () => ({ solution: 'sol' }));
        // showHint/restoreQuestHints clone their items from these templates
        document.body.innerHTML = `
            <template id="hint-item-template"><li><code></code></li></template>
            <template id="hint-solution-template"><li><code></code></li></template>
        `;
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
            const qm = new QuestManager(first.state, ui);
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
            const qm = new QuestManager(first.state, ui);
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
    });

    describe('loadQuest', () => {
        it('enables history mode and read-only editor for completed quests', () => {
            const { state, ui, qm } = createFixture([{ id: 1 }]);
            state.questScores[1] = { hintsUsed: 0, solutionViewed: false, pointsEarned: 10 };
            state.activeQuestId = 2;
            state.saveGrimoire(1, 'package done');

            qm.loadQuest(1);

            expect(state.isHistoryMode).toBe(true);
            expect(ui.setEditorReadOnly).toHaveBeenCalledWith(true);
            expect(ui.setEditorValue).toHaveBeenCalledWith('package done');
        });

        it('keeps the active quest editable', () => {
            const { state, ui, qm } = createFixture([{ id: 1 }]);

            qm.loadQuest(1);

            expect(state.isHistoryMode).toBe(false);
            expect(ui.setEditorReadOnly).not.toHaveBeenCalled();
        });
    });
});
