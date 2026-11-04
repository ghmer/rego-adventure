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
 * Reveal Service
 *
 * Single source of truth for the hint/solution reveal progression. The
 * pack payload only exposes how many hints exist (hints_count) and
 * whether a solution exists (has_solution); the actual texts are
 * revealed one at a time through dedicated API endpoints.
 *
 * Before this module, the same "hint N of M, else the solution" branch
 * existed three times (quest reveal, confirmation dialog text, hint
 * button label) and could drift. They all derive from nextReveal now.
 */

/**
 * Determine what the next reveal for a quest would be.
 * @param {Object|null} quest - Quest object (hints_count and has_solution
 *   are derived by the backend)
 * @param {number} hintsUsed - Number of hints already revealed
 * @param {boolean} solutionViewed - Whether the solution was already revealed
 * @returns {{kind: 'hint', hintId: number}|{kind: 'solution'}|null}
 *   The next reveal, or null when everything has been revealed
 */
export function nextReveal(quest, hintsUsed, solutionViewed) {
    if (!quest) return null;

    const totalHints = quest.hints_count ?? 0;
    if (hintsUsed < totalHints) {
        return { kind: 'hint', hintId: hintsUsed + 1 };
    }
    if (quest.has_solution && !solutionViewed) {
        return { kind: 'solution' };
    }
    return null;
}
