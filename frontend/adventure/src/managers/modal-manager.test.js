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

const apiMock = vi.hoisted(() => ({
    fetchTestPayload: vi.fn()
}));

vi.mock('../services/api-service.js', async (importOriginal) => {
    const actual = await importOriginal();
    return { ...actual, fetchTestPayload: apiMock.fetchTestPayload };
});
vi.mock('../services/error-service.js', () => ({ handleApiError: vi.fn() }));
vi.mock('../services/toast-service.js', () => ({ showToast: vi.fn() }));
vi.mock('../effects.js', () => ({
    showConfetti: vi.fn(),
    triggerResultEffect: vi.fn(),
    cleanupEffects: vi.fn()
}));

import {
    ModalManager,
    formatActualValue,
    formatPolicyError,
    buildHintConfirmationText
} from './modal-manager.js';
import { ApiError } from '../services/api-service.js';
import { handleApiError } from '../services/error-service.js';
import { showToast } from '../services/toast-service.js';

describe('modal-manager pure helpers', () => {
    describe('formatPolicyError', () => {
        it('formats line and column', () => {
            expect(formatPolicyError({ line: 4, col: 5, message: 'rego_parse_error: bad syntax' }))
                .toBe('Line 4, Col 5: rego_parse_error: bad syntax');
        });

        it('formats the line only when no column is present', () => {
            expect(formatPolicyError({ line: 4, col: 0, message: 'rego_type_error: unsafe' }))
                .toBe('Line 4: rego_type_error: unsafe');
        });

        it('falls back to the plain message without a location', () => {
            expect(formatPolicyError({ line: 0, col: 0, message: 'runtime failure' }))
                .toBe('runtime failure');
        });

        it('shows an unknown error placeholder for missing messages', () => {
            expect(formatPolicyError({})).toBe('Unknown error');
        });
    });

    describe('formatActualValue', () => {
        it('disambiguates undefined results from explicit null', () => {
            expect(formatActualValue({ undefined: true, actual: null }))
                .toBe('undefined (no rule produced a value)');
        });

        it('renders an explicit null as JSON null', () => {
            expect(formatActualValue({ undefined: false, actual: null })).toBe('null');
        });

        it('renders objects as JSON', () => {
            expect(formatActualValue({ undefined: false, actual: { a: 1 } })).toBe('{"a":1}');
        });
    });

    describe('buildHintConfirmationText', () => {
        const quest = { hints: ['h1', 'h2'], solution: 'sol' };

        it('asks for confirmation before hint N of M', () => {
            expect(buildHintConfirmationText(quest, 0)).toBe(
                'Reveal hint 1 of 2? Revealing hints reduces the points you can earn for this quest.'
            );
            expect(buildHintConfirmationText(quest, 1)).toBe(
                'Reveal hint 2 of 2? Revealing hints reduces the points you can earn for this quest.'
            );
        });

        it('asks for confirmation before the solution', () => {
            expect(buildHintConfirmationText(quest, 2)).toBe(
                'Reveal the solution? This reduces the points you can earn for this quest.'
            );
        });

        it('returns null when all hints are revealed and no solution exists', () => {
            expect(buildHintConfirmationText({ hints: ['h1'] }, 1)).toBeNull();
        });

        it('offers the solution directly for quests without hints', () => {
            expect(buildHintConfirmationText({ solution: 'sol' }, 0)).toBe(
                'Reveal the solution? This reduces the points you can earn for this quest.'
            );
        });

        it('returns null without a quest', () => {
            expect(buildHintConfirmationText(null, 0)).toBeNull();
        });
    });
});

