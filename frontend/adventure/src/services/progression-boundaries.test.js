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
 * Source-level boundaries of the progression machine. The behaviour that
 * follows from them is covered by quest-manager.test.js and
 * state-service.test.js; these assertions keep a second owner of a rule or a
 * second writer of a progression field from appearing anywhere else.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// The test process runs with this package as its working directory
const SRC_DIR = join(globalThis.process.cwd(), 'src');

/**
 * All application sources below src/, test files excluded.
 * @param {string} [dir] - Directory to walk
 * @param {Array<Object>} [found] - Accumulated files
 * @returns {Array<{path: string, text: string}>} Sources with their contents
 */
function sources(dir = SRC_DIR, found = []) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
            sources(path, found);
        } else if (entry.name.endsWith('.js') && !entry.name.endsWith('.test.js')) {
            found.push({ path, text: readFileSync(path, 'utf8') });
        }
    }
    return found;
}

/**
 * Find a pattern across the given sources.
 * @param {RegExp} pattern - Pattern with the global flag
 * @param {Array<Object>} files - Sources to search
 * @returns {Array<string>} One entry per match, locating file and matched text
 */
function matches(pattern, files) {
    const hits = [];
    for (const file of files) {
        const found = file.text.match(pattern);
        if (found) {
            hits.push(...found.map(hit => `${file.path}: ${hit}`));
        }
    }
    return hits;
}

/**
 * The source of a method, brace matched from its definition.
 * @param {string} text - File contents
 * @param {string} name - Method name
 * @returns {string} The method source, empty when the method is absent
 */
function methodSource(text, name) {
    const definition = new RegExp(`^\\s+${name}\\(`, 'm').exec(text);
    if (!definition) return '';

    const start = text.indexOf('{', definition.index);
    let depth = 0;
    for (let index = start; index < text.length; index++) {
        if (text[index] === '{') depth++;
        if (text[index] === '}') {
            depth--;
            if (depth === 0) return text.slice(start, index + 1);
        }
    }
    return '';
}

describe('progression source boundaries', () => {
    const all = sources();
    const writers = /(?:this|state)\.(?:currentQuestId|activeQuestId)\s*(?:\+\+|--|[-+*/]?=(?!=))/g;
    const recordWrites = /\.questScores(?:\[[^\]]*\])?\s*=(?!=)/g;

    it('finds the sources it asserts on', () => {
        for (const name of ['state-service.js', 'quest-manager.js', 'event-manager.js']) {
            expect(all.some(file => file.path.endsWith(name)), name).toBe(true);
        }
    });

    it('writes cursor, frontier and quest records inside the state service only', () => {
        const outside = all.filter(file => !file.path.endsWith('state-service.js'));

        expect(matches(writers, outside)).toEqual([]);
        expect(matches(recordWrites, outside)).toEqual([]);

        // the state service itself remains the owner of those writes
        expect(matches(writers, all).length).toBeGreaterThan(0);
        expect(matches(recordWrites, all).length).toBeGreaterThan(0);
    });

    it('states each navigation rule exactly once', () => {
        const rules = [
            ['back rule', /currentQuestId > 1/g],
            ['frontier bound of the forward rule', /currentQuestId < \w*\.?activeQuestId/g],
            ['completed-next-quest half of the forward rule', /questScores\[[^\]]*currentQuestId \+ 1[^\]]*\]/g]
        ];

        for (const [name, pattern] of rules) {
            expect(matches(pattern, all), name).toHaveLength(1);
        }
    });

    it('defines each guard once', () => {
        for (const guard of ['canNavigateBack', 'canNavigateForward']) {
            expect(matches(new RegExp(`^\\s+${guard}\\(\\) \\{`, 'gm'), all)).toHaveLength(1);
        }
    });

    it('writes the interaction gate in one renderer only', () => {
        const uiManager = all.find(file => file.path.endsWith('ui-manager.js'));
        const renderer = methodSource(uiManager.text, 'renderInteractionGate');
        expect(renderer).not.toBe('');

        const gatedControls = [
            ['verify button enabled', /verifyBtn\.disabled\s*=(?!=)/g],
            ['hint button enabled', /hintBtn\.disabled\s*=(?!=)/g],
            ['editor read-only', /\.editor\.readOnly\s*=(?!=)/g],
            ['editor pane visibility', /editorPane\.classList\.(?:add|remove|toggle)\(['"]hidden['"]\)/g]
        ];

        for (const [name, pattern] of gatedControls) {
            const elsewhere = matches(pattern, all.filter(file => file !== uiManager));
            const otherUiMethods = (uiManager.text.replace(renderer, '').match(pattern) || [])
                .map(hit => `ui-manager.js: ${hit}`);

            expect([...elsewhere, ...otherUiMethods], name).toEqual([]);
        }
    });
});
