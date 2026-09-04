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

/**
 * Modal Manager
 * Handles all modal dialogs and their interactions
 */

import { showConfetti, triggerResultEffect, cleanupEffects } from '../effects.js';
import { fetchTestPayload } from '../services/api-service.js';
import { handleApiError } from '../services/error-service.js';
import { showToast } from '../services/toast-service.js';
import { SCORING, DEFAULT_TEXT } from '../services/constants.js';

/**
 * Manages modal dialogs
 */
export class ModalManager {
    constructor(state, uiManager) {
        this.state = state;
        this.ui = uiManager;

        this.setupDialogHandlers();
    }

    /**
     * Show dialog safely without throwing if already open
     * @param {HTMLDialogElement} dialog - Dialog element
     * @param {boolean} modal - Whether to open as a modal dialog
     */
    openDialog(dialog, modal = true) {
        if (!dialog?.open) {
            if (modal) {
                dialog.showModal();
            } else {
                dialog.show();
            }
        }
    }

    /**
     * Close dialog safely without throwing if already closed
     * @param {HTMLDialogElement} dialog - Dialog element
     */
    closeDialog(dialog) {
        if (dialog?.open) {
            dialog.close();
        }
    }

    /**
     * Setup native dialog event handlers
     */
    setupDialogHandlers() {
        const dismissibleDialogs = [
            this.ui.elements.manualModal,
            this.ui.elements.testPayloadModal,
            this.ui.elements.resultModal,
            this.ui.elements.perfectScoreModal
        ];

        dismissibleDialogs.forEach(dialog => {
            if (!dialog) {
                return;
            }

            dialog.addEventListener('click', (event) => {
                if (event.target === dialog) {
                    this.closeDialog(dialog);
                }
            });
        });

        // Ensure visual effects are removed for all close paths (button, ESC, backdrop).
        this.ui.elements.resultModal.addEventListener('close', () => {
            cleanupEffects();
        });

        // Keep restart confirmation explicit (buttons only).
        this.ui.elements.restartModal.addEventListener('cancel', (event) => {
            event.preventDefault();
        });
    }

    /**
     * Show manual modal
     */
    showManual() {
        if (this.state.currentQuest) {
            this.ui.renderManual(this.state.currentQuest.manual);
            this.openDialog(this.ui.elements.manualModal);
            this.ui.elements.closeManualBtn.focus();
        }
    }

    /**
     * Close manual modal
     */
    closeManual() {
        this.closeDialog(this.ui.elements.manualModal);
    }

    /**
     * Show test payload modal
     */
    async showTestPayload() {
        if (this.state.currentQuest && this.state.currentQuestId > 0) {
            try {
                const testPayloads = await fetchTestPayload(this.state.currentPackId, this.state.currentQuestId);
                this.ui.renderTestPayload(testPayloads);
                this.openDialog(this.ui.elements.testPayloadModal);
                this.ui.elements.closeTestPayloadBtn.focus();
            } catch (error) {
                handleApiError(error, 'load test payload data');
            }
        } else {
            showToast('No test data available for this quest.', 'info');
        }
    }

    /**
     * Close test payload modal
     */
    closeTestPayload() {
        this.closeDialog(this.ui.elements.testPayloadModal);
    }