describe('modal-manager', () => {
    let ui;
    let state;
    let modal;

    /**
     * Create a real dialog element (happy-dom supports showModal/close).
     * @returns {HTMLDialogElement} Dialog element
     */
    function dialog() {
        return document.createElement('dialog');
    }

    beforeEach(() => {
        vi.clearAllMocks();

        document.body.innerHTML = '';

        ui = {
            elements: {
                manualModal: dialog(),
                testPayloadModal: dialog(),
                resultModal: dialog(),
                perfectScoreModal: dialog(),
                hintModal: dialog(),
                restartModal: dialog(),
                hintsList: document.createElement('ul'),
                hintConfirmText: document.createElement('p'),
                cancelHintBtn: document.createElement('button'),
                closeTestPayloadBtn: document.createElement('button'),
                closeManualBtn: document.createElement('button'),
                closeResultBtn: document.createElement('button'),
                nextQuestBtn: document.createElement('button'),
                closePerfectScoreBtn: document.createElement('button'),
                cancelRestartBtn: document.createElement('button'),
                resultIcon: document.createElement('img'),
                resultTitle: document.createElement('h2'),
                resultMessage: document.createElement('div'),
                resultTestList: document.createElement('ul'),
                scoreSummary: document.createElement('div'),
                pointsEarned: document.createElement('span'),
                pointsPossible: document.createElement('span'),
                perfectScoreImage: document.createElement('img'),
                perfectScoreMessage: document.createElement('div')
            },
            renderManual: vi.fn(),
            renderTestPayload: vi.fn(),
            updateScoreDisplay: vi.fn(),
            parseMarkdown: vi.fn()
        };

        // Dialogs must be in the document for showModal and focus to work
        Object.values(ui.elements).forEach(el => {
            if (el instanceof HTMLDialogElement) document.body.appendChild(el);
        });

        state = {
            currentPackId: 'fantasy',
            currentQuestId: 2,
            currentQuest: { id: 2 },
            label: (key) => `label:${key}`,
            totalScore: 7
        };

        modal = new ModalManager(state, ui);
    });

    describe('showHintConfirmation', () => {
        it('opens the dialog with the text for the next hint', () => {
            state.currentQuest = { hints: ['h1', 'h2'], solution: 'sol' };
            const focusSpy = vi.spyOn(ui.elements.cancelHintBtn, 'focus');

            modal.showHintConfirmation();

            expect(ui.elements.hintConfirmText.textContent).toBe(
                'Reveal hint 1 of 2? Revealing hints reduces the points you can earn for this quest.'
            );
            expect(ui.elements.hintModal.open).toBe(true);
            expect(focusSpy).toHaveBeenCalled();
        });

        it('offers the solution when all hints are revealed', () => {
            state.currentQuest = { hints: ['h1'], solution: 'sol' };
            ui.elements.hintsList.appendChild(document.createElement('li'));

            modal.showHintConfirmation();

            expect(ui.elements.hintConfirmText.textContent).toBe(
                'Reveal the solution? This reduces the points you can earn for this quest.'
            );
        });

        it('does nothing when there is nothing left to reveal', () => {
            state.currentQuest = { hints: ['h1'] };
            ui.elements.hintsList.appendChild(document.createElement('li'));

            modal.showHintConfirmation();

            expect(ui.elements.hintModal.open).toBe(false);
        });

        it('does nothing without a current quest', () => {
            state.currentQuest = null;

            modal.showHintConfirmation();

            expect(ui.elements.hintModal.open).toBe(false);
        });
    });

    describe('showTestPayload', () => {
        it('fetches, renders, and opens the dialog', async () => {
            const payload = [{ id: 1 }];
            apiMock.fetchTestPayload.mockResolvedValue(payload);

            await modal.showTestPayload();

            expect(apiMock.fetchTestPayload).toHaveBeenCalledWith('fantasy', 2);
            expect(ui.renderTestPayload).toHaveBeenCalledWith(payload);
            expect(ui.elements.testPayloadModal.open).toBe(true);
        });

        it('caches payloads per pack and quest', async () => {
            apiMock.fetchTestPayload.mockResolvedValue([{ id: 1 }]);

            await modal.showTestPayload();
            await modal.showTestPayload();

            expect(apiMock.fetchTestPayload).toHaveBeenCalledTimes(1);
            expect(ui.renderTestPayload).toHaveBeenCalledTimes(2);

            state.currentQuestId = 3;
            await modal.showTestPayload();

            expect(apiMock.fetchTestPayload).toHaveBeenCalledTimes(2);
            expect(apiMock.fetchTestPayload).toHaveBeenLastCalledWith('fantasy', 3);
        });

        it('refetches after the cache is cleared on restart', async () => {
            apiMock.fetchTestPayload.mockResolvedValue([{ id: 1 }]);

            await modal.showTestPayload();
            modal.clearTestPayloadCache();
            await modal.showTestPayload();

            expect(apiMock.fetchTestPayload).toHaveBeenCalledTimes(2);
        });

        it('reports load failures without opening the dialog', async () => {
            apiMock.fetchTestPayload.mockRejectedValue(new ApiError('boom', 500));

            await modal.showTestPayload();

            expect(handleApiError).toHaveBeenCalledWith(expect.any(ApiError), 'load test payload data');
            expect(ui.elements.testPayloadModal.open).toBe(false);
            expect(ui.renderTestPayload).not.toHaveBeenCalled();
        });

        it('shows an info toast on narrative screens instead of fetching', async () => {
            state.currentQuestId = 0;

            await modal.showTestPayload();

            expect(apiMock.fetchTestPayload).not.toHaveBeenCalled();
            expect(showToast).toHaveBeenCalledWith('No test data available for this quest.', 'info');
        });
    });

    describe('dialog helpers', () => {
        it('closes an open hint dialog on cancel', () => {
            ui.elements.hintModal.showModal();

            modal.closeHintConfirmation();

            expect(ui.elements.hintModal.open).toBe(false);
        });

        it('does not throw when closing an already closed dialog', () => {
            expect(() => modal.closeHintConfirmation()).not.toThrow();
        });
    });
});
