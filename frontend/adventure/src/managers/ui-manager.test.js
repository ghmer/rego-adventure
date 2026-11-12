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

import { beforeEach, describe, expect, it } from 'vitest';
import { UIManager } from './ui-manager.js';

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
            expect(document.querySelector('.quest-footer').classList.contains('hidden')).toBe(false);

            ui.renderPerfectScoreButton(false);
            expect(ui.elements.perfectScoreBtn.classList.contains('hidden')).toBe(true);
            expect(document.querySelector('.quest-footer').classList.contains('hidden')).toBe(true);
        });

        it('hides an already hidden button and refreshes the footer', () => {
            const ui = createFooterUi();

            ui.renderPerfectScoreButton(false);

            expect(ui.elements.perfectScoreBtn.classList.contains('hidden')).toBe(true);
            expect(document.querySelector('.quest-footer').classList.contains('hidden')).toBe(true);
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
});
