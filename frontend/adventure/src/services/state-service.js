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
        this.currentPackId = getLocalStorage(STORAGE_KEYS.PACK_ID);
        this.quests = [];
        this.questsMap = null; // Map for O(1) quest lookup by ID
        this.prologue = [];
        this.epilogue = [];
        this.meta = null;
        this.currentQuestId = 0;
        this.currentQuest = null;
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

        // Load pack-specific data if pack is set
        if (this.currentPackId) {
            this.loadPackState(this.currentPackId);
        }
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
                this.totalScore = state.totalScore || 0;
                this.questScores = state.questScores || {};
                this.questHints = state.questHints || {};
                this.grimoires = state.grimoires || {};
                this.activeQuestId = state.activeQuestId || this.currentQuestId;
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
    
    /**
     * Set the current quest
     * @param {number} questId - The quest identifier
     */
    setCurrentQuest(questId) {
        this.currentQuestId = questId;
        this.savePackState();
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
     * Record quest completion and update scores
     * @param {number} questId - The quest identifier
     */
    completeQuest(questId) {
        const pointsEarned = this.calculateQuestScore();
        const previousScore = this.questScores[questId]?.pointsEarned || 0;
        
        // Update total score
        this.totalScore = this.totalScore - previousScore + pointsEarned;
        
        // Save quest score details
        this.questScores[questId] = {
            hintsUsed: this.currentQuestHintsUsed,
            solutionViewed: this.currentQuestSolutionViewed,
            pointsEarned: pointsEarned
        };

        // The transient hint entry is superseded by the quest score
        delete this.questHints[questId];
        
        // Update active quest to next quest
        if (questId < this.quests.length) {
            this.activeQuestId = questId + 1;
        }
        
        this.savePackState();
        
        return pointsEarned;
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
     * Check if can navigate to previous quest
     * @returns {boolean} True if previous quest exists
     */
    canNavigateBack() {
        return this.currentQuestId > 1;
    }
    
    /**
     * Check if can navigate to next quest
     * @returns {boolean} True if next quest is available
     */
    canNavigateForward() {
        return this.currentQuestId < this.quests.length && (
            this.questScores[this.currentQuestId + 1] ||
            (this.isHistoryMode && this.currentQuestId < this.activeQuestId)
        );
    }
    
    /**
     * Reset all progress for current pack
     */
    resetProgress() {
        this.currentQuestId = 0;
        this.activeQuestId = 0;
        this.totalScore = 0;
        this.questScores = {};
        this.questHints = {};
        this.grimoires = {};
        this.currentQuestHintsUsed = 0;
        this.currentQuestSolutionViewed = false;
        this.isHistoryMode = false;

        this.savePackState();
    }
}