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
import { UIManager } from './ui-manager.js';
import { SaveStatus } from '../services/constants.js';

const SAVE_STATES = [
    [SaveStatus.SAVED, 'saved'],
    [SaveStatus.DIRTY, 'dirty'],
    [SaveStatus.FAILED, 'error'],
    [SaveStatus.IDLE, 'idle']
];

const GATES = [
    ['playable', { editorReadOnly: false, verifyEnabled: true, hintEnabled: true, editorVisible: true }],
    ['read only', { editorReadOnly: true, verifyEnabled: false, hintEnabled: false, editorVisible: true }],
    ['narrative', { editorReadOnly: true, verifyEnabled: false, hintEnabled: false, editorVisible: false }]
];

/**
 * Build a UIManager over the elements the interaction gate writes.
 * @returns {UIManager} Manager wired to the fixture document
 */
function createUi() {
    document.body.innerHTML = `
        <div id="editor-pane"></div>
        <button id="verify-btn"><span data-label>Verify</span></button>
        <button id="hint-btn"></button>
        <button id="start-adventure"></button>
        <ul id="hints-list"></ul>
        <textarea id="editor"></textarea>
    `;
    return new UIManager({ textarea: document.getElementById('editor') });
}

describe('ui-manager', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
    });

    describe('renderPerfectScoreButton', () => {
        /**
         * Build a UIManager over a quest footer holding the button.
         * @returns {UIManager} Manager wired to the fixture document
         */
        function createFooterUi() {
            document.body.innerHTML = `
                <div class="quest-footer">
                    <button id="perfect-score-btn" class="hidden"></button>
                </div>
            `;
            return new UIManager({ textarea: document.createElement('textarea') });
        }

        it('shows the button with the pack label and hides it again', () => {
            const ui = createFooterUi();

            ui.renderPerfectScoreButton(true, 'A prize waits');
            expect(ui.elements.perfectScoreBtn.classList.contains('hidden')).toBe(false);
            expect(ui.elements.perfectScoreBtn.textContent).toBe('A prize waits');

            ui.renderPerfectScoreButton(false);
            expect(ui.elements.perfectScoreBtn.classList.contains('hidden')).toBe(true);
        });

        it('hides an already hidden button', () => {
            const ui = createFooterUi();

            ui.renderPerfectScoreButton(false);

            expect(ui.elements.perfectScoreBtn.classList.contains('hidden')).toBe(true);
        });
    });

    describe('renderSaveStatus', () => {
        /**
         * Build a UIManager over a save indicator left in another state.
         * @returns {UIManager} Manager wired to the fixture document
         */
        function createIndicatorUi() {
            document.body.innerHTML = `
                <span id="editor-save-indicator" class="save-indicator saved" role="status"
                    aria-live="polite"></span>
            `;
            return new UIManager({ textarea: document.createElement('textarea') });
        }

        for (const [status, cssClass] of SAVE_STATES) {
            it(`paints exactly one state class for ${status}`, () => {
                const ui = createIndicatorUi();

                ui.renderSaveStatus(status);

                const indicator = ui.elements.saveIndicator;
                expect(indicator.classList.contains(cssClass)).toBe(true);
                const others = SAVE_STATES.map(([, cls]) => cls).filter(cls => cls !== cssClass);
                for (const cls of others) {
                    expect(indicator.classList.contains(cls), cls).toBe(false);
                }
            });
        }

        it('names the state in the accessible label', () => {
            const ui = createIndicatorUi();

            ui.renderSaveStatus(SaveStatus.FAILED);

            expect(ui.elements.saveIndicator.title).toContain('Saving failed');
            expect(ui.elements.saveIndicator.getAttribute('aria-label')).toBe(ui.elements.saveIndicator.title);
        });

        it('says the screen has no policy to save rather than claiming one is saved', () => {
            const ui = createIndicatorUi();

            ui.renderSaveStatus(SaveStatus.IDLE);

            expect(ui.elements.saveIndicator.title).toContain('No policy to save');
        });

        it('falls back to idle for a status it does not know', () => {
            const ui = createIndicatorUi();

            ui.renderSaveStatus('unsaved');

            expect(ui.elements.saveIndicator.classList.contains('idle')).toBe(true);
        });
    });

    describe('renderInteractionGate', () => {
        for (const [name, gate] of GATES) {
            it(`writes the ${name} gate to the controls`, () => {
                const ui = createUi();

                ui.renderInteractionGate(gate);

                expect(ui.elements.editor.readOnly).toBe(gate.editorReadOnly);
                expect(ui.elements.verifyBtn.disabled).toBe(!gate.verifyEnabled);
                expect(ui.elements.hintBtn.disabled).toBe(!gate.hintEnabled);
                expect(ui.elements.editorPane.classList.contains('hidden')).toBe(!gate.editorVisible);
            });
        }

        it('is the only writer of the gated controls, so a quest reset cannot undo a gate', () => {
            const ui = createUi();
            const readOnlyGate = GATES.find(([name]) => name === 'read only')[1];

            ui.renderInteractionGate(readOnlyGate);
            ui.resetQuestUI();

            expect(ui.elements.editor.readOnly).toBe(true);
            expect(ui.elements.verifyBtn.disabled).toBe(true);
            expect(ui.elements.hintBtn.disabled).toBe(true);
            expect(ui.elements.editorPane.classList.contains('hidden')).toBe(false);
        });
    });

    describe('renderQuestFooter', () => {
        /**
         * Build a UIManager over the quest footer of the shipped markup.
         * @returns {UIManager} Manager wired to the fixture document
         */
        function createFooterUi() {
            document.body.innerHTML = `
                <div class="quest-footer">
                    <button id="perfect-score-btn" class="action-btn hidden"></button>
                    <button id="start-adventure" class="action-btn primary hidden"></button>
                </div>
            `;
            return new UIManager({ textarea: document.createElement('textarea') });
        }

        it('is visible exactly while one of its buttons is visible', () => {
            const ui = createFooterUi();
            const footer = document.querySelector('.quest-footer');

            ui.renderPerfectScoreButton(true, 'A prize waits');
            ui.renderQuestFooter();
            expect(footer.classList.contains('hidden')).toBe(false);

            ui.renderPerfectScoreButton(false);
            ui.renderQuestButtonVisibility(false);
            ui.renderQuestFooter();
            expect(footer.classList.contains('hidden')).toBe(true);

            ui.renderQuestButtonVisibility(true);
            ui.renderQuestFooter();
            expect(footer.classList.contains('hidden')).toBe(false);
        });

        it('renders the button visibility of the screen from one input', () => {
            const ui = createFooterUi();

            ui.renderQuestButtonVisibility(true);
            expect(ui.elements.startAdventureBtn.classList.contains('hidden')).toBe(false);
            ui.renderQuestButtonVisibility(false);
            expect(ui.elements.startAdventureBtn.classList.contains('hidden')).toBe(true);
        });

        it('touches no button of its own', () => {
            const ui = createFooterUi();
            ui.renderQuestButtonVisibility(true);

            const visible = Array.from(document.querySelectorAll('.quest-footer button'))
                .filter(button => !button.classList.contains('hidden'));

            ui.renderQuestFooter();

            expect(Array.from(document.querySelectorAll('.quest-footer button'))
                .filter(button => !button.classList.contains('hidden'))).toEqual(visible);
        });
    });

    describe('interface minimize', () => {
        /**
         * Build a UIManager over the interface the minimize button controls.
         * @returns {UIManager} Manager wired to the fixture document
         */
        function createMinimizeUi() {
            document.body.innerHTML = `
                <div id="game-interface" class="app-container">
                    <button id="minimize-btn" class="icon-btn" aria-label="Minimize interface"
                        aria-pressed="false" title="Minimize the interface to reveal the background">
                        <i class="fa-solid fa-minus"></i>
                    </button>
                </div>
            `;
            return new UIManager({ textarea: document.createElement('textarea') });
        }

        /**
         * The three renderings of the minimize state.
         * @param {UIManager} ui - Manager under test
         * @returns {Object} Layout class, icon, pressed state and labels
         */
        function minimizeState(ui) {
            const button = ui.elements.minimizeBtn;
            return {
                minimized: ui.elements.gameInterface.classList.contains('minimized'),
                icon: button.querySelector('i').className,
                pressed: button.getAttribute('aria-pressed'),
                label: button.getAttribute('aria-label')
            };
        }

        it('renders layout, icon and pressed state together', () => {
            const ui = createMinimizeUi();

            ui.toggleInterfaceMinimized();
            expect(minimizeState(ui)).toEqual({
                minimized: true,
                icon: 'fa-solid fa-expand',
                pressed: 'true',
                label: 'Restore interface'
            });
            expect(ui.elements.minimizeBtn.title).toBe('Restore the interface');

            ui.toggleInterfaceMinimized();
            expect(minimizeState(ui)).toEqual({
                minimized: false,
                icon: 'fa-solid fa-minus',
                pressed: 'false',
                label: 'Minimize interface'
            });
        });

        it('returns a minimized interface to normal when the visit changes', () => {
            const ui = createMinimizeUi();
            ui.toggleInterfaceMinimized();

            ui.resetInterfaceMinimized();

            expect(minimizeState(ui).minimized).toBe(false);
            expect(minimizeState(ui).icon).toBe('fa-solid fa-minus');

            ui.resetInterfaceMinimized();
            expect(minimizeState(ui).minimized).toBe(false);
        });
    });

    describe('renderPackList', () => {
        /**
         * Build a UIManager over the start screen's pack list.
         * @returns {UIManager} Manager wired to the fixture document
         */
        function createPackListUi() {
            document.body.innerHTML = `
                <template id="quest-pack-card-template">
                    <div class="quest-pack-card">
                        <h3 class="pack-title"></h3>
                        <p class="pack-description"></p>
                        <span class="genre-badge hidden"></span>
                    </div>
                </template>
                <div id="quest-pack-list"></div>
            `;
            return new UIManager({ textarea: document.createElement('textarea') });
        }

        it('says so when the server loaded no packs', () => {
            const ui = createPackListUi();

            ui.renderPackList([], vi.fn());

            const list = ui.elements.questPackList;
            expect(list.querySelector('.quest-pack-card'), 'no cards').toBe(null);
            expect(list.textContent).toContain('No adventure packs are loaded');
        });

        it('renders the cards, and no notice, when packs exist', () => {
            const ui = createPackListUi();
            const onPackClick = vi.fn();

            ui.renderPackList([{ id: 'alpha', title: 'Alpha', description: 'first', genre: 'tech' }], onPackClick);

            const list = ui.elements.questPackList;
            expect(list.querySelectorAll('.quest-pack-card').length).toBe(1);
            expect(list.textContent).not.toContain('No adventure packs are loaded');

            list.querySelector('.quest-pack-card').click();
            expect(onPackClick).toHaveBeenCalledWith('alpha');
        });
    });
});
