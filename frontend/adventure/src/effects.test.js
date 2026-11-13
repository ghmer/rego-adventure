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
 * which of those the player's effects opt-out suppresses. The confetti
 * canvas must be hosted by the dialog that started the celebration — a
 * showModal() dialog paints in the top layer, above a body-hosted canvas.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const confettiMocks = vi.hoisted(() => ({
    // the library's created burst is callable and carries reset()
    burst: Object.assign(vi.fn(), { reset: vi.fn() })
}));

vi.mock('canvas-confetti', () => ({
    default: {
        create: vi.fn(() => confettiMocks.burst)
    }
}));

import confetti from 'canvas-confetti';
import { cleanupEffects, showConfetti, triggerResultEffect } from './effects.js';
import { CONFETTI, TIMING } from './services/constants.js';

/**
 * Run the timers long enough for a confetti burst to finish.
 */
function runOutTheConfetti() {
    vi.advanceTimersByTime(TIMING.CONFETTI_DURATION + TIMING.CONFETTI_INTERVAL);
}

/**
 * A dialog element as the show* flows would have opened it.
 */
function resultDialog() {
    const dialog = document.createElement('dialog');
    document.body.appendChild(dialog);
    return dialog;
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

    it('hosts the confetti canvas in the dialog that started it', () => {
        const dialog = resultDialog();

        showConfetti(dialog);

        const canvas = dialog.querySelector('canvas.confetti-canvas');
        expect(canvas, 'confetti canvas inside the dialog').not.toBeNull();
        expect(canvas.style.zIndex).toBe(String(CONFETTI.Z_INDEX));
        expect(document.querySelector('body > canvas.confetti-canvas')).toBeNull();
        expect(confetti.create).toHaveBeenCalledWith(canvas, { resize: true });
    });

    it('spawns confetti through the created burst while effects are on', () => {
        const dialog = resultDialog();

        showConfetti(dialog);

        vi.advanceTimersByTime(TIMING.CONFETTI_INTERVAL);

        expect(confettiMocks.burst).toHaveBeenCalled();
    });

    it('spawns no confetti once cleanup ran', () => {
        const dialog = resultDialog();

        showConfetti(dialog);
        vi.advanceTimersByTime(TIMING.CONFETTI_INTERVAL);
        const spawned = confettiMocks.burst.mock.calls.length;

        cleanupEffects();
        runOutTheConfetti();

        expect(confettiMocks.burst.mock.calls.length).toBe(spawned);
    });

    it('cleanup removes the canvas and releases the burst', () => {
        const dialog = resultDialog();

        showConfetti(dialog);
        const canvas = dialog.querySelector('canvas.confetti-canvas');

        cleanupEffects();

        expect(confettiMocks.burst.reset).toHaveBeenCalled();
        expect(dialog.querySelector('canvas.confetti-canvas')).toBeNull();
        expect(canvas.isConnected).toBe(false);
    });

    it('reuses the surviving canvas of a running celebration', () => {
        const dialog = resultDialog();

        showConfetti(dialog);
        showConfetti(dialog);

        expect(confetti.create).toHaveBeenCalledTimes(1);
        expect(dialog.querySelectorAll('canvas.confetti-canvas')).toHaveLength(1);
    });

    it('the success path honours the effects opt-out', () => {
        const dialog = resultDialog();
        document.body.classList.add('effects-disabled');

        triggerResultEffect(true, dialog);
        runOutTheConfetti();

        expect(confetti.create).not.toHaveBeenCalled();
    });

    it('a perfect-score celebration honours the effects opt-out', () => {
        const dialog = resultDialog();
        document.body.classList.add('effects-disabled');

        showConfetti(dialog);
        runOutTheConfetti();

        expect(confetti.create).not.toHaveBeenCalled();
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
        triggerResultEffect(true, resultDialog());

        expect(document.querySelector('#dark-overlay.active')).toBeNull();
    });
});
