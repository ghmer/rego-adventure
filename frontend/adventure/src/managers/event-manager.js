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
import { AuthService } from '../services/auth-service.js';
import { handleApiError } from '../services/error-service.js';
import { showToast } from '../services/toast-service.js';
import { ErrorLevel } from '../services/constants.js';

/**
 * Manages all event listeners
 */
export class EventManager {
    constructor(state, uiManager, questManager, audioManager, modalManager, packManager, autosave) {
        this.state = state;
        this.ui = uiManager;
        this.quest = questManager;
        this.audio = audioManager;
        this.modal = modalManager;
        this.pack = packManager;
        // The editor's pending write: timer, storage write and indicator are
        // one collaborator, shared with the quest screens that replace content
        this.autosave = autosave;
        // One verification at a time: the keyboard shortcut cannot be stopped
        // by a button attribute, so the action carries its own guard
        this.verifying = false;
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
        this.setupSupportModulesListeners();
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
                this.autosave.flush();
                this.quest.navigateToPreviousQuest();
            });
        }

        if (this.ui.elements.questForwardBtn) {
            this.ui.elements.questForwardBtn.addEventListener('click', () => {
                this.autosave.flush();
                this.quest.navigateToNextQuest();
            });
        }
    }

    /**
     * Setup editor listeners. The autosave's debounce keeps storage writes off
     * every keystroke; blur and the pagehide/visibilitychange flushes make sure
     * a pending write cannot be lost when the editor or the page goes away.
     */
    setupEditorListeners() {
        this.ui.elements.editor.addEventListener('input', () => {
            this.autosave.markDirty();
        });

        this.ui.elements.editor.addEventListener('blur', () => {
            this.autosave.flush();
        });

        window.addEventListener('pagehide', () => {
            this.autosave.flush();
        });
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden') {
                this.autosave.flush();
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
                if (this.autosave.flush()) {
                    showToast('Policy saved.', ErrorLevel.INFO);
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
            this.modal.showHintConfirmation();
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
     * Setup support modules modal listeners. The button stays disabled
     * unless the current quest ships support modules, so a click can only
     * happen when there is something to show. The module sources are
     * fetched when the modal opens.
     */
    setupSupportModulesListeners() {
        this.ui.elements.checkSupportModulesBtn.addEventListener('click', async () => {
            await this.modal.showSupportModules();
        });

        this.ui.elements.closeSupportModulesBtn.addEventListener('click', () => {
            this.modal.closeSupportModules();
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
        const gate = this.state.getInteractionGate();
        if (!gate.verifyEnabled || this.verifying) return;

        // Write the grimoire before verifying, so the code that is checked is
        // the code on screen
        this.autosave.flush();

        const code = this.ui.elements.editor.value;
        if (!code.trim()) return;

        const label = this.ui.elements.verifyBtnLabel;
        const originalLabel = label ? label.textContent : null;

        this.verifying = true;
        // The gate with verification taken away, so the button cannot start a
        // second request while one runs
        this.ui.renderInteractionGate({ ...gate, verifyEnabled: false });
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
            this.verifying = false;
            // The state did not change unless the tests passed, in which case
            // the derived gate is what belongs on screen now
            this.ui.renderInteractionGate(this.state.getInteractionGate());
            if (label && originalLabel !== null) {
                label.textContent = originalLabel;
            }
        }
    }

    /**
     * Setup the adventure offer listener. The quest manager withdraws the
     * offer and recomputes the footer; this edge only forwards the request.
     */
    setupNextButtonListener() {
        this.ui.elements.startAdventureBtn.addEventListener('click', () => {
            this.quest.leavePrologue();
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
        // Reset state (clears scores, hints, and grimoires, and persists the
        // reset), and drop the reveal texts the old progress had fetched
        this.state.resetProgress();
        this.pack.clearPackCaches();

        // Reset UI
        this.modal.closeRestartConfirmation();

        this.ui.renderPerfectScoreButton(false);
        this.ui.resetInterfaceMinimized();

        // Update score display
        this.ui.updateScoreDisplay(this.state.totalScore);

        // Load the prologue
        this.quest.loadQuest(0);
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
            this.ui.toggleInterfaceMinimized();
        });
    }
}