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

import { DEFAULT_TEXT, DEFAULT_REGO_CODE, SaveStatus } from '../services/constants.js';
import { fetchQuestHint, fetchQuestSolution } from '../services/api-service.js';
import { nextReveal } from '../services/reveal-service.js';
import { handleApiError } from '../services/error-service.js';

/**
 * Manages quest loading and navigation
 */
export class QuestManager {
    constructor(state, uiManager, autosave) {
        this.state = state;
        this.ui = uiManager;
        // The editor's pending write. A screen change replaces the editor
        // content, so an armed write must not land under the new quest.
        this.autosave = autosave;

        // Hint texts and the solution are revealed through the API, not
        // shipped with the pack payload. They are immutable while a pack is
        // open, so fetched texts are cached per pack+quest and dropped when
        // the pack visit ends (clearCaches).
        this.revealCache = new Map();

        // Reveal concurrency in one record. revealPhase is 'idle', 'restoring'
        // (re-rendering reveals from a previous session) or 'revealing'
        // (fetching the next one); revealQuestId is the quest that work
        // belongs to, and revealPromise is the running restore. Every
        // continuation checks revealStale instead of comparing the cursor by
        // hand, and a claim for another quest supersedes the running work.
        this.revealPhase = 'idle';
        this.revealQuestId = null;
        this.revealPromise = null;
    }

    /**
     * Drop what was fetched for the pack that is being left, restarted or
     * re-entered: hint and solution texts, and any reveal work still running
     * against them.
     */
    clearCaches() {
        this.revealCache.clear();
        this.revealPhase = 'idle';
        this.revealQuestId = null;
        this.revealPromise = null;
    }

    /**
     * Claim the reveal overlay for work on a quest. A claim for the same quest
     * collapses into the work already running; a claim for another quest
     * supersedes it, and the superseded continuations then find themselves
     * stale and drop.
     * @param {string} phase - 'restoring' or 'revealing'
     * @param {number} questId - Quest the work belongs to
     * @returns {boolean} false when this quest already owns the overlay
     */
    claimReveal(phase, questId) {
        if (this.revealPhase !== 'idle' && this.revealQuestId === questId) return false;

        this.revealPhase = phase;
        this.revealQuestId = questId;
        return true;
    }

    /**
     * Release the overlay, but only to the work that still owns it.
     * @param {number} questId - Quest whose work finished
     */
    endReveal(questId) {
        if (this.revealQuestId !== questId) return;

        this.revealPhase = 'idle';
        this.revealQuestId = null;
        this.revealPromise = null;
    }

    /**
     * Whether the player still stands on this quest.
     * @param {number} questId - Quest the work was started for
     * @returns {boolean} true while it is the quest on screen
     */
    isRevealTarget(questId) {
        return this.state.currentQuestId === questId;
    }

    /**
     * Whether fetched reveal text may still be applied: the player may have
     * navigated away, or another quest's work may own the overlay now.
     * @param {number} questId - Quest the fetch was made for
     * @returns {boolean} true when the result no longer belongs on screen
     */
    revealStale(questId) {
        return !this.isRevealTarget(questId) || this.revealQuestId !== questId;
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
        this.autosave.cancel();

        // A screen with no grimoire says so, rather than keeping the colour of a
        // write made on the screen the player left.
        if (!this.state.isGrimoireScreen(questId)) {
            this.ui.renderSaveStatus(SaveStatus.IDLE);
        }

        this.renderScreen(questId);

        // The footer is derived from the offers the screen just rendered
        this.ui.renderQuestFooter();
    }

