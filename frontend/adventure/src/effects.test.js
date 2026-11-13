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
 * Effects machine: what the result and perfect-score dialogs trigger, and
 * which of those the player's effects opt-out suppresses.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('canvas-confetti', () => ({ default: vi.fn() }));

import confetti from 'canvas-confetti';
import { cleanupEffects, showConfetti, triggerResultEffect } from './effects.js';
import { TIMING } from './services/constants.js';

/**
 * Run the timers long enough for a confetti burst to finish.
 */
function runOutTheConfetti() {
    vi.advanceTimersByTime(TIMING.CONFETTI_DURATION + TIMING.CONFETTI_INTERVAL);
}

describe('effects', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.clearAllMocks();
        document.body.innerHTML = '';
        document.body.classList.remove('effects-disabled');
    });

    afterEach(() => {
        cleanupEffects();
        vi.useRealTimers();
    });

    it('spawns confetti while effects are on', () => {
        showConfetti();

        vi.advanceTimersByTime(TIMING.CONFETTI_INTERVAL);

        expect(confetti).toHaveBeenCalled();
    });

    it('spawns no confetti once cleanup ran', () => {
        showConfetti();
        vi.advanceTimersByTime(TIMING.CONFETTI_INTERVAL);
        const spawned = confetti.mock.calls.length;

        cleanupEffects();
        runOutTheConfetti();

        expect(confetti.mock.calls.length).toBe(spawned);
    });

    it('the success path honours the effects opt-out', () => {
        document.body.classList.add('effects-disabled');

        triggerResultEffect(true);
        runOutTheConfetti();

        expect(confetti).not.toHaveBeenCalled();
    });

    it('a perfect-score celebration honours the effects opt-out', () => {
        document.body.classList.add('effects-disabled');

        showConfetti();
        runOutTheConfetti();

        expect(confetti).not.toHaveBeenCalled();
    });

    it('shows the failure overlay only while effects are on', () => {
        triggerResultEffect(false);
        expect(document.querySelector('#dark-overlay.active')).not.toBeNull();

        cleanupEffects();
        document.body.innerHTML = '';
        document.body.classList.add('effects-disabled');

        triggerResultEffect(false);

        expect(document.querySelector('#dark-overlay.active')).toBeNull();
    });

    it('removes a failure overlay that a previous result left behind', () => {
        triggerResultEffect(false);
        expect(document.querySelector('#dark-overlay.active')).not.toBeNull();

        document.body.classList.add('effects-disabled');
        triggerResultEffect(true);

        expect(document.querySelector('#dark-overlay.active')).toBeNull();
    });
});
