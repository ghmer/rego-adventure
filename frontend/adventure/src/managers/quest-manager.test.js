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
import { getLocalStorage, setLocalStorage, getPackKey } from '../services/storage-service.js';

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
        // showHint/restoreQuestHints clone their items from these templates
        document.body.innerHTML = `
            <template id="hint-item-template"><li><code></code></li></template>
            <template id="hint-solution-template"><li><code></code></li></template>
        `;
    });

    describe('loadQuestCode', () => {
        it('prefers saved code over the template', () => {
            setLocalStorage(getPackKey('rego_grimoire_q1', PACK_ID), 'package saved');
            const { state, ui, qm } = createFixture([{ id: 1, apply_template: true, template: 'package tpl' }]);
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
        it('reveals hints one at a time and persists the state', () => {
            const { state, ui, qm } = createFixture([
                { id: 1, hints: ['h1', 'h2'], solution: 'sol' }
            ]);
            state.currentQuest = state.quests[0];
            qm.loadQuest(1);

            qm.showHint();

            expect(ui.elements.hintsList.children).toHaveLength(1);
            expect(ui.elements.hintsList.children[0].querySelector('code').textContent).toBe('h1');
            expect(state.currentQuestHintsUsed).toBe(1);
            expect(ui.updateHintButtonText).toHaveBeenCalledWith(state.currentQuest, 1, DEFAULT_TEXT.HINT_BUTTON);
            expect(getLocalStorage(getPackKey('rego_hints_q1', PACK_ID)))
                .toBe(JSON.stringify({ hintsUsed: 1, solutionViewed: false }));

            qm.showHint();

            expect(ui.elements.hintsList.children).toHaveLength(2);
            expect(ui.elements.hintsList.children[1].querySelector('code').textContent).toBe('h2');
        });

        it('reveals the solution after the last hint and hides the button', () => {
            const { state, ui, qm } = createFixture([
                { id: 1, hints: ['h1'], solution: 'sol' }
            ]);
            qm.loadQuest(1);

            qm.showHint(); // hint
            qm.showHint(); // solution

            expect(state.currentQuestSolutionViewed).toBe(true);
            expect(ui.elements.hintsList.children[1].querySelector('code').textContent).toBe('sol');
            expect(ui.elements.hintBtn.classList.contains('hidden')).toBe(true);
            expect(getLocalStorage(getPackKey('rego_hints_q1', PACK_ID)))
                .toBe(JSON.stringify({ hintsUsed: 1, solutionViewed: true }));
        });

        it('is a no-op for quests without hints', () => {
            const { state, ui, qm } = createFixture([{ id: 1 }]);
            state.currentQuest = state.quests[0];

            qm.showHint();

            expect(ui.elements.hintsList.children).toHaveLength(0);
            expect(state.currentQuestHintsUsed).toBe(0);
        });
    });

    describe('restoreQuestHints', () => {
        it('re-renders hints revealed in a previous session', () => {
            const quests = [{ id: 1, hints: ['h1', 'h2'], solution: 'sol' }];

            // First session: reveal both hints
            const first = createFixture(quests);
            first.qm.loadQuest(1);
            first.qm.showHint();
            first.qm.showHint();

            // Second session: same persisted state, fresh UI
            const ui = createUi();
            const qm = new QuestManager(first.state, ui);
            qm.loadQuest(1);

            expect(ui.elements.hintsList.children).toHaveLength(2);
            expect(ui.elements.hintsList.children[0].querySelector('code').textContent).toBe('h1');
            expect(ui.elements.hintsList.children[1].querySelector('code').textContent).toBe('h2');
            expect(ui.elements.hintBtn.classList.contains('hidden')).toBe(false);
            expect(ui.updateHintButtonText).toHaveBeenCalledWith(
                first.state.currentQuest, 2, DEFAULT_TEXT.HINT_BUTTON
            );
        });

        it('hides the hint button when the solution was already revealed', () => {
            const quests = [{ id: 1, hints: ['h1'], solution: 'sol' }];

            const first = createFixture(quests);
            first.qm.loadQuest(1);
            first.qm.showHint();
            first.qm.showHint();

            const ui = createUi();
            const qm = new QuestManager(first.state, ui);
            qm.loadQuest(1);

            expect(ui.elements.hintsList.children).toHaveLength(2);
            expect(ui.elements.hintBtn.classList.contains('hidden')).toBe(true);
            expect(first.state.currentQuestSolutionViewed).toBe(true);
        });

        it('does nothing for quests without saved hint state', () => {
            const { ui, qm } = createFixture([{ id: 1, hints: ['h1'], solution: 'sol' }]);
            qm.loadQuest(1);

            expect(ui.elements.hintsList.children).toHaveLength(0);
            expect(ui.elements.hintBtn.classList.contains('hidden')).toBe(false);
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
            setLocalStorage(getPackKey('rego_grimoire_q1', PACK_ID), 'package done');

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

        it('hides the hint button after the solution was revealed', () => {
            const { ui, qm } = createFixture([{ id: 1, hints: ['h1'], solution: 'sol' }]);
            qm.loadQuest(1);
            qm.showHint();
            qm.showHint();

            // The button stays hidden; a further reveal attempt must not
            // unhide it
            qm.showHint();
            expect(ui.elements.hintBtn.classList.contains('hidden')).toBe(true);
        });
    });
});
