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
 * State Service
 * Manages game state with encapsulation and persistence
 */

import { getLocalStorage, setLocalStorage, removeLocalStorage, getPackKey, STORAGE_KEYS } from './storage-service.js';
import { SCORING, DEFAULT_TEXT } from './constants.js';

/**
 * Maps label accessor keys to the pack's snake_case ui_labels key and
 * the matching DEFAULT_TEXT fallback key
 */
const LABEL_KEYS = {
    grimoireTitle: { ui: 'grimoire_title', fallback: 'GRIMOIRE_TITLE' },
    hintButton: { ui: 'hint_button', fallback: 'HINT_BUTTON' },
    verifyButton: { ui: 'verify_button', fallback: 'VERIFY_BUTTON' },
    verifying: { ui: 'verifying', fallback: 'VERIFYING' },
    messageSuccess: { ui: 'message_success', fallback: 'MESSAGE_SUCCESS' },
    messageFailure: { ui: 'message_failure', fallback: 'MESSAGE_FAILURE' },
    perfectScoreMessage: { ui: 'perfect_score_message', fallback: 'PERFECT_SCORE_MESSAGE' },
    perfectScoreButtonText: { ui: 'perfect_score_button_text', fallback: 'PERFECT_SCORE_BUTTON' },
    beginAdventureButton: { ui: 'begin_adventure_button', fallback: 'BEGIN_ADVENTURE' }
};

/**
 * Game State Manager
 * Handles all game state operations with automatic persistence
 */
export class GameState {
    constructor() {
        this.initNoPackState();
        this.currentPackId = getLocalStorage(STORAGE_KEYS.PACK_ID);

        // Load pack-specific data if pack is set
        if (this.currentPackId) {
            this.loadPackState(this.currentPackId);
        }
    }

    /**
     * The state shape when no pack is loaded. The constructor and a rolled
     * back pack entry both end here, so neither can leave a pack-scoped field
     * behind.
     */
    initNoPackState() {
        this.currentPackId = null;

        this.quests = [];
        this.questsMap = new Map(); // Map for O(1) quest lookup by ID
        this.prologue = [];
        this.epilogue = [];
        this.meta = null;
        this.currentQuest = null;
        this.currentQuestId = 0;
        this.currentLoreIndex = 0;

        // Scoring
        this.totalScore = 0;
        this.questScores = {};
        this.currentQuestHintsUsed = 0;
        this.currentQuestSolutionViewed = false;

        // Per-quest persisted maps (part of the packed state)
        this.questHints = {};
        this.grimoires = {};

        // Navigation
        this.isHistoryMode = false;
        this.activeQuestId = 0;

        // UI Labels (loaded from pack metadata; accessed via label())
        this.uiLabels = {};
    }

    /**
     * Load state for a specific pack from localStorage
     * @param {string} packId - The pack identifier
     * @returns {Object|null} The loaded batched state, or null when no
     * valid saved state exists
     */
    loadPackState(packId) {
        const packedState = getLocalStorage(getPackKey(STORAGE_KEYS.PACK_STATE, packId), null);

        if (packedState) {
            try {
                const state = JSON.parse(packedState);
                this.currentQuestId = state.questId || 0;
                this.questScores = state.questScores || {};
                this.questHints = state.questHints || {};
                this.grimoires = state.grimoires || {};
                this.activeQuestId = state.activeQuestId || this.currentQuestId;

                // totalScore is derived from the quest records, so a stored
                // total that drifted from them is corrected on load. The
                // field is still written on save for readers that predate the
                // derivation.
                this.totalScore = this.sumQuestScores();
                return state;
            } catch (e) {
                console.warn(`Ignoring corrupt saved state for pack "${packId}":`, e);
                return null;
            }
        }

        return null;
    }

