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
 * Quest Manager
 * Handles quest loading, navigation, and state management
 */

import { getLocalStorage, setLocalStorage, getPackKey, STORAGE_KEYS } from '../services/storage-service.js';
import { DEFAULT_TEXT, DEFAULT_REGO_CODE } from '../services/constants.js';

/**
 * Manages quest loading and navigation
 */
export class QuestManager {
    constructor(state, uiManager) {
        this.state = state;
        this.ui = uiManager;
    }

    /**
     * Load and display a quest
     * @param {number} questId - Quest ID to load (0 = prologue, > quests.length = epilogue, 1-quests.length = actual quests)
     */
    loadQuest(questId) {
        // Handle Prologue
        if (questId === 0) {
            this.showPrologue();
            setLocalStorage(getPackKey(STORAGE_KEYS.QUEST_ID, this.state.currentPackId), 0);
            return;
        }

        // Find quest in list
        const questSummary = this.state.quests.find(q => q.id === questId);
        if (!questSummary) {
            if (this.state.quests.length > 0 && questId > this.state.quests.length) {
                // Completed all quests - show epilogue
                this.showEpilogue();
                setLocalStorage(getPackKey(STORAGE_KEYS.QUEST_ID, this.state.currentPackId), questId);
                return;
            }
            console.error(`Quest ${questId} not found`);
            return;
        }

        this.state.currentQuest = questSummary;
        this.ui.renderQuest(this.state.currentQuest, this.state.quests.length);
        
        // Reset quest-specific state
        this.state.resetQuestState();
        
        // Reset UI
        this.ui.resetQuestUI();
        this.ui.updateQuestFooterVisibility();
        this.ui.updateHintButtonText(this.state.currentQuest, 0, this.state.hintButton);
        
        // Render lore
        this.ui.renderLore(this.state.currentQuest, this.state.currentLoreIndex);

        // Check if this quest is in history mode
        const isCompleted = this.state.questScores[questId] !== undefined;
        const isActiveQuest = (questId === this.state.activeQuestId);
        this.state.isHistoryMode = isCompleted && !isActiveQuest;
        
        // Load code
        this.loadQuestCode(questId);
        
        // Set read-only mode for history
        if (this.state.isHistoryMode) {
            this.ui.setEditorReadOnly(true);
        }
        
        // Update navigation
        this.state.setCurrentQuest(questId);
        this.updateQuestNavigationButtons();
    }

    /**
     * Load code for a quest (saved code or template)
     * @param {number} questId - Quest ID
     */
    loadQuestCode(questId) {
        const questGrimoireKey = getPackKey(`rego_grimoire_q${questId}`, this.state.currentPackId);
        const savedCode = getLocalStorage(questGrimoireKey);
        
        if (savedCode) {
            this.ui.elements.editor.value = savedCode;
        } else if (this.state.currentQuest.apply_template && this.state.currentQuest.template) {
            this.ui.elements.editor.value = this.state.currentQuest.template;
        } else {
            this.ui.elements.editor.value = DEFAULT_REGO_CODE;
        }
    }

    /**
     * Show prologue
     */
    showPrologue() {
        this.ui.elements.questCounter.textContent = DEFAULT_TEXT.PROLOGUE_LABEL;
        this.ui.elements.questTitle.textContent = this.state.meta?.title || DEFAULT_TEXT.PROLOGUE_TITLE;
        
        this.state.currentQuest = {
            description_lore: this.state.prologue
        };
        
        this.state.currentLoreIndex = 0;
        this.ui.renderLore(this.state.currentQuest, this.state.currentLoreIndex);

        this.ui.elements.questTask.textContent = this.state.meta?.initial_objective || DEFAULT_TEXT.PROLOGUE_OBJECTIVE;
        this.ui.setEditorReadOnly(true);
        
        // Hide unnecessary elements
        this.ui.elements.outcomeArea.classList.add('hidden');
        this.ui.elements.hintsList.classList.add('hidden');
        this.ui.elements.editorPane.classList.add('hidden');

        // Show Start Adventure button
        this.ui.elements.startAdventureBtn.classList.remove('hidden');
        this.ui.elements.startAdventureBtn.textContent = this.state.beginAdventureButton || DEFAULT_TEXT.BEGIN_ADVENTURE;
        
        // Move start adventure button to quest footer
        const footer = document.querySelector('.quest-footer');
        if (footer) {
            footer.appendChild(this.ui.elements.startAdventureBtn);
        }
        this.ui.updateQuestFooterVisibility();
        
        // Hide navigation buttons for prologue
        this.updateQuestNavigationButtons();
    }

