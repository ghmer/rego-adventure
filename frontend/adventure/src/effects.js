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

// Visual effects for the result modal

// Store confetti interval reference to prevent memory leaks
let confettiInterval = null;

/**
 * Creates a confetti effect across the entire screen
 */
export function showConfetti() {
    // Clear any existing interval to prevent accumulation
    if (confettiInterval) {
        clearInterval(confettiInterval);
    }
    
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
        confetti({
            ...defaults,
            particleCount,
            origin: {
                x: randomInRange(CONFETTI.ORIGIN_MIN_X, CONFETTI.ORIGIN_MAX_X_LEFT),
                y: Math.random() + CONFETTI.ORIGIN_Y_OFFSET
            }
        });
        confetti({
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
 * Creates a dark overlay effect for failure
 */
function showDarkOverlay() {
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
 * Trigger appropriate effect based on success/failure
 * @param {boolean} isSuccess - Whether the result was successful
 */
export function triggerResultEffect(isSuccess) {
    if (isSuccess) {
        hideDarkOverlay();
        showConfetti();
    } else {
        showDarkOverlay();
    }
}

/**
 * Clean up all effects
 */
export function cleanupEffects() {
    hideDarkOverlay();
    // Clear confetti interval to prevent memory leaks
    if (confettiInterval) {
        clearInterval(confettiInterval);
        confettiInterval = null;
    }
}