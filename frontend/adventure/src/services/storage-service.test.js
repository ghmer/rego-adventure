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
import {
    getLocalStorage,
    setLocalStorage,
    removeLocalStorage,
    getPackKey,
    buildQuestGrimoireKey,
    buildQuestHintsKey,
    clearAllGrimoires
} from './storage-service.js';

describe('storage-service', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    describe('getLocalStorage / setLocalStorage', () => {
        it('round-trips values', () => {
            expect(setLocalStorage('key', 'value')).toBe(true);
            expect(getLocalStorage('key')).toBe('value');
        });

        it('returns null for missing keys', () => {
            expect(getLocalStorage('missing')).toBeNull();
        });

        it('returns the default value for missing keys', () => {
            expect(getLocalStorage('missing', 'fallback')).toBe('fallback');
        });
    });

    describe('removeLocalStorage', () => {
        it('removes stored values', () => {
            setLocalStorage('key', 'value');
            expect(removeLocalStorage('key')).toBe(true);
            expect(getLocalStorage('key')).toBeNull();
        });
    });

    describe('getPackKey', () => {
        it('scopes keys by pack id', () => {
            expect(getPackKey('base', 'fantasy')).toBe('base_fantasy');
        });

        it('returns the unscoped key without a pack id', () => {
            expect(getPackKey('base', undefined)).toBe('base');
        });
    });

    describe('key builders', () => {
        it('builds grimoire keys', () => {
            expect(buildQuestGrimoireKey(3)).toBe('rego_grimoire_q3');
        });

        it('builds hint keys', () => {
            expect(buildQuestHintsKey(3)).toBe('rego_hints_q3');
        });
    });

    describe('clearAllGrimoires', () => {
        it('clears grimoires and hint states of the pack', () => {
            setLocalStorage('rego_grimoire_q1_fantasy', 'code');
            setLocalStorage('rego_grimoire_q2_fantasy', 'code');
            setLocalStorage('rego_hints_q1_fantasy', '{"hintsUsed":1}');
            setLocalStorage('rego_pack_state_fantasy', '{}');

            clearAllGrimoires('fantasy');

            expect(getLocalStorage('rego_grimoire_q1_fantasy')).toBeNull();
            expect(getLocalStorage('rego_grimoire_q2_fantasy')).toBeNull();
            expect(getLocalStorage('rego_hints_q1_fantasy')).toBeNull();
            // Non-grimoire keys must survive
            expect(getLocalStorage('rego_pack_state_fantasy')).toBe('{}');
        });

        it('keeps other packs untouched', () => {
            setLocalStorage('rego_grimoire_q1_fantasy', 'code');
            setLocalStorage('rego_grimoire_q1_noir', 'code');

            clearAllGrimoires('fantasy');

            expect(getLocalStorage('rego_grimoire_q1_fantasy')).toBeNull();
            expect(getLocalStorage('rego_grimoire_q1_noir')).toBe('code');
        });

        it('does not over-delete for pack ids that are substrings of others', () => {
            setLocalStorage('rego_grimoire_q1_1', 'pack "1"');
            setLocalStorage('rego_grimoire_q1_11', 'pack "11"');

            clearAllGrimoires('1');

            expect(getLocalStorage('rego_grimoire_q1_1')).toBeNull();
            expect(getLocalStorage('rego_grimoire_q1_11')).toBe('pack "11"');
        });
    });
});
