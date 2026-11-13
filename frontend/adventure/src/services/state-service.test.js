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

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GameState } from './state-service.js';
import { SCORING, DEFAULT_TEXT, SaveStatus } from './constants.js';
import {
    getLocalStorage, setLocalStorage, getPackKey, getCorruptPackKey, STORAGE_KEYS
} from './storage-service.js';

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

/**
 * Read the saved packed state of the test pack.
 * @returns {Object} The stored state body
 */
function readBody() {
    return JSON.parse(getLocalStorage(getPackKey(STORAGE_KEYS.PACK_STATE, PACK_ID)));
}

describe('state-service', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    describe('setCurrentPack', () => {
        it('starts a fresh adventure when no saved state exists', () => {
            const state = new GameState();
            const entry = state.setCurrentPack(PACK_ID);

            expect(entry.resumed).toBeNull();
            expect(entry.corrupt).toBe(false);
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

        it('keeps an unreadable body aside and starts fresh', () => {
            const corruptBody = 'not json{';
            setLocalStorage(getPackKey(STORAGE_KEYS.PACK_STATE, PACK_ID), corruptBody);

            const state = new GameState();
            const entry = state.setCurrentPack(PACK_ID);

            expect(entry.resumed).toBeNull();
            expect(entry.corrupt).toBe(true);
            expect(state.currentQuestId).toBe(0);
            expect(getLocalStorage(getCorruptPackKey(STORAGE_KEYS.PACK_STATE, PACK_ID)))
                .toBe(corruptBody);
        });

        it('never lets a later save touch the body that was kept aside', () => {
            const corruptBody = '{questId: 3,';
            setLocalStorage(getPackKey(STORAGE_KEYS.PACK_STATE, PACK_ID), corruptBody);

            const state = createState(2);
            state.enterQuest(1);
            state.saveGrimoire(1, 'package one');
            state.completeQuest(1);

            expect(getLocalStorage(getCorruptPackKey(STORAGE_KEYS.PACK_STATE, PACK_ID)))
                .toBe(corruptBody);
            expect(readBody().questScores[1].pointsEarned).toBe(SCORING.POINTS_PER_QUEST);
        });

        it('does not read a kept-aside body back as a pack body', () => {
            setLocalStorage(
                getCorruptPackKey(STORAGE_KEYS.PACK_STATE, PACK_ID), JSON.stringify({ questId: 3 })
            );

            const state = new GameState();
            const entry = state.setCurrentPack(PACK_ID);

            expect(entry.resumed).toBeNull();
            expect(state.currentQuestId).toBe(0);
        });
    });

    describe('clearCurrentPack', () => {
        it('clears the active pack pointer and keeps the packed state', () => {
            const state = createState(3);
            state.enterQuest(2);
            state.currentQuestHintsUsed = 1;
            state.completeQuest(2);

            state.clearCurrentPack();

            expect(state.currentPackId).toBeNull();
            expect(getLocalStorage(STORAGE_KEYS.PACK_ID)).toBeNull();

            // A fresh page load starts at the pack selection screen ...
            const fresh = new GameState();
            expect(fresh.currentPackId).toBeNull();

            // ... but re-entering the pack resumes the progress
            const restored = new GameState();
            expect(restored.setCurrentPack(PACK_ID).resumed).not.toBeNull();
            expect(restored.currentQuestId).toBe(2);
        });

        it('is a no-op without an active pack', () => {
            const state = new GameState();

            state.clearCurrentPack();

            expect(getLocalStorage(STORAGE_KEYS.PACK_ID)).toBeNull();
        });
    });

    describe('rollbackPackEntry', () => {
        it('drops the pointer and every pack-scoped field without writing', () => {
            const loaded = createState(3);
            loaded.enterQuest(2);
            loaded.completeQuest(1);
            const savedBefore = getLocalStorage(getPackKey(STORAGE_KEYS.PACK_STATE, PACK_ID));

            // A second pack entry whose details will never arrive
            const entrant = new GameState();
            entrant.setCurrentPack('brokenpack');
            entrant.loadPackData({
                quests: [{ id: 1 }],
                prologue: [],
                epilogue: [],
                meta: { title: 'Broken' },
                ui_labels: {}
            });

            entrant.rollbackPackEntry();

            expect(entrant.currentPackId).toBeNull();
            expect(getLocalStorage(STORAGE_KEYS.PACK_ID)).toBeNull();
            expect(entrant.quests).toEqual([]);
            expect(entrant.questsMap.size).toBe(0);
            expect(entrant.meta).toBeNull();
            expect(entrant.currentQuest).toBeNull();
            expect(entrant.currentQuestId).toBe(0);
            expect(entrant.activeQuestId).toBe(0);
            expect(entrant.totalScore).toBe(0);
            expect(entrant.questScores).toEqual({});
            expect(entrant.questHints).toEqual({});
            expect(entrant.grimoires).toEqual({});
            expect(entrant.isHistoryMode).toBe(false);

            // Nothing was written, so the progress saved by the other pack
            // is byte for byte what it was
            expect(getLocalStorage(getPackKey(STORAGE_KEYS.PACK_STATE, PACK_ID))).toBe(savedBefore);
        });

        it('leaves the pack list ready to re-enter the loaded pack', () => {
            const state = createState(2);
            state.enterQuest(1);
            state.completeQuest(1);

            state.rollbackPackEntry();

            const reentered = new GameState();
            const resumed = reentered.setCurrentPack(PACK_ID).resumed;
            expect(resumed).not.toBeNull();
            expect(resumed.questId).toBe(1);
            expect(resumed.questScores[1].pointsEarned).toBe(SCORING.POINTS_PER_QUEST);
        });

        it('leaves the same field shape as an instance that never entered a pack', () => {
            const state = createState(2);
            state.enterQuest(2);
            state.loadPackData({
                quests: [{ id: 1 }, { id: 2 }],
                prologue: [],
                epilogue: [],
                meta: { title: 'Alpha' },
                ui_labels: { verifyButton: 'Verify' }
            });

            state.rollbackPackEntry();

            const fresh = new GameState();

            // Same fields, same values: nothing pack-scoped survives, and no
            // field is left in a state a fresh instance would not be in
            expect(Object.keys(state).sort()).toEqual(Object.keys(fresh).sort());
            for (const field of Object.keys(fresh)) {
                expect(state[field]).toEqual(fresh[field]);
            }
        });

        it('is a no-op without an active pack', () => {
            const state = new GameState();

            state.rollbackPackEntry();

            expect(getLocalStorage(STORAGE_KEYS.PACK_ID)).toBeNull();
        });
    });

    describe('savePackState / loadPackState roundtrip', () => {
        it('restores quest position, score, and quest scores', () => {
            const state = createState(3);
            state.enterQuest(2);
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

        it('resumes a body written before the total score was derived', () => {
            setLocalStorage(getPackKey(STORAGE_KEYS.PACK_STATE, PACK_ID), JSON.stringify({
                questId: 2,
                totalScore: 18,
                questScores: { 1: { hintsUsed: 0, solutionViewed: false, pointsEarned: 10 } },
                questHints: { 2: { hintsUsed: 1, solutionViewed: false } },
                grimoires: { 1: 'package quest one' }
            }));

            const state = new GameState();
            const resumed = state.setCurrentPack(PACK_ID).resumed;

            expect(resumed.questId).toBe(2);
            expect(state.currentQuestId).toBe(2);
            expect(state.activeQuestId).toBe(2);
            expect(state.totalScore).toBe(SCORING.POINTS_PER_QUEST);
            expect(state.loadQuestHintState(2)).toEqual({ hintsUsed: 1, solutionViewed: false });
            expect(state.loadGrimoire(1)).toBe('package quest one');
    });

    describe('saveGrimoire outcomes', () => {
        it('names the screens that have a grimoire to write', () => {
            const state = createState(2);

            expect(state.isGrimoireScreen(1)).toBe(true);
            expect(state.isGrimoireScreen(0)).toBe(false);
            expect(state.isGrimoireScreen(3)).toBe(false);

            state.clearCurrentPack();
            expect(state.isGrimoireScreen(1)).toBe(false);
        });

        it('reports saved only together with a written body', () => {
            const state = createState(2);

            expect(state.saveGrimoire(1, 'package one')).toBe(SaveStatus.SAVED);
            expect(readBody().grimoires[1]).toBe('package one');
        });

        it('reports a write the storage refused', () => {
            const state = createState(2);
            const setItem = vi.spyOn(globalThis.localStorage, 'setItem').mockImplementation(() => {
                throw new Error('QuotaExceededError');
            });

            expect(state.saveGrimoire(1, 'package one')).toBe(SaveStatus.FAILED);

            setItem.mockRestore();
        });

        it('says there is nothing to save on a narrative screen', () => {
            const state = createState(2);
            state.enterQuest(0);

            expect(state.saveGrimoire(0, 'package none')).toBe(SaveStatus.IDLE);
        });

        it('says there is nothing to save once the pack was left', () => {
            const state = createState(2);
            state.clearCurrentPack();

            expect(state.saveGrimoire(1, 'package one')).toBe(SaveStatus.IDLE);
        });

        it('reports the result of writing the packed body', () => {
            const state = createState(2);
            expect(state.savePackState()).toBe(true);

            const setItem = vi.spyOn(globalThis.localStorage, 'setItem').mockImplementation(() => {
                throw new Error('QuotaExceededError');
            });
            expect(state.savePackState()).toBe(false);
            setItem.mockRestore();
        });

        it('writes nothing when no pack is loaded', () => {
            const state = new GameState();

            expect(state.savePackState()).toBe(false);
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
    });
    describe('progression transitions', () => {
        it('derives history mode from the cursor and the frontier', () => {
            const state = createState(4);
            for (const id of [1, 2]) {
                state.enterQuest(id);
                state.completeQuest(id);
            }

            state.enterQuest(1);

            expect(state.currentQuestId).toBe(1);
            expect(state.isHistoryMode).toBe(true);

            state.enterQuest(3);
            expect(state.isHistoryMode).toBe(false);
        });

        it('persists the cursor the transition moved to', () => {
            const state = createState(3);
            state.enterQuest(2);

            expect(readBody().questId).toBe(2);
        });

        it('keeps the frontier where a completed quest unlocked it', () => {
            const state = createState(5);
            for (const id of [1, 2, 3]) {
                state.enterQuest(id);
                state.completeQuest(id);
            }
            expect(state.activeQuestId).toBe(4);

            state.rewindQuest();
            state.advanceQuest();

            expect(state.currentQuestId).toBe(3);
            expect(state.activeQuestId).toBe(4);
        });

        it('does not lower the frontier when the frontier quest is left behind', () => {
            const state = createState(4);
            for (const id of [1, 2, 3]) {
                state.enterQuest(id);
                state.completeQuest(id);
            }

            state.enterQuest(4);
            state.rewindQuest();

            expect(state.currentQuestId).toBe(3);
            expect(state.activeQuestId).toBe(4);
        });

        it('does not lower the frontier when the flow restarts at the prologue', () => {
            const state = createState(4);
            for (const id of [1, 2, 3]) {
                state.enterQuest(id);
                state.completeQuest(id);
            }

            state.enterQuest(0);
            state.advanceQuest();

            expect(state.currentQuestId).toBe(1);
            expect(state.activeQuestId).toBe(4);
        });

        it('raises the frontier when a quest unlocks one', () => {
            const state = createState(3);

            state.enterQuest(0);
            state.advanceQuest();
            expect(state.currentQuestId).toBe(1);
            expect(state.activeQuestId).toBe(1);

            state.completeQuest(1);
            expect(state.activeQuestId).toBe(2);
        });

        it('records the epilogue as the resume target when it is visited', () => {
            const state = createState(2);
            for (const id of [1, 2]) {
                state.enterQuest(id);
                state.completeQuest(id);
            }

            state.visitEpilogue();

            expect(state.currentQuestId).toBe(3);
            expect(state.activeQuestId).toBe(3);
            expect(readBody().questId).toBe(3);

            const resumed = new GameState();
            resumed.setCurrentPack(PACK_ID);
            expect(resumed.currentQuestId).toBe(3);
            expect(resumed.activeQuestId).toBe(3);
        });

        it('stops at the end of the quest list', () => {
            const state = createState(1);

            state.advanceQuest();
            state.advanceQuest();

            expect(state.currentQuestId).toBe(2);
            expect(state.advanceQuest()).toBe(false);
            expect(state.currentQuestId).toBe(2);

            // the frontier sentinel belongs to the epilogue transition
            expect(state.activeQuestId).toBe(1);
        });

        it('refuses to rewind before the first quest', () => {
            const state = createState(3);
            state.enterQuest(1);

            expect(state.rewindQuest()).toBe(false);
            expect(state.currentQuestId).toBe(1);
        });
    });

    describe('completeQuest replay accounting', () => {
        it('keeps the reveal record of the run that produced the recorded score', () => {
            const state = createState(3);
            state.enterQuest(2);
            state.completeQuest(2);

            state.currentQuestHintsUsed = 2;
            state.currentQuestSolutionViewed = true;
            const pointsEarned = state.completeQuest(2);

            expect(pointsEarned).toBe(SCORING.POINTS_PER_QUEST);
            expect(state.questScores[2].pointsEarned).toBe(SCORING.POINTS_PER_QUEST);
            expect(state.questScores[2].hintsUsed).toBe(0);
            expect(state.questScores[2].solutionViewed).toBe(false);
            expect(state.loadQuestHintState(2)).toEqual({ hintsUsed: 0, solutionViewed: false });
        });

        it('records a better replay together with its reveals', () => {
            const state = createState(3);
            state.enterQuest(2);

            state.currentQuestHintsUsed = 3;
            state.completeQuest(2);
            expect(state.questScores[2].pointsEarned).toBe(SCORING.POINTS_PER_QUEST - SCORING.MAX_HINT_PENALTY);

            state.currentQuestHintsUsed = 1;
            state.completeQuest(2);

            expect(state.questScores[2].pointsEarned).toBe(SCORING.POINTS_PER_QUEST - SCORING.POINTS_PER_HINT);
            expect(state.questScores[2].hintsUsed).toBe(1);
        });
    });

    describe('totalScore', () => {
        it('stays equal to the sum of the recorded quests', () => {
            const state = createState(3);
            state.enterQuest(1);
            state.completeQuest(1);
            state.enterQuest(2);
            state.currentQuestHintsUsed = 1;
            state.completeQuest(2);
            state.enterQuest(2);
            state.completeQuest(2);

            expect(state.totalScore).toBe(2 * SCORING.POINTS_PER_QUEST - SCORING.POINTS_PER_HINT);
            expect(state.totalScore).toBe(state.sumQuestScores());
        });

        it('is derived from the recorded quests on load', () => {
            setLocalStorage(getPackKey(STORAGE_KEYS.PACK_STATE, PACK_ID), JSON.stringify({
                questId: 3,
                totalScore: 999,
                questScores: {
                    1: { hintsUsed: 0, solutionViewed: false, pointsEarned: 10 },
                    2: { hintsUsed: 1, solutionViewed: false, pointsEarned: 8 }
                }
            }));

            const state = new GameState();
            state.setCurrentPack(PACK_ID);

            expect(state.totalScore).toBe(18);
        });

        it('is written for readers that predate the derivation', () => {
            const state = createState(2);
            state.enterQuest(1);
            state.completeQuest(1);

            expect(readBody().totalScore).toBe(SCORING.POINTS_PER_QUEST);
        });
    });

    describe('hasPerfectScore', () => {
        it('is true only when every quest earned full points', () => {
            const state = createState(2);
            state.completeQuest(1);
            expect(state.hasPerfectScore()).toBe(false);

            state.completeQuest(2);
            expect(state.hasPerfectScore()).toBe(true);
        });

        it('keeps the best result when a quest is replayed', () => {
            const state = createState(2);
            state.completeQuest(1);
            state.completeQuest(2);
            expect(state.hasPerfectScore()).toBe(true);

            // Replaying a completed quest (history mode) after having
            // used hints must not reduce the recorded score: replays are
            // safe, the better result stands.
            state.currentQuestHintsUsed = 1;
            state.currentQuestId = 1;
            const pointsEarned = state.completeQuest(1);

            expect(pointsEarned).toBe(SCORING.POINTS_PER_QUEST);
            expect(state.questScores[1].pointsEarned).toBe(SCORING.POINTS_PER_QUEST);
            expect(state.totalScore).toBe(2 * SCORING.POINTS_PER_QUEST);
            expect(state.hasPerfectScore()).toBe(true);
        });
    });

    describe('getInteractionGate', () => {
        const GATES = {
            playable: { editorReadOnly: false, verifyEnabled: true, hintEnabled: true, editorVisible: true },
            readOnly: { editorReadOnly: true, verifyEnabled: false, hintEnabled: false, editorVisible: true },
            narrative: { editorReadOnly: true, verifyEnabled: false, hintEnabled: false, editorVisible: false }
        };

        it('is playable on an unfinished quest', () => {
            const state = createState(3);
            state.enterQuest(1);

            expect(state.getInteractionGate()).toEqual(GATES.playable);
        });

        it('is read only on a completed quest behind the frontier', () => {
            const state = createState(3);
            for (const id of [1, 2]) {
                state.enterQuest(id);
                state.completeQuest(id);
            }

            state.enterQuest(1);

            expect(state.getInteractionGate()).toEqual(GATES.readOnly);
        });

        it('stays playable while the player stands on a quest they just completed', () => {
            const state = createState(3);
            state.enterQuest(1);
            state.completeQuest(1);

            // Verify runs where the player is standing; the gate follows the
            // cursor, not the frontier that just moved past it
            expect(state.getInteractionGate()).toEqual(GATES.playable);
        });

        it('hides the editor on the prologue', () => {
            const state = createState(3);
            state.enterQuest(0);

            expect(state.getInteractionGate()).toEqual(GATES.narrative);
        });

        it('hides the editor on the epilogue', () => {
            const state = createState(2);
            for (const id of [1, 2]) {
                state.enterQuest(id);
                state.completeQuest(id);
            }

            state.visitEpilogue();

            expect(state.getInteractionGate()).toEqual(GATES.narrative);
        });

        it('permits nothing while no pack is loaded', () => {
            const state = new GameState();

            expect(state.getInteractionGate()).toEqual(GATES.narrative);
        });

        it('permits nothing before the pack data has arrived', () => {
            const state = new GameState();
            state.setCurrentPack(PACK_ID);
            state.enterQuest(1);

            // the cursor is on a quest number, the quests behind it are not
            // there yet, so nothing on screen may be acted on
            expect(state.getInteractionGate()).toEqual(GATES.narrative);
        });
    });

    describe('resetProgress', () => {
        it('clears all progress and persists the reset', () => {
            const state = createState(3);
            state.completeQuest(1);
            state.questHints[2] = { hintsUsed: 1, solutionViewed: false };
            state.grimoires[2] = 'package draft';

            state.resetProgress();

            expect(state.currentQuestId).toBe(0);
            expect(state.totalScore).toBe(0);
            expect(state.questScores).toEqual({});
            expect(state.questHints).toEqual({});
            expect(state.grimoires).toEqual({});
            expect(state.isHistoryMode).toBe(false);

            const restored = new GameState();
            restored.setCurrentPack(PACK_ID);
            expect(restored.totalScore).toBe(0);
            expect(restored.grimoires).toEqual({});
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
            state.enterQuest(2);
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

        it('keeps hint state inside the packed state', () => {
            const state = createState(3);
            state.enterQuest(2);
            state.currentQuestHintsUsed = 1;
            state.persistQuestHintState();

            const packed = JSON.parse(getLocalStorage(getPackKey(STORAGE_KEYS.PACK_STATE, PACK_ID)));
            expect(packed.questHints[2]).toEqual({ hintsUsed: 1, solutionViewed: false });
        });

        it('returns null on narrative screens (quest 0)', () => {
            const state = createState(3);
            expect(state.loadQuestHintState()).toBeNull();
            state.persistQuestHintState();
            expect(state.loadQuestHintState()).toBeNull();
        });

        it('falls back to the recorded quest score for completed quests', () => {
            const state = createState(3);
            state.currentQuestHintsUsed = 2;
            state.completeQuest(1);

            expect(state.loadQuestHintState(1)).toEqual({ hintsUsed: 2, solutionViewed: false });
        });

        it('drops the transient hint entry on completion', () => {
            const state = createState(3);
            state.enterQuest(1);
            state.currentQuestHintsUsed = 1;
            state.persistQuestHintState();

            state.completeQuest(1);

            expect(state.questHints[1]).toBeUndefined();
        });

        it('returns null for corrupt persisted hint state', () => {
            setLocalStorage(
                getPackKey(STORAGE_KEYS.PACK_STATE, PACK_ID),
                JSON.stringify({ questId: 1, questHints: 'garbage' })
            );

            const state = new GameState();
            state.setCurrentPack(PACK_ID);

            expect(state.loadQuestHintState()).toBeNull();
        });
    });

    describe('saveGrimoire / loadGrimoire', () => {
        it('round-trips the editor content of a quest', () => {
            const state = createState(3);
            state.enterQuest(1);
            state.saveGrimoire(1, 'package saved');

            const restored = new GameState();
            restored.setCurrentPack(PACK_ID);

            expect(restored.loadGrimoire(1)).toBe('package saved');
        });

        it('rejects saves for quests that do not exist', () => {
            const state = createState(3);

            expect(state.saveGrimoire(99, 'package junk')).toBe(SaveStatus.IDLE);
            expect(state.loadGrimoire(99)).toBeNull();
        });

        it('keeps grimoires inside the packed state', () => {
            const state = createState(3);
            state.saveGrimoire(1, 'package saved');

            const packed = JSON.parse(getLocalStorage(getPackKey(STORAGE_KEYS.PACK_STATE, PACK_ID)));
            expect(packed.grimoires[1]).toBe('package saved');
        });
    });
});