    /**
     * Show epilogue (victory screen)
     */
    showEpilogue() {
        this.ui.elements.questCounter.textContent = DEFAULT_TEXT.EPILOGUE_LABEL;
        this.ui.elements.questTitle.textContent = DEFAULT_TEXT.EPILOGUE_TITLE;
        
        // Set state
        this.state.currentQuestId = this.state.quests.length + 1;
        this.state.activeQuestId = this.state.currentQuestId;
        this.state.isHistoryMode = false;
        
        // Epilogue lore
        this.state.currentQuest = {
            description_lore: this.state.epilogue
        };
        
        this.state.currentLoreIndex = 0;
        this.ui.renderLore(this.state.currentQuest, this.state.currentLoreIndex);

        this.ui.elements.questTask.textContent = this.state.meta?.final_objective || DEFAULT_TEXT.EPILOGUE_OBJECTIVE;
        this.ui.setEditorReadOnly(true);
        
        // Hide unnecessary elements
        this.ui.elements.outcomeArea.classList.add('hidden');
        this.ui.elements.startAdventureBtn.classList.add('hidden');
        this.ui.elements.hintsList.classList.add('hidden');
        this.ui.elements.editorPane.classList.add('hidden');
        
        // Update navigation
        this.updateQuestNavigationButtons();
        
        // Check for perfect score
        if (this.state.hasPerfectScore()) {
            this.showPerfectScoreButton();
        } else {
            this.ui.updateQuestFooterVisibility();
        }
    }

    /**
     * Show perfect score button
     */
    showPerfectScoreButton() {
        const perfectScoreBtn = document.getElementById('perfect-score-btn');
        if (!perfectScoreBtn) return;
        
        perfectScoreBtn.textContent = this.state.perfectScoreButtonText || DEFAULT_TEXT.PERFECT_SCORE_BUTTON;
        perfectScoreBtn.style.display = 'inline-block';
        
        if (!perfectScoreBtn.hasAttribute('data-handler-attached')) {
            perfectScoreBtn.addEventListener('click', () => {
                this.showPerfectScoreModal();
            });
            perfectScoreBtn.setAttribute('data-handler-attached', 'true');
        }
        
        this.ui.updateQuestFooterVisibility();
    }

    /**
     * Show perfect score modal
     */
    showPerfectScoreModal() {
        this.ui.elements.perfectScoreImage.src = `/quests/${this.state.currentPackId}/assets/perfect_score.png`;
        this.ui.elements.perfectScoreImage.onerror = () => {
            this.ui.elements.perfectScoreImage.src = `/quests/${this.state.currentPackId}/assets/icon-success.png`;
        };
        
        this.ui.elements.perfectScoreMessage.innerHTML = this.ui.parseMarkdown(this.state.perfectScoreMessage);
        this.ui.elements.perfectScoreModal.classList.remove('hidden');
        this.ui.elements.closePerfectScoreBtn.focus();
    }

