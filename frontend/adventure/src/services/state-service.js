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

import { getLocalStorage, setLocalStorage, getPackKey, STORAGE_KEYS } from './storage-service.js';
import { SCORING, DEFAULT_TEXT } from './constants.js';

/**
 * Game State Manager
 * Handles all game state operations with automatic persistence
 */
export class GameState {
    constructor() {
        this.currentPackId = getLocalStorage(STORAGE_KEYS.PACK_ID);
        this.quests = [];
        this.prologue = [];
        this.epilogue = [];
        this.meta = null;
        this.currentQuestId = 0;
        this.currentQuest = null;
        this.currentLoreIndex = 0;
        this.isMusicPlaying = false;
        
        // Scoring
        this.totalScore = 0;
        this.questScores = {};
        this.currentQuestHintsUsed = 0;
        this.currentQuestSolutionViewed = false;
        
        // Navigation
        this.questHistory = [];
        this.isHistoryMode = false;
        this.activeQuestId = 0;
        
        // UI Labels (loaded from pack metadata)
        this.uiLabels = {};
        this.grimoireTitle = '';
        this.hintButton = '';
        this.verifyButton = '';
        this.messageSuccess = '';
        this.messageFailure = '';
        this.perfectScoreMessage = '';
        this.perfectScoreButtonText = '';
        this.beginAdventureButton = '';
        
        // Music progress ring
        this.musicRingCircumference = 0;
        
        // Load pack-specific data if pack is set
        if (this.currentPackId) {
            this.loadPackState(this.currentPackId);
        }
    }
    
    /**
     * Load state for a specific pack from localStorage
     * @param {string} packId - The pack identifier
     */
    loadPackState(packId) {
        this.currentQuestId = parseInt(
            getLocalStorage(getPackKey(STORAGE_KEYS.QUEST_ID, packId), '0')
        ) || 0;
        
        this.totalScore = parseInt(
            getLocalStorage(getPackKey(STORAGE_KEYS.TOTAL_SCORE, packId), '0')
        ) || 0;
        
        this.questScores = JSON.parse(
            getLocalStorage(getPackKey(STORAGE_KEYS.QUEST_SCORES, packId), '{}')
        );
        
        this.activeQuestId = parseInt(
            getLocalStorage(getPackKey(STORAGE_KEYS.ACTIVE_QUEST_ID, packId), '0')
        ) || this.currentQuestId;
    }
    
    /**
     * Set the current pack and initialize its state
     * @param {string} packId - The pack identifier
     * @param {boolean} isResuming - Whether resuming an existing adventure
     */
    setCurrentPack(packId, isResuming = false) {
        this.currentPackId = packId;
        setLocalStorage(STORAGE_KEYS.PACK_ID, packId);
        
        if (!isResuming) {
            // Starting new adventure - reset everything
            this.currentQuestId = 0;
            this.activeQuestId = 0;
            this.totalScore = 0;
            this.questScores = {};
            this.savePackState();
        } else {
            // Resuming - load saved state
            this.loadPackState(packId);
        }
    }
    
    /**
     * Save current pack state to localStorage
     */
    savePackState() {
        if (!this.currentPackId) return;
        
        setLocalStorage(
            getPackKey(STORAGE_KEYS.QUEST_ID, this.currentPackId),
            this.currentQuestId.toString()
        );
        
        setLocalStorage(
            getPackKey(STORAGE_KEYS.TOTAL_SCORE, this.currentPackId),
            this.totalScore.toString()
        );
        
        setLocalStorage(
            getPackKey(STORAGE_KEYS.QUEST_SCORES, this.currentPackId),
            JSON.stringify(this.questScores)
        );
        
        setLocalStorage(
            getPackKey(STORAGE_KEYS.ACTIVE_QUEST_ID, this.currentPackId),
            this.activeQuestId.toString()
        );
    }
    
    /**
     * Load pack details (quests, prologue, epilogue, metadata)
     * @param {Object} packData - Pack data from API
     */
    loadPackData(packData) {
        this.quests = packData.quests;
        this.prologue = packData.prologue;
        this.epilogue = packData.epilogue;
        this.meta = packData.meta;
        
        // Load UI labels with fallbacks
        this.uiLabels = packData.ui_labels || {};
        this.grimoireTitle = this.uiLabels.grimoire_title || DEFAULT_TEXT.GRIMOIRE_TITLE;
        this.hintButton = this.uiLabels.hint_button || DEFAULT_TEXT.HINT_BUTTON;
        this.verifyButton = this.uiLabels.verify_button || DEFAULT_TEXT.VERIFY_BUTTON;
        this.messageSuccess = this.uiLabels.message_success || DEFAULT_TEXT.MESSAGE_SUCCESS;
        this.messageFailure = this.uiLabels.message_failure || DEFAULT_TEXT.MESSAGE_FAILURE;
        this.perfectScoreMessage = this.uiLabels.perfect_score_message || DEFAULT_TEXT.PERFECT_SCORE_MESSAGE;
        this.perfectScoreButtonText = this.uiLabels.perfect_score_button_text || DEFAULT_TEXT.PERFECT_SCORE_BUTTON;
        this.beginAdventureButton = this.uiLabels.begin_adventure_button || DEFAULT_TEXT.BEGIN_ADVENTURE;
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
     * Navigate to a quest (handles history mode)
     * @param {number} questId - The quest to navigate to
     */
    navigateToQuest(questId) {
        // Determine if entering/exiting history mode
        const isCompleted = this.questScores[questId] !== undefined;
        const isActiveQuest = questId === this.activeQuestId;
        
        this.isHistoryMode = isCompleted && !isActiveQuest;
        this.currentQuestId = questId;
        
        this.savePackState();
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
        this.questHistory = [];
        this.isHistoryMode = false;
        
        this.savePackState();
    }
}