    /**
     * Render the screen the cursor points at: prologue, quest or epilogue.
     */
    renderScreen(questId) {
        // Handle Prologue
        if (questId === 0) {
            this.state.enterQuest(0);
            this.showPrologue();
            return;
        }

        // Find quest using Map for O(1) lookup
        const questSummary = this.state.questsMap?.get(questId);
        if (!questSummary) {
            if (this.state.isEpilogueCursor(questId)) {
                // Past the last quest: take the epilogue transition, which
                // lands the cursor on the epilogue itself, then render it
                this.state.visitEpilogue();
                this.showEpilogue();
                return;
            }
            console.error(`Quest ${questId} not found`);
            return;
        }

        // The cursor moves before anything is drawn: the interaction gate and
        // the navigation buttons are both derived from it
        this.state.enterQuest(questId);

        this.state.currentQuest = questSummary;
        this.ui.renderQuest(this.state.currentQuest, this.state.quests.length);
        
        // Reset quest-specific state
        this.state.resetQuestState();
        
        // Reset UI
        this.ui.resetQuestUI();
        this.ui.renderInteractionGate(this.state.getInteractionGate());
        this.ui.renderQuestButtonVisibility(false);
        this.ui.renderPerfectScoreButton(false);
        this.ui.updateHintButtonText(this.state.currentQuest, 0, this.state.label('hintButton'));

        // Re-render hints revealed in a previous session
        this.restoreQuestHints(questId);
        
        // Render lore
        this.ui.renderLore(this.state.currentQuest, this.state.currentLoreIndex);

        this.loadQuestCode(questId);

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

        // Narrative stages never have support modules
        this.ui.updateSupportModulesButton(null);

        this.ui.elements.hintsList.classList.add('hidden');

        this.ui.renderInteractionGate(this.state.getInteractionGate());
        this.ui.renderPerfectScoreButton(false);

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

        this.ui.renderQuestButtonVisibility(true, this.state.label('beginAdventureButton'));
    }

    /**
     * Render the epilogue (victory screen). The transition onto it belongs to
     * GameState.visitEpilogue, which loadQuest takes before calling this, so
     * nothing here writes cursor or frontier state.
     */
    showEpilogue() {
        this.ui.elements.questCounter.textContent = DEFAULT_TEXT.EPILOGUE_LABEL;
        this.ui.elements.questTitle.textContent = DEFAULT_TEXT.EPILOGUE_TITLE;

        this.prepareNarrativeStage(
            this.state.epilogue,
            this.state.meta?.final_objective || DEFAULT_TEXT.EPILOGUE_OBJECTIVE
        );

        this.ui.renderQuestButtonVisibility(false);

        // The epilogue of a pack finished without reveals is the only screen
        // that offers the perfect-score button. Its click handler is wired
        // once in EventManager and opens ModalManager.showPerfectScore.
        if (this.state.hasPerfectScore()) {
            this.ui.renderPerfectScoreButton(true, this.state.label('perfectScoreButtonText'));
        } else {
            this.ui.renderPerfectScoreButton(false);
        }
    }

