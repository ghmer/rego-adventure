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
import { setLocalStorage, getPackKey, clearAllGrimoires, removeLocalStorage, STORAGE_KEYS } from '../services/storage-service.js';
import { AuthService } from '../services/auth-service.js';
import { handleApiError } from '../services/error-service.js';
import { DEFAULT_TEXT } from '../services/constants.js';

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
        this.modal.setupModalClickOutside();
    }

    /**
     * Setup authentication event listeners
     */
    setupAuthListeners() {
        if (this.ui.elements.loginBtn) {
            this.ui.elements.loginBtn.addEventListener('click', () => {
                AuthService.login();
            });
        }
        
        if (this.ui.elements.logoutBtn) {
            this.ui.elements.logoutBtn.addEventListener('click', () => {
                AuthService.logout();
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
                this.quest.navigateToPreviousQuest();
            });
        }

        if (this.ui.elements.questForwardBtn) {
            this.ui.elements.questForwardBtn.addEventListener('click', () => {
                this.quest.navigateToNextQuest();
            });
        }
    }

    /**
     * Save grimoire content to localStorage
     */
    saveGrimoire() {
        if (this.state.currentQuestId > 0) {
            const questGrimoireKey = getPackKey(`rego_grimoire_q${this.state.currentQuestId}`, this.state.currentPackId);
            setLocalStorage(questGrimoireKey, this.ui.elements.editor.value);
        }
    }

    /**
     * Setup editor listeners
     */
    setupEditorListeners() {
        let saveTimeout;
        
        // Debounced save on input
        this.ui.elements.editor.addEventListener('input', () => {
            clearTimeout(saveTimeout);
            saveTimeout = setTimeout(() => {
                this.saveGrimoire();
            }, 1500);
        });
        
        // Save immediately when editor loses focus
        this.ui.elements.editor.addEventListener('blur', () => {
            clearTimeout(saveTimeout);
            this.saveGrimoire();
        });
    }

    /**
     * Setup hint button listener
     */
    setupHintListeners() {
        this.ui.elements.hintBtn.addEventListener('click', () => {
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
        this.ui.elements.closePerfectScoreBtn.addEventListener('click', () => {
            this.modal.closePerfectScore();
        });
    }

    /**
     * Setup verify button listener
     */
    setupVerifyListener() {
        this.ui.elements.verifyBtn.addEventListener('click', async () => {
            // Save grimoire content before verifying
            this.saveGrimoire();
            
            const code = this.ui.elements.editor.value;
            if (!code.trim()) return;

            this.ui.elements.verifyBtn.disabled = true;
            this.ui.elements.verifyBtn.textContent = "Casting...";
            
            try {
                const result = await verifySolution(this.state.currentPackId, this.state.currentQuestId, code);
                this.modal.showResult(result);
                
                // Update navigation buttons after quest completion
                if (!result.error && result.passed) {
                    this.quest.updateQuestNavigationButtons();
                }
            } catch (e) {
                handleApiError(e, 'verify solution');
            } finally {
                this.ui.elements.verifyBtn.disabled = false;
                this.ui.elements.verifyBtn.textContent = this.state.verifyButton || DEFAULT_TEXT.VERIFY_BUTTON;
            }
        });
    }

    /**
     * Setup start adventure button listener (for prologue)
     */
    setupNextButtonListener() {
        this.ui.elements.startAdventureBtn.addEventListener('click', () => {
            if (this.state.currentQuestId === 0) {
                this.state.currentQuestId = 1;
                this.ui.elements.startAdventureBtn.textContent = "Next Quest";
            } else {
                this.state.currentQuestId++;
            }
            this.quest.loadQuest(this.state.currentQuestId);
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
        
        // Clear storage - remove pack-specific scores
        removeLocalStorage(getPackKey(STORAGE_KEYS.TOTAL_SCORE, this.state.currentPackId));
        removeLocalStorage(getPackKey(STORAGE_KEYS.QUEST_SCORES, this.state.currentPackId));
        removeLocalStorage(getPackKey(STORAGE_KEYS.ACTIVE_QUEST_ID, this.state.currentPackId));
        
        // Reset state
        this.state.resetProgress();

        // Reset UI
        this.modal.closeRestartConfirmation();
        this.ui.setEditorReadOnly(false);
        
        // Hide perfect score button if it exists
        const perfectScoreBtn = document.getElementById('perfect-score-btn');
        if (perfectScoreBtn) {
            perfectScoreBtn.style.display = 'none';
        }
        
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
}