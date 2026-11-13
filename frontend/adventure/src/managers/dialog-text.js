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

import { nextReveal } from '../services/reveal-service.js';

/**
 * Format a structured policy error for display. Locations are 1-based
 * line/column positions in the player's policy code.
 * @param {Object} detail - PolicyError from the verification API
 * @returns {string} Human-readable error line
 */
export function formatPolicyError(detail) {
    const message = detail.message || 'Unknown error';
    if (detail.line > 0) {
        const location = detail.col > 0 ? `Line ${detail.line}, Col ${detail.col}` : `Line ${detail.line}`;
        return `${location}: ${message}`;
    }
    return message;
}

/**
 * Format the "Got" part of a failed test. An undefined result means no rule
 * produced a value, which must not be confused with an explicit null.
 * @param {Object} test - TestResult from the verification API
 * @returns {string} Display text for the actual value
 */
export function formatActualValue(test) {
    if (test.undefined) {
        return 'undefined (no rule produced a value)';
    }
    return JSON.stringify(test.actual);
}

/**
 * Build the hint confirmation text for the next reveal, or null when there
 * is nothing left to reveal. The progression itself lives in reveal-service
 * (nextReveal); this function only renders it into dialog text.
 * @param {Object} quest - Current quest (hints_count and has_solution are
 * derived by the backend; the pack payload carries no hint/solution content)
 * @param {number} revealedCount - Number of already revealed hints
 * @returns {string|null} Confirmation text or null
 */
export function buildHintConfirmationText(quest, revealedCount) {
    const reveal = nextReveal(quest, revealedCount, false);
    if (!reveal) return null;

    if (reveal.kind === 'hint') {
        return `Reveal hint ${reveal.hintId} of ${quest.hints_count ?? 0}? ` +
            'Revealing hints reduces the points you can earn for this quest.';
    }
    return 'Reveal the solution? This reduces the points you can earn for this quest.';
}
