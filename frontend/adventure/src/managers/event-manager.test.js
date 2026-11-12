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
import { EventManager } from './event-manager.js';
import { UIManager } from './ui-manager.js';
import { GameState } from '../services/state-service.js';

const apiMock = vi.hoisted(() => ({
    verifySolution: vi.fn()
}));

vi.mock('../services/api-service.js', async (importOriginal) => {
    const actual = await importOriginal();
    return { ...actual, verifySolution: apiMock.verifySolution };
});
vi.mock('../services/error-service.js', () => ({ handleApiError: vi.fn() }));

const PACK_ID = 'testpack';
const CODE = 'package quest {\ndefault allow := true\n}';

/**
 * Press Ctrl+Enter, the shortcut path that reaches verification without
 * passing any button.
 */
function pressVerifyShortcut() {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true }));
}

/**
 * Wire an event manager to a real UIManager over a minimal quest screen.
 * @returns {Object} { state, ui, quest, modal, em }
 */
function createFixture() {
    const state = new GameState();
    state.setCurrentPack(PACK_ID);
    state.loadPackData({
        quests: [{ id: 1 }, { id: 2 }],
        prologue: ['p'],
        epilogue: ['e'],
        meta: null,
        ui_labels: {}
    });

    document.body.innerHTML = `
        <div id="editor-pane"></div>
        <button id="verify-btn"><span data-label>Verify</span></button>
        <button id="hint-btn"></button>
        <button id="start-adventure"></button>
        <span id="experience-points">0 XP</span>
        <ul id="hints-list"></ul>
        <textarea id="editor">${CODE}</textarea>
    `;

    const ui = new UIManager({ textarea: document.getElementById('editor') });
    const quest = { updateQuestNavigationButtons: vi.fn(), loadQuest: vi.fn(), clearCaches: vi.fn() };
    const modal = { showResult: vi.fn(), closeRestartConfirmation: vi.fn(), clearCaches: vi.fn() };
    const pack = { clearPackCaches: vi.fn() };
    const em = new EventManager(state, ui, quest, {}, modal, pack);
    em.setupKeyboardShortcuts();

    return { state, ui, quest, modal, pack, em };
}

describe('event-manager', () => {
    beforeEach(() => {
        localStorage.clear();
        document.body.innerHTML = '';
        vi.clearAllMocks();
        apiMock.verifySolution.mockResolvedValue({ passed: true });
    });

    describe('restart', () => {
        it('drops the reveal texts fetched for the pack when progress restarts', () => {
            const { state, pack, em } = createFixture();
            state.enterQuest(1);
            state.completeQuest(1);

            em.handleRestart();

            expect(state.questScores).toEqual({});
            expect(pack.clearPackCaches).toHaveBeenCalledTimes(1);
        });
    });

    describe('keyboard verification', () => {
        it('refuses the shortcut on a narrative screen', () => {
            const { state, ui, modal } = createFixture();
            state.enterQuest(0);

            // the button carries no disabled flag of its own here: the
            // shortcut must be stopped by the interaction gate, not by layout
            expect(ui.elements.verifyBtn.disabled).toBe(false);

            pressVerifyShortcut();

            expect(apiMock.verifySolution).not.toHaveBeenCalled();
            expect(modal.showResult).not.toHaveBeenCalled();
        });

        it('verifies the quest the player stands on', async () => {
            const { state, ui } = createFixture();
            state.enterQuest(1);

            pressVerifyShortcut();

            await vi.waitFor(() => expect(apiMock.verifySolution).toHaveBeenCalledWith(PACK_ID, 1, CODE));
            expect(ui.elements.verifyBtn.disabled).toBe(false);
        });

        it('disables verification while a verification runs and restores the derived gate after it', async () => {
            const { state, ui } = createFixture();
            let settle;
            apiMock.verifySolution.mockImplementation(() => new Promise(resolve => {
                settle = resolve;
            }));
            state.enterQuest(1);

            pressVerifyShortcut();
            await Promise.resolve();

            expect(ui.elements.verifyBtn.disabled).toBe(true);

            settle({ passed: true });
            await vi.waitFor(() => expect(ui.elements.verifyBtn.disabled).toBe(false));

            expect(state.questScores[1]).toBeDefined();
        });

        it('stays suppressed while a dialog is open', () => {
            const { state } = createFixture();
            document.body.insertAdjacentHTML('beforeend', '<dialog id="open-dialog" open></dialog>');
            state.enterQuest(1);

            pressVerifyShortcut();

            expect(apiMock.verifySolution).not.toHaveBeenCalled();
        });
    });
});