    /**
     * Set the current pack and initialize its state
     * @param {string} packId - The pack identifier
     * @returns {Object|null} The loaded batched state when resuming an
     * adventure, or null when starting fresh (state was reset)
     */
    setCurrentPack(packId) {
        this.currentPackId = packId;
        setLocalStorage(STORAGE_KEYS.PACK_ID, packId);

        const loaded = this.loadPackState(packId);
        if (!loaded || !loaded.questId) {
            // Starting new adventure - reset everything
            this.currentQuestId = 0;
            this.activeQuestId = 0;
            this.totalScore = 0;
            this.questScores = {};
            this.questHints = {};
            this.grimoires = {};
            this.savePackState();
            return null;
        }

        return loaded;
    }

    /**
     * Leave the current adventure: flush progress and clear the active
     * pack pointer so the next page load starts at the pack selection
     * screen instead of resuming this pack. The packed state itself is
     * kept, so re-entering the pack still resumes the progress.
     */
    clearCurrentPack() {
        if (!this.currentPackId) return;

        this.savePackState();
        removeLocalStorage(STORAGE_KEYS.PACK_ID);
        this.currentPackId = null;
    }

    /**
     * Discard a pack entry whose details never finished loading. The pointer
     * and every pack-scoped field in memory go with it; nothing is written,
     * so saved bodies on disk stay exactly as they were. Without this, a
     * failed entry leaves the pointer on a pack that was never loaded and
     * the previously loaded pack's quests behind. A fresh body written while
     * the entry was being made is left alone; it holds no progress.
     */
    rollbackPackEntry() {
        if (!this.currentPackId) return;

        removeLocalStorage(STORAGE_KEYS.PACK_ID);
        this.initNoPackState();
    }

    /**
     * Save current pack state to localStorage
     */
    savePackState() {
        if (!this.currentPackId) return;
        
        // Batch all state into a single JSON object
        const state = {
            questId: this.currentQuestId,
            totalScore: this.totalScore,
            questScores: this.questScores,
            questHints: this.questHints,
            grimoires: this.grimoires,
            activeQuestId: this.activeQuestId
        };
        
        setLocalStorage(
            getPackKey(STORAGE_KEYS.PACK_STATE, this.currentPackId),
            JSON.stringify(state)
        );
    }
    
    /**
     * Load pack details (quests, prologue, epilogue, metadata)
     * @param {Object} packData - Pack data from API
     */
    loadPackData(packData) {
        this.quests = packData.quests;

        // Create Map for O(1) quest lookup by ID
        this.questsMap = new Map();
        if (packData.quests) {
            for (const quest of packData.quests) {
                this.questsMap.set(quest.id, quest);
            }
        }

        this.prologue = packData.prologue;
        this.epilogue = packData.epilogue;
        this.meta = packData.meta;

        this.uiLabels = packData.ui_labels || {};
    }

    /**
     * Get a UI label from the pack metadata, falling back to the
     * application default when the pack does not define it
     * @param {string} key - Label key (see LABEL_KEYS)
     * @returns {string} The label text
     */
    label(key) {
        const keys = LABEL_KEYS[key];
        return this.uiLabels[keys.ui] || DEFAULT_TEXT[keys.fallback];
    }
    
    // Progression. The cursor (currentQuestId), the frontier (activeQuestId)
    // and the per-quest records (questScores) are written only by the
    // operations of this section and by completeQuest. The history mode is
    // never stored: it follows the cursor.

    /**
     * Move the cursor onto a quest or narrative screen and derive its mode
     * @param {number} questId - Quest identifier, 0 for the prologue
     */
    enterQuest(questId) {
        this.currentQuestId = questId;
        this.deriveHistoryMode();
        this.savePackState();
    }

    /**
     * Move one quest forward in the linear flow: from the prologue onto the
     * first quest, or from a quest onto its successor. The frontier only ever
     * grows, and it stops at the last quest - the epilogue sentinel belongs
     * to visitEpilogue.
     *
     * Whether a move is allowed is the caller's decision: the arrow actions
     * consult canNavigateForward, while the flow action (begin adventure, the
     * result dialog's next quest) may step past a completed frontier quest.
     * @returns {boolean} false when the cursor already sits on the epilogue
     */
    advanceQuest() {
        const target = this.currentQuestId === 0 ? 1 : this.currentQuestId + 1;
        if (target > this.quests.length + 1) return false;

        this.currentQuestId = target;
        if (target <= this.quests.length && target > this.activeQuestId) {
            this.activeQuestId = target;
        }

        this.deriveHistoryMode();
        this.savePackState();
        return true;
    }

