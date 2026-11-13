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

import confetti from 'canvas-confetti';
import { TIMING, CONFETTI } from './services/constants.js';

// Visual effects for the result and perfect-score dialogs

// Store confetti interval reference to prevent memory leaks
let confettiInterval = null;

// The confetti canvas lives inside the dialog a celebration belongs to:
// showModal() puts a dialog in the top layer, which paints above every page
// element regardless of z-index, so a body-hosted canvas could never show
// through it. The burst function is created for that canvas by the library.
let confettiCanvas = null;
let confettiBurst = null;

/**
 * The player's visual-effects opt-out, read from the body class the settings
 * toggle maintains. Every effect this module produces consults it once, at
 * its own edge, so no caller has to remember which effects honour it.
 * @returns {boolean} false when the player turned effects off
 */
function effectsEnabled() {
    return !document.body.classList.contains('effects-disabled');
}

/**
 * Insert the confetti canvas into `target` (the dialog showing the
 * celebration) and bind a burst function to it, unless a canvas from a
 * still-running celebration survives in that dialog.
 * @param {HTMLElement} target - element the canvas is appended to
 */
function ensureConfettiIn(target) {
    if (confettiCanvas) {
        return;
    }

    confettiCanvas = document.createElement('canvas');
    confettiCanvas.className = 'confetti-canvas';
    confettiCanvas.style.zIndex = CONFETTI.Z_INDEX;
    target.appendChild(confettiCanvas);
    confettiBurst = confetti.create(confettiCanvas, { resize: true });
}

/**
 * Creates a confetti effect across the entire screen. Does nothing while the
 * player has effects off. The particles render inside `target` — the dialog
 * the celebration belongs to — so the dialog's top layer cannot cover them.
 * @param {HTMLElement} target - the open dialog the confetti belongs to
 */
export function showConfetti(target) {
    if (!effectsEnabled()) {
        return;
    }

    // Clear any existing interval to prevent accumulation
    if (confettiInterval) {
        clearInterval(confettiInterval);
    }

    ensureConfettiIn(target || document.body);
    
    const duration = TIMING.CONFETTI_DURATION;
    const animationEnd = Date.now() + duration;
    const defaults = {
        startVelocity: CONFETTI.START_VELOCITY,
        spread: CONFETTI.SPREAD,
        ticks: CONFETTI.TICKS,
        zIndex: CONFETTI.Z_INDEX
    };

    function randomInRange(min, max) {
        return Math.random() * (max - min) + min;
    }

    confettiInterval = setInterval(function() {
        const timeLeft = animationEnd - Date.now();

        if (timeLeft <= 0) {
            clearInterval(confettiInterval);
            confettiInterval = null;
            return;
        }

        const particleCount = 50 * (timeLeft / duration);

        // Create confetti from two points
        confettiBurst({
            ...defaults,
            particleCount,
            origin: {
                x: randomInRange(CONFETTI.ORIGIN_MIN_X, CONFETTI.ORIGIN_MAX_X_LEFT),
                y: Math.random() + CONFETTI.ORIGIN_Y_OFFSET
            }
        });
        confettiBurst({
            ...defaults,
            particleCount,
            origin: {
                x: randomInRange(CONFETTI.ORIGIN_MIN_X_RIGHT, CONFETTI.ORIGIN_MAX_X_RIGHT),
                y: Math.random() + CONFETTI.ORIGIN_Y_OFFSET
            }
        });
    }, TIMING.CONFETTI_INTERVAL);
}

/**
 * Creates a dark overlay effect for failure. Does nothing while the player
 * has effects off.
 */
function showDarkOverlay() {
    if (!effectsEnabled()) {
        return;
    }

    // Check if overlay already exists
    let overlay = document.getElementById('dark-overlay');
    
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'dark-overlay';
        overlay.className = 'dark-overlay';
        document.body.appendChild(overlay);
    }
    
    // Show the overlay
    overlay.classList.add('active');
}

/**
 * Removes the dark overlay
 */
function hideDarkOverlay() {
    const overlay = document.getElementById('dark-overlay');
    if (overlay) {
        overlay.classList.remove('active');
    }
}

/**
 * Trigger the effect for a verification result. Removing a leftover overlay
 * is unconditional, so a result cannot leave one behind even when effects are
 * off. `dialog` is the result modal the success celebration belongs to.
 * @param {boolean} isSuccess - Whether the result was successful
 * @param {HTMLElement} dialog - the open result dialog
 */
export function triggerResultEffect(isSuccess, dialog) {
    if (isSuccess) {
        hideDarkOverlay();
        showConfetti(dialog);
    } else {
        showDarkOverlay();
    }
}

/**
 * Clean up all effects, including the confetti canvas a dialog hosts: the
 * burst function is reset first so an in-flight animation releases itself.
 */
export function cleanupEffects() {
    hideDarkOverlay();
    // Clear confetti interval to prevent memory leaks
    if (confettiInterval) {
        clearInterval(confettiInterval);
        confettiInterval = null;
    }
    if (confettiBurst) {
        confettiBurst.reset();
        confettiBurst = null;
    }
    if (confettiCanvas) {
        confettiCanvas.remove();
        confettiCanvas = null;
    }
}