    /**
     * Show result modal with test results
     * @param {Object} result - Verification result from API
     * @param {number|null} [pointsEarned=null] - Points earned on success
     * (computed and persisted by the caller that owns the state transition)
     */
    showResult(result, pointsEarned = null) {
        this.ui.elements.resultTestList.innerHTML = '';

        const isSuccess = !result.error && result.passed;

        // Set icon
        const iconPath = `/quests/${this.state.currentPackId}/assets/${isSuccess ? 'icon-success.png' : 'icon-failure.png'}`;
        this.ui.elements.resultIcon.src = iconPath;
        this.ui.elements.resultIcon.alt = isSuccess ? 'Success - Quest completed' : 'Failure - Quest not completed';

        // Set title and message
        if (result.error) {
            this.ui.elements.resultTitle.textContent = "Error";
            this.ui.elements.resultMessage.textContent = result.error;
            this.ui.elements.scoreSummary.classList.add('hidden');
        } else if (isSuccess) {
            this.ui.elements.resultTitle.textContent = this.state.messageSuccess || DEFAULT_TEXT.MESSAGE_SUCCESS;
            this.ui.elements.resultMessage.textContent = "All tests passed. Well done!";

            const pointsPossible = SCORING.POINTS_PER_QUEST;

            this.ui.elements.pointsEarned.textContent = pointsEarned;
            this.ui.elements.pointsPossible.textContent = pointsPossible;
            this.ui.elements.scoreSummary.classList.remove('hidden');

            this.ui.updateScoreDisplay(this.state.totalScore);
        } else {
            this.ui.elements.resultTitle.textContent = this.state.messageFailure || DEFAULT_TEXT.MESSAGE_FAILURE;
            this.ui.elements.resultMessage.textContent = "Some tests did not pass. Review the results below.";
            this.ui.elements.scoreSummary.classList.add('hidden');
        }
        
        // Render test results
        if (result.results) {
            const template = document.getElementById('test-result-template');
            
            result.results.forEach(test => {
                const testItem = template.content.cloneNode(true);
                const testResultDiv = testItem.querySelector('.test-result');
                const icon = test.passed ? '✓' : '✗';
                
                testResultDiv.classList.add(test.passed ? 'pass' : 'fail');
                
                testItem.querySelector('.test-text').textContent =
                    `Test ${test.test_id}: ${test.passed ? 'Passed' : 'Failed'} (Expected: ${JSON.stringify(test.expected)}, Got: ${JSON.stringify(test.actual)})`;
                testItem.querySelector('.test-icon').textContent = icon;
                
                // Show payload for failed tests
                const payloadDiv = testItem.querySelector('.test-payload');
                if (!test.passed && test.input) {
                    payloadDiv.style.display = 'block';
                    payloadDiv.querySelector('pre').textContent = JSON.stringify(test.input, null, 2);
                } else {
                    payloadDiv.style.display = 'none';
                }
                
                this.ui.elements.resultTestList.appendChild(testItem);
            });
        }
        
        // Show/hide next quest button
        if (isSuccess) {
            this.ui.elements.nextQuestBtn.classList.remove('hidden');
        } else {
            this.ui.elements.nextQuestBtn.classList.add('hidden');
        }
        
        // Trigger visual effects
        triggerResultEffect(isSuccess);
        
        // Show modal
        this.openDialog(this.ui.elements.resultModal, false);
        if (isSuccess) {
            this.ui.elements.nextQuestBtn.focus();
        } else {
            this.ui.elements.closeResultBtn.focus();
        }
    }

    /**
     * Close result modal
     */
    closeResult() {
        this.closeDialog(this.ui.elements.resultModal);
    }

    /**
     * Show perfect score modal
     */
    showPerfectScore() {
        this.ui.elements.perfectScoreImage.src = `/quests/${this.state.currentPackId}/assets/perfect_score.png`;
        this.ui.elements.perfectScoreImage.onerror = () => {
            this.ui.elements.perfectScoreImage.src = `/quests/${this.state.currentPackId}/assets/icon-success.png`;
        };
        
        this.ui.elements.perfectScoreMessage.innerHTML = this.ui.parseMarkdown(this.state.perfectScoreMessage);
        this.openDialog(this.ui.elements.perfectScoreModal);
        this.ui.elements.closePerfectScoreBtn.focus();
        
        showConfetti();
    }

    /**
     * Close perfect score modal
     */
    closePerfectScore() {
        this.closeDialog(this.ui.elements.perfectScoreModal);
    }

    /**
     * Show restart confirmation modal
     */
    showRestartConfirmation() {
        this.openDialog(this.ui.elements.restartModal);
        this.ui.elements.cancelRestartBtn.focus();
    }

    /**
     * Close restart modal (cancel)
     */
    closeRestartConfirmation() {
        this.closeDialog(this.ui.elements.restartModal);
    }
}