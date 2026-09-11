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

import { beforeEach, describe, expect, it } from 'vitest';
import { GameState } from './state-service.js';
import { SCORING, DEFAULT_TEXT } from './constants.js';
import { getLocalStorage, setLocalStorage, getPackKey, STORAGE_KEYS } from './storage-service.js';

const PACK_ID = 'testpack';

/**
 * Create a game state for a fresh test pack with the given number of quests.
 * @param {number} questCount - Number of quests in the pack
 * @returns {GameState} State with pack data loaded
 */
function createState(questCount) {
    const state = new GameState();
    state.setCurrentPack(PACK_ID);
    state.loadPackData({
        quests: Array.from({ length: questCount }, (_, i) => ({ id: i + 1 })),
        prologue: [],
        epilogue: [],
        meta: null,
        ui_labels: {}
    });
    return state;
}

describe('state-service', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    describe('setCurrentPack', () => {
        it('starts a fresh adventure when no saved state exists', () => {
            const state = new GameState();
            const loaded = state.setCurrentPack(PACK_ID);

            expect(loaded).toBeNull();
            expect(state.currentPackId).toBe(PACK_ID);
            expect(state.currentQuestId).toBe(0);
            expect(state.totalScore).toBe(0);
            expect(state.questScores).toEqual({});
        });

        it('persists the selected pack id', () => {
            const state = new GameState();
            state.setCurrentPack(PACK_ID);
            expect(getLocalStorage(STORAGE_KEYS.PACK_ID)).toBe(PACK_ID);
        });

        it('ignores corrupt saved state and starts fresh', () => {
            setLocalStorage(getPackKey(STORAGE_KEYS.PACK_STATE, PACK_ID), 'not json{');

            const state = new GameState();
            const loaded = state.setCurrentPack(PACK_ID);

            expect(loaded).toBeNull();
            expect(state.currentQuestId).toBe(0);
        });
    });

    describe('savePackState / loadPackState roundtrip', () => {
        it('restores quest position, score, and quest scores', () => {
            const state = createState(3);
            state.setCurrentQuest(2);
            state.currentQuestHintsUsed = 1;
            state.completeQuest(2);

            const restored = new GameState();
            restored.setCurrentPack(PACK_ID);

            expect(restored.currentQuestId).toBe(2);
            expect(restored.totalScore).toBe(8);
            expect(restored.questScores[2]).toEqual({
                hintsUsed: 1,
                solutionViewed: false,
                pointsEarned: 8
            });
            expect(restored.activeQuestId).toBe(3);
        });
    });

    describe('calculateQuestScore', () => {
        it('is a full quest without penalties', () => {
            const state = createState(3);
            expect(state.calculateQuestScore()).toBe(SCORING.POINTS_PER_QUEST);
        });

        it('deducts per hint, capped at the maximum penalty', () => {
            const state = createState(3);
            state.currentQuestHintsUsed = 2;
            expect(state.calculateQuestScore()).toBe(SCORING.POINTS_PER_QUEST - 2 * SCORING.POINTS_PER_HINT);

            state.currentQuestHintsUsed = 10;
            expect(state.calculateQuestScore()).toBe(SCORING.POINTS_PER_QUEST - SCORING.MAX_HINT_PENALTY);
        });

        it('deducts the solution penalty and never drops below 1 point', () => {
            const state = createState(3);
            state.currentQuestSolutionViewed = true;
            expect(state.calculateQuestScore()).toBe(
                SCORING.POINTS_PER_QUEST - SCORING.SOLUTION_PENALTY
            );

            state.currentQuestHintsUsed = 10;
            expect(state.calculateQuestScore()).toBe(1);
        });
    });

    describe('completeQuest', () => {
        it('accumulates total score and advances the active quest', () => {
            const state = createState(3);
            state.completeQuest(1);
            state.completeQuest(2);

            expect(state.totalScore).toBe(2 * SCORING.POINTS_PER_QUEST);
            expect(state.activeQuestId).toBe(3);
            expect(Object.keys(state.questScores)).toEqual(['1', '2']);
        });

        it('does not advance the active quest beyond the last quest', () => {
            const state = createState(2);
            state.completeQuest(2);

            expect(state.questScores[2]).toBeDefined();
            expect(state.activeQuestId).not.toBe(3);
        });
    });

    describe('hasPerfectScore', () => {
        it('is true only when every quest earned full points', () => {
            const state = createState(2);
            state.completeQuest(1);
            expect(state.hasPerfectScore()).toBe(false);

            state.completeQuest(2);
            expect(state.hasPerfectScore()).toBe(true);

            state.currentQuestHintsUsed = 1;
            state.currentQuestId = 1;
            state.completeQuest(1);
            expect(state.hasPerfectScore()).toBe(false);
        });
    });

    describe('resetProgress', () => {
        it('clears all progress and persists the reset', () => {
            const state = createState(3);
            state.completeQuest(1);

            state.resetProgress();

            expect(state.currentQuestId).toBe(0);
            expect(state.totalScore).toBe(0);
            expect(state.questScores).toEqual({});
            expect(state.isHistoryMode).toBe(false);

            const restored = new GameState();
            restored.setCurrentPack(PACK_ID);
            expect(restored.totalScore).toBe(0);
        });
    });

    describe('label', () => {
        it('falls back to default text without pack labels', () => {
            const state = createState(2);
            expect(state.label('verifyButton')).toBe(DEFAULT_TEXT.VERIFY_BUTTON);
            expect(state.label('verifying')).toBe(DEFAULT_TEXT.VERIFYING);
        });

        it('prefers pack-specific labels', () => {
            const state = createState(2);
            state.loadPackData({
                quests: [{ id: 1 }],
                prologue: [],
                epilogue: [],
                meta: null,
                ui_labels: { verifying: 'Compiling…' }
            });
            expect(state.label('verifying')).toBe('Compiling…');
            // Unset labels still fall back
            expect(state.label('verifyButton')).toBe(DEFAULT_TEXT.VERIFY_BUTTON);
        });
    });

    describe('persistQuestHintState / loadQuestHintState', () => {
        it('round-trips the revealed hint state of the current quest', () => {
            const state = createState(3);
            state.setCurrentQuest(2);
            state.currentQuestHintsUsed = 2;
            state.persistQuestHintState();

            const restored = new GameState();
            restored.setCurrentPack(PACK_ID);
            restored.currentQuestId = 2;

            expect(restored.loadQuestHintState()).toEqual({
                hintsUsed: 2,
                solutionViewed: false
            });
        });

        it('returns null on narrative screens (quest 0)', () => {
            const state = createState(3);
            expect(state.loadQuestHintState()).toBeNull();
            state.persistQuestHintState();
            expect(state.loadQuestHintState()).toBeNull();
        });

        it('returns null for corrupt persisted state', () => {
            const state = createState(3);
            state.setCurrentQuest(1);
            setLocalStorage(getPackKey('rego_hints_q1', PACK_ID), 'not json{');
            expect(state.loadQuestHintState()).toBeNull();
        });
    });
});