    /**
     * Move one screen back, under the back rule. Navigating never lowers the
     * frontier. Unlike advancing, rewinding has no action that may legitimately
     * step against the guard, so the transition asks it directly.
     * @returns {boolean} false when the back rule refuses the step
     */
    rewindQuest() {
        if (!this.canNavigateBack()) return false;

        this.currentQuestId -= 1;
        this.deriveHistoryMode();
        this.savePackState();
        return true;
    }

    /**
     * Take the transition onto the epilogue: cursor and frontier both land
     * past the last quest, which makes the epilogue the resume target of the
     * pack. Render paths do not write this; loadQuest performs the transition
     * before it renders the epilogue.
     */
    visitEpilogue() {
        this.currentQuestId = this.quests.length + 1;
        this.activeQuestId = this.currentQuestId;
        this.deriveHistoryMode();
        this.savePackState();
    }

    /**
     * Derive the mode of the quest the cursor stands on: a completed quest
     * behind the frontier is history and read-only, everything else is
     * playable - including a completed frontier quest, which is the only
     * legitimate way to play a quest twice.
     */
    deriveHistoryMode() {
        const isCompleted = this.questScores[this.currentQuestId] !== undefined;
        this.isHistoryMode = isCompleted && this.currentQuestId !== this.activeQuestId;
    }
    
    /**
     * Reset quest-specific state (hints, solution viewed)
     */
    resetQuestState() {
        this.currentQuestHintsUsed = 0;
        this.currentQuestSolutionViewed = false;
        this.currentLoreIndex = 0;
    }

    /**
     * Persist the revealed hint state of the current quest so it survives
     * page reloads (the in-memory counters alone reset on refresh)
     */
    persistQuestHintState() {
        if (!this.currentPackId || this.currentQuestId <= 0) return;

        this.questHints[this.currentQuestId] = {
            hintsUsed: this.currentQuestHintsUsed,
            solutionViewed: this.currentQuestSolutionViewed
        };
        this.savePackState();
    }

    /**
     * Load the persisted hint state for a quest. In-progress quests keep
     * their state in the questHints map; completed quests keep it in the
     * quest score recorded on completion.
     * @param {number} [questId] - The quest identifier; defaults to the
     * current quest
     * @returns {Object|null} {hintsUsed, solutionViewed} or null when no
     * valid saved state exists
     */
    loadQuestHintState(questId = this.currentQuestId) {
        if (!this.currentPackId || questId <= 0) return null;

        const saved = this.questHints[questId] ?? this.questScores[questId];
        if (typeof saved !== 'object' || saved === null) return null;

        return {
            hintsUsed: Number.isInteger(saved.hintsUsed) && saved.hintsUsed > 0 ? saved.hintsUsed : 0,
            solutionViewed: saved.solutionViewed === true
        };
    }

    /**
     * Persist the editor content (grimoire) of a quest
     * @param {number} questId - The quest identifier
     * @param {string} code - The editor content to store
     * @returns {boolean} True when the content was persisted
     */
    saveGrimoire(questId, code) {
        if (!this.currentPackId || !this.questsMap?.has(questId)) return false;

        this.grimoires[questId] = code;
        this.savePackState();
        return true;
    }

    /**
     * Get the persisted editor content of a quest
     * @param {number} questId - The quest identifier
     * @returns {string|null} The saved code, or null when none exists
     */
    loadGrimoire(questId) {
        return this.grimoires[questId] ?? null;
    }
    
