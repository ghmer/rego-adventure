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
 * Event Manager
 * Handles all event listeners and user interactions
 */

import { verifySolution } from '../services/api-service.js';
import { setLocalStorage, getPackKey, buildQuestGrimoireKey, clearAllGrimoires } from '../services/storage-service.js';
import { AuthService } from '../services/auth-service.js';
import { handleApiError } from '../services/error-service.js';
import { showToast } from '../services/toast-service.js';

/**
 * Manages all event listeners
 */
export class EventManager {
    constructor(state, uiManager, questManager, audioManager, modalManager, packManager) {
        this.state = state;
        this.ui = uiManager;
        this.quest = questManager;
        this.audio = audioManager;
        this.modal = modalManager;
        this.pack = packManager;
    }

    /**
     * Setup all event listeners
     */
    setupEventListeners() {
        this.setupAuthListeners();
        this.setupAudioListeners();
        this.setupLoreListeners();
        this.setupQuestNavigationListeners();
        this.setupEditorListeners();
        this.setupHintListeners();
        this.setupManualListeners();
        this.setupTestPayloadListeners();
        this.setupResultModalListeners();
        this.setupPerfectScoreListeners();
        this.setupVerifyListener();
        this.setupNextButtonListener();
        this.setupRestartListeners();
        this.setupHomeListener();
        this.setupMinimizeListener();
        this.setupKeyboardShortcuts();
    }

    /**
     * Setup authentication event listeners. The OIDC redirects perform
     * network I/O; failures must reach the user instead of surfacing as
     * unhandled promise rejections.
     */
    setupAuthListeners() {
        if (this.ui.elements.loginBtn) {
            this.ui.elements.loginBtn.addEventListener('click', () => {
                AuthService.login().catch(e => handleApiError(e, 'log in'));
            });
        }

        if (this.ui.elements.logoutBtn) {
            this.ui.elements.logoutBtn.addEventListener('click', () => {
                AuthService.logout().catch(e => handleApiError(e, 'log out'));
            });
        }

        if (this.ui.elements.logoutBtnStart) {
            this.ui.elements.logoutBtnStart.addEventListener('click', () => {
                AuthService.logout().catch(e => handleApiError(e, 'log out'));
            });
        }
    }

    /**
     * Setup audio control listeners
     */
    setupAudioListeners() {
        this.ui.elements.musicBtn.addEventListener('click', () => {
            this.audio.toggleMusic();
        });

        if (this.ui.elements.effectsBtn) {
            this.ui.elements.effectsBtn.addEventListener('click', () => {
                this.ui.toggleEffects();
            });
        }
    }

    /**
     * Setup lore navigation listeners
     */
    setupLoreListeners() {
        this.ui.elements.lorePrevBtn.addEventListener('click', () => {
            this.quest.navigateLore('prev');
        });

        this.ui.elements.loreNextBtn.addEventListener('click', () => {
            this.quest.navigateLore('next');
        });
    }

    /**
     * Setup quest navigation listeners
     */
    setupQuestNavigationListeners() {
        if (this.ui.elements.questBackBtn) {
            this.ui.elements.questBackBtn.addEventListener('click', () => {
                this.saveGrimoire();
                this.quest.navigateToPreviousQuest();
            });
        }

        if (this.ui.elements.questForwardBtn) {
            this.ui.elements.questForwardBtn.addEventListener('click', () => {
                this.saveGrimoire();
                this.quest.navigateToNextQuest();
            });
        }
    }

    /**
     * Save grimoire content to localStorage and update the save indicator.
     * @returns {boolean} True when the content was written successfully
     */
    saveGrimoire() {
        if (this.state.currentQuestId > 0) {
            const questGrimoireKey = getPackKey(buildQuestGrimoireKey(this.state.currentQuestId), this.state.currentPackId);
            const saved = setLocalStorage(questGrimoireKey, this.ui.elements.editor.value);
            this.ui.setSaveIndicator(saved ? 'saved' : 'error');
            return saved;
        }
        return false;
    }