    /**
     * Update quest navigation buttons state
     */
    updateQuestNavigationButtons() {
        if (!this.ui.elements.questBackBtn || !this.ui.elements.questForwardBtn) return;
        
        // Hide navigation for prologue or epilogue
        if (this.state.currentQuestId === 0 || this.state.currentQuestId > this.state.quests.length) {
            this.ui.elements.questBackBtn.style.display = 'none';
            this.ui.elements.questForwardBtn.style.display = 'none';
            return;
        }
        
        // Show buttons for actual quests
        this.ui.elements.questBackBtn.style.display = 'inline-block';
        this.ui.elements.questForwardBtn.style.display = 'inline-block';
        
        // Enable/disable based on availability
        this.ui.elements.questBackBtn.disabled = !this.state.canNavigateBack();
        this.ui.elements.questForwardBtn.disabled = !this.state.canNavigateForward();
    }

    /**
     * Navigate to previous quest
     */
    navigateToPreviousQuest() {
        if (this.state.currentQuestId > 1) {
            if (!this.state.isHistoryMode) {
                this.state.activeQuestId = this.state.currentQuestId;
            }
            this.state.currentQuestId--;
            this.state.isHistoryMode = true;
            this.loadQuest(this.state.currentQuestId);
        }
    }

    /**
     * Navigate to next quest
     */
    navigateToNextQuest() {
        const maxForwardQuest = this.state.isHistoryMode ? this.state.activeQuestId : this.state.quests.length;
        
        if (this.state.currentQuestId < maxForwardQuest) {
            this.state.currentQuestId++;
            
            if (this.state.currentQuestId === this.state.activeQuestId) {
                this.state.isHistoryMode = false;
            }
            
            this.loadQuest(this.state.currentQuestId);
        }
    }

    /**
     * Proceed to next quest (after completion or from prologue)
     */
    proceedToNextQuest() {
        this.state.isHistoryMode = false;
        
        if (this.state.currentQuestId === 0) {
            this.state.currentQuestId = 1;
        } else {
            this.state.currentQuestId++;
        }
        
        this.state.activeQuestId = this.state.currentQuestId;
        setLocalStorage(getPackKey(STORAGE_KEYS.ACTIVE_QUEST_ID, this.state.currentPackId), this.state.activeQuestId);
        
        this.loadQuest(this.state.currentQuestId);
    }

    /**
     * Navigate lore pages
     * @param {string} direction - 'prev' or 'next'
     */
    navigateLore(direction) {
        if (!this.state.currentQuest || !Array.isArray(this.state.currentQuest.description_lore)) return;
        
        const lore = this.state.currentQuest.description_lore;
        
        if (direction === 'prev' && this.state.currentLoreIndex > 0) {
            this.state.currentLoreIndex--;
            this.ui.renderLore(this.state.currentQuest, this.state.currentLoreIndex);
        } else if (direction === 'next' && this.state.currentLoreIndex < lore.length - 1) {
            this.state.currentLoreIndex++;
            this.ui.renderLore(this.state.currentQuest, this.state.currentLoreIndex);
        }
    }

    /**
     * Show next hint or solution
     */
    showHint() {
        if (!this.state.currentQuest || !this.state.currentQuest.hints) return;
        
        this.ui.elements.hintsList.classList.remove('hidden');
        const currentHintsCount = this.ui.elements.hintsList.children.length;
        const totalHints = this.state.currentQuest.hints.length;
        
        if (currentHintsCount < totalHints) {
            // Show next hint
            const template = document.getElementById('hint-item-template');
            const hintItem = template.content.cloneNode(true);
            hintItem.querySelector('code').textContent = this.state.currentQuest.hints[currentHintsCount];
            this.ui.elements.hintsList.appendChild(hintItem);
            
            this.state.currentQuestHintsUsed++;
            this.ui.updateHintButtonText(this.state.currentQuest, currentHintsCount + 1, this.state.hintButton);
        } else if (this.state.currentQuest.solution) {
            // Show solution
            const template = document.getElementById('hint-solution-template');
            const solutionItem = template.content.cloneNode(true);
            solutionItem.querySelector('code').textContent = this.state.currentQuest.solution;
            this.ui.elements.hintsList.appendChild(solutionItem);
            
            this.state.currentQuestSolutionViewed = true;
            this.ui.elements.hintBtn.style.display = 'none';
            this.ui.updateQuestFooterVisibility();
        }
    }
}