    /**
     * Calculate score for current quest
     * @returns {number} Points earned for the quest
     */
    calculateQuestScore() {
        let points = SCORING.POINTS_PER_QUEST;
        
        // Deduct points for hints
        const hintPenalty = Math.min(
            this.currentQuestHintsUsed * SCORING.POINTS_PER_HINT,
            SCORING.MAX_HINT_PENALTY
        );
        points -= hintPenalty;
        
        // Deduct points for viewing solution
        if (this.currentQuestSolutionViewed) {
            points -= SCORING.SOLUTION_PENALTY;
        }
        
        // Ensure minimum 1 point
        return Math.max(1, points);
    }
    
    /**
     * Sum the recorded per-quest scores. totalScore is derived from this so
     * the total cannot drift away from the records that produce it.
     * @returns {number} The summed points of all recorded quests
     */
    sumQuestScores() {
        return Object.values(this.questScores)
            .reduce((sum, score) => sum + (score.pointsEarned || 0), 0);
    }

    /**
     * Record quest completion and update scores. Replays can never lower a
     * quest's recorded score: the better of the previous and the new result
     * stands, together with the reveal counters of the run that produced it.
     * @param {number} questId - The quest identifier
     * @returns {number} The recorded points for the quest
     */
    completeQuest(questId) {
        const attempt = {
            hintsUsed: this.currentQuestHintsUsed,
            solutionViewed: this.currentQuestSolutionViewed,
            pointsEarned: this.calculateQuestScore()
        };
        const recorded = this.questScores[questId];

        // Score and reveals describe the same run: a replay that does not beat
        // the recorded score leaves that record, and its reveal accounting,
        // untouched.
        const best = recorded && recorded.pointsEarned >= attempt.pointsEarned
            ? recorded
            : attempt;
        this.questScores[questId] = best;
        this.totalScore = this.sumQuestScores();

        // The transient hint entry is superseded by the quest score
        delete this.questHints[questId];

        // The frontier only ever grows: completing a quest behind it cannot
        // lock the quests it had already unlocked
        if (questId < this.quests.length && questId + 1 > this.activeQuestId) {
            this.activeQuestId = questId + 1;
        }

        this.savePackState();

        return best.pointsEarned;
    }
    
    /**
     * Check if player has perfect score
     * @returns {boolean} True if all quests completed with maximum points
     */
    hasPerfectScore() {
        const maxPossibleScore = this.quests.length * SCORING.POINTS_PER_QUEST;
        return this.totalScore === maxPossibleScore;
    }
    
    /**
     * True when a cursor lies past the last quest, which is where the
     * epilogue sits.
     * @param {number} [questId] - Cursor to test, the current one by default
     * @returns {boolean} True for a cursor past the last quest
     */
    isEpilogueCursor(questId = this.currentQuestId) {
        return this.quests.length > 0 && questId > this.quests.length;
    }

    /**
     * The back rule, used by the arrow's disabled state and by the arrow
     * action alike: one implementation decides both, so a disabled control is
     * never the only thing keeping a navigation step from happening.
     * @returns {boolean} True if a quest exists before the current one
     */
    canNavigateBack() {
        return this.currentQuestId > 1;
    }

    /**
     * The forward rule, used by the arrow's disabled state and by the arrow
     * action alike. A step forward needs the next quest to be completed, or
     * history view below the frontier. It deliberately bounds the arrows at
     * the last quest: the epilogue is reached by the flow action, not here.
     * @returns {boolean} True if the next quest may be opened
     */
    canNavigateForward() {
        if (this.currentQuestId >= this.quests.length) return false;

        return this.questScores[this.currentQuestId + 1] !== undefined ||
            (this.isHistoryMode && this.currentQuestId < this.activeQuestId);
    }
    
    /**
     * Reset all progress for the current pack
     */
    resetProgress() {
        this.questScores = {};
        this.questHints = {};
        this.grimoires = {};
        this.currentQuestHintsUsed = 0;
        this.currentQuestSolutionViewed = false;
        this.currentQuestId = 0;
        this.activeQuestId = 0;
        this.deriveHistoryMode();
        this.totalScore = this.sumQuestScores();

        this.savePackState();
    }
}