    /**
     * Update quest navigation buttons state
     */
    updateQuestNavigationButtons() {
        if (!this.ui.elements.questBackBtn || !this.ui.elements.questForwardBtn) return;

        // Hide navigation for prologue or epilogue
        if (this.state.currentQuestId === 0 || this.state.isEpilogueCursor()) {
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
        if (!this.state.rewindQuest()) return;

        this.loadQuest(this.state.currentQuestId);
    }

    /**
     * Navigate to next quest, under the same forward rule that enables the
     * button
     */
    navigateToNextQuest() {
        if (!this.state.canNavigateForward()) return;

        this.state.advanceQuest();
        this.loadQuest(this.state.currentQuestId);
    }

    /**
     * Proceed to the next quest of the linear flow: the prologue's begin
     * button and the result dialog's next quest button. It may step past a
     * completed frontier quest, which the arrow guard deliberately refuses.
     */
    proceedToNextQuest() {
        if (!this.state.advanceQuest()) return false;

        this.loadQuest(this.state.currentQuestId);
        return true;
    }

    /**
     * Leave the prologue on the player's request. The screen that replaces it
     * withdraws the adventure offer and recomputes the footer; a pack with
     * nothing to advance to withdraws the offer here instead.
     * @returns {boolean} true when a screen replaced the prologue
     */
    leavePrologue() {
        if (this.proceedToNextQuest()) return true;

        this.ui.renderQuestButtonVisibility(false);
        this.ui.renderQuestFooter();
        return false;
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
     * Re-render the hints and the solution that were revealed in a previous
     * session for this quest, so a reload does not hide them while their score
     * penalty persists. The stored accounting is applied whether or not the
     * texts arrive: a failed refetch reports the failure and still counts the
     * reveals the player already paid for, so the next reveal is the one they
     * have not bought.
     * @param {number} questId - The quest identifier
     * @returns {Promise<void>|null} the running restore, or null when this
     *   quest has nothing stored
     */
    restoreQuestHints(questId) {
        const saved = this.state.loadQuestHintState(questId);
        if (!saved || (!saved.hintsUsed && !saved.solutionViewed)) return null;

        if (!this.claimReveal('restoring', questId)) return this.revealPromise;

        this.revealPromise = (async () => {
            const totalHints = this.state.currentQuest?.hints_count ?? 0;
            const hintsToRestore = Math.min(saved.hintsUsed, totalHints);

            try {
                const cache = this.getCachedReveals(questId);
                const loads = [];
                for (let i = 0; i < hintsToRestore; i++) {
                    loads.push(this.loadHintText(questId, i + 1));
                }
                await Promise.all(loads);

                if (!this.revealStale(questId)) {
                    for (let i = 0; i < hintsToRestore; i++) {
                        this.appendHintItem(cache.hints[i]);
                    }

                    if (saved.solutionViewed && this.state.currentQuest?.has_solution) {
                        const solution = await this.loadSolutionText(questId);
                        if (!this.revealStale(questId)) {
                            this.appendSolutionItem(solution);
                        }
                    }
                }
            } catch (error) {
                handleApiError(error, 'restore hints');
            } finally {
                if (!this.revealStale(questId)) {
                    this.applyStoredReveals(saved);
                }
                this.endReveal(questId);
            }
        })();

        return this.revealPromise;
    }

    /**
     * Put the stored reveal accounting on the screen: the counters of the
     * reveals already paid for, the button label that reflects them, and the
     * button's visibility once the solution was revealed.
     * @param {Object} saved - {hintsUsed, solutionViewed} as stored
     */
    applyStoredReveals(saved) {
        this.state.currentQuestHintsUsed = saved.hintsUsed;
        this.state.currentQuestSolutionViewed = saved.solutionViewed;

        if (saved.solutionViewed && this.state.currentQuest?.has_solution) {
            this.ui.elements.hintBtn.classList.add('hidden');
        }

        if (saved.hintsUsed > 0) {
            this.ui.updateHintButtonText(
                this.state.currentQuest, saved.hintsUsed, this.state.label('hintButton')
            );
        }
    }

    /**
     * Show the next hint or the solution. Both are fetched from the API:
     * the pack payload only describes how many hints exist and whether a
     * solution is available.
     */
    async showHint() {
        const quest = this.state.currentQuest;
        if (!quest) return;

        const questId = this.state.currentQuestId;
        if (this.revealPhase === 'restoring' && this.revealQuestId === questId) {
            // A restore renders this quest's reveals and applies its stored
            // accounting; wait for it rather than race it
            await this.revealPromise;
        }
        if (!this.isRevealTarget(questId)) return;

        const hintsUsed = this.state.currentQuestHintsUsed;
        // The reveal progression is defined once in reveal-service so
        // the button label, the confirmation dialog, and this flow
        // always agree on what comes next.
        const reveal = nextReveal(quest, hintsUsed, this.state.currentQuestSolutionViewed);
        if (!reveal) return;

        if (!this.claimReveal('revealing', questId)) return;

        try {
            if (reveal.kind === 'hint') {
                const text = await this.loadHintText(questId, reveal.hintId);
                if (this.revealStale(questId)) return;

                this.appendHintItem(text);
                this.state.currentQuestHintsUsed++;
                this.state.persistQuestHintState();
                this.ui.updateHintButtonText(quest, hintsUsed + 1, this.state.label('hintButton'));
            } else {
                const solution = await this.loadSolutionText(questId);
                if (this.revealStale(questId)) return;

                this.appendSolutionItem(solution);
                this.state.currentQuestSolutionViewed = true;
                this.state.persistQuestHintState();
                this.ui.elements.hintBtn.classList.add('hidden');
            }
        } catch (error) {
            handleApiError(error, 'reveal hint');
        } finally {
            this.endReveal(questId);
        }
    }
}