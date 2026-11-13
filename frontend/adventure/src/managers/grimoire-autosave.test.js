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
 * The editor autosave machine: the debounce timer, the grimoire write and the
 * save indicator belong to one owner, so what the light shows is what the last
 * write did.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GrimoireAutosave } from './grimoire-autosave.js';
import { GameState } from '../services/state-service.js';
import { SaveStatus, TIMING } from '../services/constants.js';
import { getLocalStorage, getPackKey, STORAGE_KEYS } from '../services/storage-service.js';

const PACK_ID = 'testpack';

/**
 * Wire an autosave to a real state with one quest and a UI double that only
 * renders the indicator.
 * @returns {Object} { state, ui, autosave }
 */
function createFixture() {
    const state = new GameState();
    state.setCurrentPack(PACK_ID);
    state.loadPackData({
        quests: [{ id: 1 }],
        prologue: [],
        epilogue: [],
        meta: null,
        ui_labels: {}
    });
    state.enterQuest(1);

    const ui = {
        elements: { editor: { value: 'package quest one' } },
        renderSaveStatus: vi.fn()
    };

    return { state, ui, autosave: new GrimoireAutosave(state, ui) };
}

/**
 * The stored grimoire of quest 1, or null when none was written.
 * @param {Object} state - Game state under test
 * @returns {string|null} Stored code
 */
function storedGrimoire(state) {
    const body = JSON.parse(getLocalStorage(getPackKey(STORAGE_KEYS.PACK_STATE, PACK_ID)));
    return body?.grimoires?.['1'] ?? null;
}

describe('grimoire-autosave', () => {
    beforeEach(() => {
        localStorage.clear();
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('marks the editor dirty and writes after the debounce', () => {
        const { state, ui, autosave } = createFixture();

        autosave.markDirty();

        expect(ui.renderSaveStatus).toHaveBeenLastCalledWith(SaveStatus.DIRTY);
        expect(storedGrimoire(state)).toBeNull();

        vi.advanceTimersByTime(TIMING.GRIMOIRE_AUTOSAVE_DELAY);

        expect(storedGrimoire(state)).toBe('package quest one');
        expect(ui.renderSaveStatus).toHaveBeenLastCalledWith(SaveStatus.SAVED);
    });

    it('re-arms the timer while the player keeps typing', () => {
        const { state, autosave } = createFixture();

        autosave.markDirty();
        vi.advanceTimersByTime(TIMING.GRIMOIRE_AUTOSAVE_DELAY - 100);
        autosave.markDirty();
        vi.advanceTimersByTime(TIMING.GRIMOIRE_AUTOSAVE_DELAY - 100);

        expect(storedGrimoire(state)).toBeNull();

        vi.advanceTimersByTime(100);

        expect(storedGrimoire(state)).toBe('package quest one');
    });

    it('shows a refused write instead of claiming it is saved', () => {
        const { ui, autosave } = createFixture();
        const setItem = vi.spyOn(globalThis.localStorage, 'setItem').mockImplementation(() => {
            throw new Error('QuotaExceededError');
        });

        autosave.markDirty();
        vi.advanceTimersByTime(TIMING.GRIMOIRE_AUTOSAVE_DELAY);
        setItem.mockRestore();

        expect(ui.renderSaveStatus).toHaveBeenLastCalledWith(SaveStatus.FAILED);
    });

    it('renders nothing-to-save, not a failure, where there is no grimoire', () => {
        const { state, ui, autosave } = createFixture();
        state.enterQuest(0);

        autosave.flush();

        expect(ui.renderSaveStatus).toHaveBeenLastCalledWith(SaveStatus.IDLE);
        expect(ui.renderSaveStatus).not.toHaveBeenCalledWith(SaveStatus.FAILED);
    });

    it('writes immediately when the editor loses focus or the page goes away', () => {
        const { state, ui, autosave } = createFixture();

        autosave.markDirty();
        const written = autosave.flush();

        expect(written).toBe(true);
        expect(storedGrimoire(state)).toBe('package quest one');
        expect(ui.renderSaveStatus).toHaveBeenLastCalledWith(SaveStatus.SAVED);
    });

    it('drops a pending write and leaves the indicator alone', () => {
        const { state, ui, autosave } = createFixture();

        autosave.markDirty();
        const dirtyRenders = ui.renderSaveStatus.mock.calls.length;
        autosave.cancel();
        vi.advanceTimersByTime(TIMING.GRIMOIRE_AUTOSAVE_DELAY * 2);

        expect(storedGrimoire(state)).toBeNull();
        expect(ui.renderSaveStatus.mock.calls.length).toBe(dirtyRenders);
    });

    it('reports a screen with nothing to save as not written', () => {
        const { state, autosave } = createFixture();
        state.enterQuest(0);

        expect(autosave.flush()).toBe(false);
    });
});
