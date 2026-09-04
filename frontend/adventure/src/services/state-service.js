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
                this.activeQuestId = state.activeQuestId || this.currentQuestId;
                return state;
            } catch (e) {
                console.warn(`Ignoring corrupt saved state for pack "${packId}":`, e);
                return null;
            }
        }

        // One-time migration from the legacy individual-key format so
        // pre-upgrade progress is preserved instead of being wiped
        const legacy = this.readLegacyPackState(packId);
        if (legacy) {
            this.currentQuestId = legacy.questId;
            this.totalScore = legacy.totalScore;
            this.questScores = legacy.questScores;
            this.activeQuestId = legacy.activeQuestId;
            this.savePackState();
            this.removeLegacyPackState(packId);
        }
        return legacy;
    }

    /**
     * Read progress from the legacy individual-key format, if any key
     * carries data
     * @param {string} packId - The pack identifier
     * @returns {Object|null} Legacy state object or null
     */
    readLegacyPackState(packId) {
        const questId = parseInt(getLocalStorage(getPackKey(STORAGE_KEYS.QUEST_ID, packId), '0'), 10) || 0;
        const totalScore = parseInt(getLocalStorage(getPackKey(STORAGE_KEYS.TOTAL_SCORE, packId), '0'), 10) || 0;
        const activeQuestId = parseInt(getLocalStorage(getPackKey(STORAGE_KEYS.ACTIVE_QUEST_ID, packId), '0'), 10) || questId;

        let questScores = {};
        try {
            const parsed = JSON.parse(getLocalStorage(getPackKey(STORAGE_KEYS.QUEST_SCORES, packId), '{}'));
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                questScores = parsed;
            }
        } catch (e) {
            questScores = {};
        }

        if (!questId && !totalScore && !activeQuestId && Object.keys(questScores).length === 0) {
            return null;
        }
        return { questId, totalScore, questScores, activeQuestId };
    }

    /**
     * Remove the legacy individual-key entries after a successful
     * migration to the batched format
     * @param {string} packId - The pack identifier
     */
    removeLegacyPackState(packId) {
        removeLocalStorage(getPackKey(STORAGE_KEYS.QUEST_ID, packId));
        removeLocalStorage(getPackKey(STORAGE_KEYS.TOTAL_SCORE, packId));
        removeLocalStorage(getPackKey(STORAGE_KEYS.QUEST_SCORES, packId));
        removeLocalStorage(getPackKey(STORAGE_KEYS.ACTIVE_QUEST_ID, packId));
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
            this.savePackState();
            return null;
        }

        return loaded;
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
        this.currentQuestHintsUsed = 0;
        this.currentQuestSolutionViewed = false;
        this.isHistoryMode = false;

        this.savePackState();
    }
}