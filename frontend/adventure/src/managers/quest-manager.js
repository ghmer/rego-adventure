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

import { DEFAULT_TEXT, DEFAULT_REGO_CODE } from '../services/constants.js';
import { fetchQuestHint, fetchQuestSolution } from '../services/api-service.js';
import { handleApiError } from '../services/error-service.js';

/**
 * Manages quest loading and navigation
 */
export class QuestManager {
    constructor(state, uiManager) {
        this.state = state;
        this.ui = uiManager;

        // Hint texts and the solution are revealed through the API, not
        // shipped with the pack payload. They are immutable per pack load,
        // so fetched texts are cached per pack+quest. The in-flight flag
        // collapses double clicks while a fetch is running; restorePromise
        // lets showHint wait for an in-flight restore instead of racing it.
        this.revealCache = new Map();
        this.hintRequestInFlight = false;
        this.restorePromise = null;
    }

    /**
     * Get (or create) the reveal cache entry for a quest
     * @param {number} questId - The quest identifier
     * @returns {Object} { hints: string[], solution: string|null }
     */
    getCachedReveals(questId) {
        const key = `${this.state.currentPackId}:${questId}`;
        let entry = this.revealCache.get(key);
        if (!entry) {
            entry = { hints: [], solution: null };
            this.revealCache.set(key, entry);
        }
        return entry;
    }

    /**
     * Load a single hint text by its 1-based ID, from cache when available
     * @param {number} questId - The quest identifier
     * @param {number} hintId - The 1-based hint identifier
     * @returns {Promise<string>} The hint text
     * @throws {ApiError} If the request fails
     */
    async loadHintText(questId, hintId) {
        const cache = this.getCachedReveals(questId);
        const cached = cache.hints[hintId - 1];
        if (typeof cached === 'string') return cached;

        const data = await fetchQuestHint(this.state.currentPackId, questId, hintId);
        cache.hints[hintId - 1] = data.hint;
        return data.hint;
    }

    /**
     * Load the solution text, from cache when available
     * @param {number} questId - The quest identifier
     * @returns {Promise<string>} The solution code
     * @throws {ApiError} If the request fails
     */
    async loadSolutionText(questId) {
        const cache = this.getCachedReveals(questId);
        if (cache.solution !== null) return cache.solution;

        const data = await fetchQuestSolution(this.state.currentPackId, questId);
        cache.solution = data.solution;
        return data.solution;
    }

    /**
     * Append a revealed hint item to the hints list
     * @param {string} text - The hint text
     */
    appendHintItem(text) {
        const template = document.getElementById('hint-item-template');
        const hintItem = template.content.cloneNode(true);
        hintItem.querySelector('code').textContent = text;
        this.ui.elements.hintsList.classList.remove('hidden');
        this.ui.elements.hintsList.appendChild(hintItem);
    }

    /**
     * Append the revealed solution item to the hints list
     * @param {string} text - The solution code
     */
    appendSolutionItem(text) {
        const template = document.getElementById('hint-solution-template');
        const solutionItem = template.content.cloneNode(true);
        solutionItem.querySelector('code').textContent = text;
        this.ui.elements.hintsList.classList.remove('hidden');
        this.ui.elements.hintsList.appendChild(solutionItem);
    }

