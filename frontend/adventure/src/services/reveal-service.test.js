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
 * Tests for the reveal service (single source of truth for the
 * hint/solution progression)
 */
import { describe, it, expect } from 'vitest';
import { nextReveal } from './reveal-service.js';

describe('nextReveal', () => {
    it('returns the next 1-based hint while hints remain', () => {
        const quest = { hints_count: 3, has_solution: true };

        expect(nextReveal(quest, 0, false)).toEqual({ kind: 'hint', hintId: 1 });
        expect(nextReveal(quest, 2, false)).toEqual({ kind: 'hint', hintId: 3 });
    });

    it('switches to the solution once all hints are revealed', () => {
        const quest = { hints_count: 2, has_solution: true };

        expect(nextReveal(quest, 2, false)).toEqual({ kind: 'solution' });
    });

    it('offers nothing after the solution was already viewed', () => {
        const quest = { hints_count: 2, has_solution: true };

        expect(nextReveal(quest, 2, true)).toBeNull();
    });

    it('offers nothing when the quest has no solution after its hints', () => {
        const quest = { hints_count: 1, has_solution: false };

        expect(nextReveal(quest, 1, false)).toBeNull();
    });

    it('handles a quest without hints', () => {
        expect(nextReveal({ has_solution: true }, 0, false)).toEqual({ kind: 'solution' });
        expect(nextReveal({ has_solution: false }, 0, false)).toBeNull();
        expect(nextReveal({}, 0, false)).toBeNull();
    });

    it('returns null for a missing quest', () => {
        expect(nextReveal(null, 0, false)).toBeNull();
        expect(nextReveal(undefined, 0, false)).toBeNull();
    });
});