    /**
     * Setup editor listeners. The 1.5s debounce keeps localStorage writes
     * off every keystroke; pagehide/visibilitychange flushes make sure the
     * pending save cannot be lost when the page goes away.
     */
    setupEditorListeners() {
        // Debounced save on input
        this.ui.elements.editor.addEventListener('input', () => {
            this.ui.setSaveIndicator('dirty');
            clearTimeout(this.saveTimeout);
            this.saveTimeout = setTimeout(() => {
                this.saveGrimoire();
            }, 1500);
        });

        // Save immediately when editor loses focus
        this.ui.elements.editor.addEventListener('blur', () => {
            clearTimeout(this.saveTimeout);
            this.saveGrimoire();
        });

        // Flush pending saves when the page is hidden or closed
        window.addEventListener('pagehide', () => {
            clearTimeout(this.saveTimeout);
            this.saveGrimoire();
        });
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden') {
                clearTimeout(this.saveTimeout);
                this.saveGrimoire();
            }
        });
    }

    /**
     * Setup editor keyboard shortcuts: Ctrl/Cmd+Enter verifies the
     * current policy, Ctrl/Cmd+S saves it immediately. Shortcuts are
     * suppressed while a modal dialog is open.
     */
    setupKeyboardShortcuts() {
        document.addEventListener('keydown', (event) => {
            if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
            if (document.querySelector('dialog[open]')) return;

            if (event.key === 'Enter') {
                event.preventDefault();
                this.handleVerify();
            } else if (event.key === 's' || event.key === 'S') {
                event.preventDefault();
                if (this.saveGrimoire()) {
                    showToast('Policy saved.', 'info');
                }
            }
        });
    }

    /**
     * Setup hint button listener. Revealing is gated behind a
     * confirmation dialog because it costs points.
     */
    setupHintListeners() {
        this.ui.elements.hintBtn.addEventListener('click', () => {
            this.modal.showHintConfirmation(this.quest);
        });

        this.ui.elements.cancelHintBtn.addEventListener('click', () => {
            this.modal.closeHintConfirmation();
        });

        this.ui.elements.confirmHintBtn.addEventListener('click', () => {
            this.modal.closeHintConfirmation();
            this.quest.showHint();
        });
    }

    /**
     * Setup manual modal listeners
     */
    setupManualListeners() {
        this.ui.elements.checkManualBtn.addEventListener('click', () => {
            this.modal.showManual();
        });

        this.ui.elements.closeManualBtn.addEventListener('click', () => {
            this.modal.closeManual();
        });
    }

    /**
     * Setup test payload modal listeners
     */
    setupTestPayloadListeners() {
        this.ui.elements.checkTestPayloadBtn.addEventListener('click', async () => {
            await this.modal.showTestPayload();
        });

        this.ui.elements.closeTestPayloadBtn.addEventListener('click', () => {
            this.modal.closeTestPayload();
        });
    }

    /**
     * Setup result modal listeners
     */
    setupResultModalListeners() {
        this.ui.elements.closeResultBtn.addEventListener('click', () => {
            this.modal.closeResult();
        });

        this.ui.elements.nextQuestBtn.addEventListener('click', () => {
            this.modal.closeResult();
            this.quest.proceedToNextQuest();
        });
    }

    /**
     * Setup perfect score modal listeners
     */
    setupPerfectScoreListeners() {
        const perfectScoreBtn = this.ui.elements.perfectScoreBtn;
        if (perfectScoreBtn) {
            perfectScoreBtn.addEventListener('click', () => {
                this.modal.showPerfectScore();
            });
        }

        this.ui.elements.closePerfectScoreBtn.addEventListener('click', () => {
            this.modal.closePerfectScore();
        });
    }

    /**
     * Setup verify button listener
     */
    setupVerifyListener() {
        this.ui.elements.verifyBtn.addEventListener('click', () => {
            this.handleVerify();
        });
    }

    /**
     * Verify the current grimoire content. Shared by the verify button and
     * the Ctrl/Cmd+Enter shortcut.
     */
    async handleVerify() {
        if (this.ui.elements.verifyBtn.disabled) return;

        // Save grimoire content before verifying
        this.saveGrimoire();

        const code = this.ui.elements.editor.value;
        if (!code.trim()) return;

        const btn = this.ui.elements.verifyBtn;
        const label = this.ui.elements.verifyBtnLabel;
        const originalLabel = label ? label.textContent : null;

        btn.disabled = true;
        if (label) {
            label.textContent = this.state.label('verifying');
        }

        try {
            const result = await verifySolution(this.state.currentPackId, this.state.currentQuestId, code);

            if (!result.error && result.passed) {
                // Award points here, in the flow that owns the state
                // transition; the modal only renders the outcome
                const pointsEarned = this.state.completeQuest(this.state.currentQuestId);
                this.modal.showResult(result, pointsEarned);

                // Update navigation buttons after quest completion
                this.quest.updateQuestNavigationButtons();
            } else {
                this.modal.showResult(result);
            }
        } catch (e) {
            handleApiError(e, 'verify solution');
        } finally {
            btn.disabled = false;
            if (label && originalLabel !== null) {
                label.textContent = originalLabel;
            }
        }
    }

    /**
     * Setup start adventure button listener (for prologue)
     */
    setupNextButtonListener() {
        this.ui.elements.startAdventureBtn.addEventListener('click', () => {
            this.quest.proceedToNextQuest();
            this.ui.updateQuestFooterVisibility();
        });
    }

    /**
     * Setup restart listeners
     */
    setupRestartListeners() {
        this.ui.elements.restartBtn.addEventListener('click', () => {
            this.modal.showRestartConfirmation();
        });

        this.ui.elements.cancelRestartBtn.addEventListener('click', () => {
            this.modal.closeRestartConfirmation();
        });

        this.ui.elements.confirmRestartBtn.addEventListener('click', () => {
            this.handleRestart();
        });
    }

    /**
     * Handle restart confirmation
     */
    handleRestart() {
        // Clear all grimoires for this adventure
        clearAllGrimoires(this.state.currentPackId);

        // Reset state (persisted batched state is rewritten)
        this.state.resetProgress();

        // Reset UI
        this.modal.closeRestartConfirmation();
        this.ui.setEditorReadOnly(false);
        
        this.ui.hidePerfectScoreButton();
        
        // Update score display
        this.ui.updateScoreDisplay(this.state.totalScore);
        
        // Load the prologue
        this.quest.loadQuest(0);
        this.ui.updateQuestFooterVisibility();
    }

    /**
     * Setup home button listener
     */
    setupHomeListener() {
        this.ui.elements.homeBtn.addEventListener('click', () => {
            this.pack.returnHome();
        });
    }

    /**
     * Setup minimize/restore button listener
     */
    setupMinimizeListener() {
        if (!this.ui.elements.minimizeBtn) return;

        this.ui.elements.minimizeBtn.addEventListener('click', () => {
            const container = this.ui.elements.gameInterface;
            const btn = this.ui.elements.minimizeBtn;
            const icon = btn.querySelector('i');
            const isMinimized = container.classList.toggle('minimized');

            if (isMinimized) {
                icon.classList.replace('fa-minus', 'fa-expand');
                btn.setAttribute('aria-label', 'Restore interface');
                btn.setAttribute('aria-pressed', 'true');
                btn.title = 'Restore the interface';
            } else {
                icon.classList.replace('fa-expand', 'fa-minus');
                btn.setAttribute('aria-label', 'Minimize interface');
                btn.setAttribute('aria-pressed', 'false');
                btn.title = 'Minimize the interface to reveal the background';
            }
        });
    }
}