    /**
     * Load and display a quest
     * @param {number} questId - Quest ID to load (0 = prologue, > quests.length = epilogue, 1-quests.length = actual quests)
     */
    loadQuest(questId) {
        // Handle Prologue
        if (questId === 0) {
            this.showPrologue();
            this.state.setCurrentQuest(0);
            return;
        }

        // Find quest using Map for O(1) lookup
        const questSummary = this.state.questsMap?.get(questId);
        if (!questSummary) {
            if (this.state.quests.length > 0 && questId > this.state.quests.length) {
                // Completed all quests - show epilogue
                this.showEpilogue();
                this.state.setCurrentQuest(questId);
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
        this.ui.updateHintButtonText(this.state.currentQuest, 0, this.state.label('hintButton'));

        // Re-render hints revealed in a previous session
        this.restoreQuestHints(questId);
        
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
        const savedCode = this.state.loadGrimoire(questId);
        
        if (savedCode) {
            this.ui.setEditorValue(savedCode);
        } else if (this.state.currentQuest.apply_template && this.state.currentQuest.template) {
            this.ui.setEditorValue(this.state.currentQuest.template);
        } else {
            this.ui.setEditorValue(DEFAULT_REGO_CODE);
        }
    }

    /**
     * Prepare the editor area for a narrative screen (prologue/epilogue):
     * render its lore, hide quest-only elements, refresh navigation
     * @param {string[]} lore - Narrative lore paragraphs
     * @param {string} taskText - Objective text for the narrative screen
     */
    prepareNarrativeStage(lore, taskText) {
        this.state.currentQuest = {
            description_lore: lore
        };

        this.state.currentLoreIndex = 0;
        this.ui.renderLore(this.state.currentQuest, this.state.currentLoreIndex);

        this.ui.elements.questTask.textContent = taskText;
        this.ui.setEditorReadOnly(true);

        // Narrative stages never have support modules
        this.ui.updateSupportModulesButton(null);

        this.ui.elements.outcomeArea.classList.add('hidden');
        this.ui.elements.hintsList.classList.add('hidden');
        this.ui.elements.editorPane.classList.add('hidden');

        this.updateQuestNavigationButtons();
    }

    /**
     * Show prologue
     */
    showPrologue() {
        this.ui.elements.questCounter.textContent = DEFAULT_TEXT.PROLOGUE_LABEL;
        this.ui.elements.questTitle.textContent = this.state.meta?.title || DEFAULT_TEXT.PROLOGUE_TITLE;

        this.prepareNarrativeStage(
            this.state.prologue,
            this.state.meta?.initial_objective || DEFAULT_TEXT.PROLOGUE_OBJECTIVE
        );

        // Show Start Adventure button
        this.ui.elements.startAdventureBtn.classList.remove('hidden');
        this.ui.elements.startAdventureBtn.textContent = this.state.label('beginAdventureButton');

        // Move start adventure button to quest footer
        const footer = document.querySelector('.quest-footer');
        if (footer) {
            footer.appendChild(this.ui.elements.startAdventureBtn);
        }
        this.ui.updateQuestFooterVisibility();
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

        this.prepareNarrativeStage(
            this.state.epilogue,
            this.state.meta?.final_objective || DEFAULT_TEXT.EPILOGUE_OBJECTIVE
        );

        this.ui.elements.startAdventureBtn.classList.add('hidden');

        // Check for perfect score
        if (this.state.hasPerfectScore()) {
            this.showPerfectScoreButton();
        } else {
            this.ui.updateQuestFooterVisibility();
        }
    }

    /**
     * Show perfect score button (visibility only; the click handler is
     * wired once in EventManager and opens ModalManager.showPerfectScore)
     */
    showPerfectScoreButton() {
        const perfectScoreBtn = this.ui.elements.perfectScoreBtn;
        if (!perfectScoreBtn) return;

        perfectScoreBtn.textContent = this.state.label('perfectScoreButtonText');
        perfectScoreBtn.classList.remove('hidden');

        this.ui.updateQuestFooterVisibility();
    }

    /**
     * Update quest navigation buttons state
     */
    updateQuestNavigationButtons() {
        if (!this.ui.elements.questBackBtn || !this.ui.elements.questForwardBtn) return;

        // Hide navigation for prologue or epilogue
        if (this.state.currentQuestId === 0 || this.state.currentQuestId > this.state.quests.length) {
            this.ui.elements.questBackBtn.classList.add('hidden');
            this.ui.elements.questForwardBtn.classList.add('hidden');
            return;
        }

        // Show buttons for actual quests
        this.ui.elements.questBackBtn.classList.remove('hidden');
        this.ui.elements.questForwardBtn.classList.remove('hidden');
        
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
     * Re-render hints (and optionally the solution) that were revealed in
     * a previous session for the given quest, so a page reload does not
     * hide them while their score penalty persists. Hint texts are fetched
     * from the API (cached after the first fetch). The promise is stored
     * on restorePromise so a concurrent showHint waits for it.
     * @param {number} questId - The quest identifier
     * @returns {Promise<void>} Resolves when the restore has been applied
     */
    restoreQuestHints(questId) {
        this.restorePromise = (async () => {
            const saved = this.state.loadQuestHintState(questId);
            if (!saved || (!saved.hintsUsed && !saved.solutionViewed)) return;

            const totalHints = this.state.currentQuest?.hints_count ?? 0;
            const hintsToRestore = Math.min(saved.hintsUsed, totalHints);

            try {
                const cache = this.getCachedReveals(questId);
                const loads = [];
                for (let i = 0; i < hintsToRestore; i++) {
                    loads.push(this.loadHintText(questId, i + 1));
                }
                await Promise.all(loads);
                // The user may have navigated elsewhere while hints were loading
                if (this.state.currentQuestId !== questId) return;

                for (let i = 0; i < hintsToRestore; i++) {
                    this.appendHintItem(cache.hints[i]);
                }

                if (saved.solutionViewed && this.state.currentQuest?.has_solution) {
                    const solution = await this.loadSolutionText(questId);
                    if (this.state.currentQuestId !== questId) return;
                    this.appendSolutionItem(solution);
                    this.ui.elements.hintBtn.classList.add('hidden');
                }

                this.state.currentQuestHintsUsed = saved.hintsUsed;
                this.state.currentQuestSolutionViewed = saved.solutionViewed;

                if (saved.hintsUsed > 0 && !saved.solutionViewed) {
                    this.ui.updateHintButtonText(this.state.currentQuest, saved.hintsUsed, this.state.label('hintButton'));
                }
                this.ui.updateQuestFooterVisibility();
            } catch (error) {
                handleApiError(error, 'restore hints');
            }
        })();
        return this.restorePromise;
    }

    /**
     * Show the next hint or the solution. Both are fetched from the API:
     * the pack payload only describes how many hints exist and whether a
     * solution is available.
     */
    async showHint() {
        const quest = this.state.currentQuest;
        if (!quest || this.hintRequestInFlight) return;

        this.hintRequestInFlight = true;
        try {
            const questId = this.state.currentQuestId;
            if (this.restorePromise) {
                // A restore in progress renders revealed hints itself;
                // wait for it so the same hint is never rendered twice
                await this.restorePromise;
                if (this.state.currentQuestId !== questId) return;
            }
            const hintsUsed = this.state.currentQuestHintsUsed;
            const totalHints = quest.hints_count ?? 0;

            if (hintsUsed < totalHints) {
                // Show next hint
                const text = await this.loadHintText(questId, hintsUsed + 1);
                if (this.state.currentQuestId !== questId) return;
                if (this.state.currentQuestHintsUsed !== hintsUsed) return;
                this.appendHintItem(text);

                this.state.currentQuestHintsUsed++;
                this.state.persistQuestHintState();
                this.ui.updateHintButtonText(quest, hintsUsed + 1, this.state.label('hintButton'));
            } else if (quest.has_solution && !this.state.currentQuestSolutionViewed) {
                // Show solution
                const solution = await this.loadSolutionText(questId);
                if (this.state.currentQuestId !== questId) return;
                if (this.state.currentQuestSolutionViewed) return;
                this.appendSolutionItem(solution);

                this.state.currentQuestSolutionViewed = true;
                this.state.persistQuestHintState();
                this.ui.elements.hintBtn.classList.add('hidden');
                this.ui.updateQuestFooterVisibility();
            }
        } catch (error) {
            handleApiError(error, 'reveal hint');
        } finally {
            this.hintRequestInFlight = false;
        }
    }
}