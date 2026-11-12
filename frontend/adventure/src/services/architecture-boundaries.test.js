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
 * Source-level single-owner boundaries. The behaviour that follows from them
 * is covered by the manager and service suites; these assertions keep a
 * second owner of a rule, or a second writer of a field the machine already
 * owns, from appearing anywhere else.
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

    it('opens every dialog modally', () => {
        const modalManager = all.find(file => file.path.endsWith('modal-manager.js'));
        expect(methodSource(modalManager.text, 'openDialog')).toContain('showModal');

        // A dialog opened non-modally leaves the page behind it live, which is
        // how a result screen re-created reveal state and lowered the frontier.
        expect(matches(/\.show\(\)/g, all)).toEqual([]);
        expect(matches(/openDialog\([^)]*,/g, all)).toEqual([]);
    });

    it('writes the perfect-score button visibility in one renderer', () => {
        const uiManager = all.find(file => file.path.endsWith('ui-manager.js'));
        const renderer = methodSource(uiManager.text, 'renderPerfectScoreButton');
        expect(renderer, 'renderPerfectScoreButton').not.toBe('');

        const button = /perfectScoreBtn\.classList\.(?:add|remove)\(['"]hidden['"]\)/g;
        const elsewhere = matches(button, all.filter(file => file !== uiManager));
        const otherUiMethods = (uiManager.text.replace(renderer, '').match(button) || [])
            .map(hit => `ui-manager.js: ${hit}`);

        expect([...elsewhere, ...otherUiMethods]).toEqual([]);
    });

    it('writes a grimoire draft in the state service only', () => {
        const drafts = /\.grimoires(?:\[[^\]]*\])?\s*=(?!=)/g;

        expect(matches(drafts, all.filter(file => !file.path.endsWith('state-service.js')))).toEqual([]);
        expect(matches(drafts, all).length, 'draft writer').toBeGreaterThan(0);
    });

    it('renders the save indicator in one method only', () => {
        const uiManager = all.find(file => file.path.endsWith('ui-manager.js'));
        const renderer = methodSource(uiManager.text, 'renderSaveStatus');
        expect(renderer, 'renderSaveStatus').not.toBe('');

        const light = /saveIndicator\.classList\.(?:add|remove|toggle)\(/g;
        const elsewhere = matches(light, all.filter(file => file !== uiManager));
        const otherUiMethods = (uiManager.text.replace(renderer, '').match(light) || [])
            .map(hit => `ui-manager.js: ${hit}`);

        expect([...elsewhere, ...otherUiMethods], 'indicator class').toEqual([]);
    });

    it('arms and reports the pending grimoire write in the autosave only', () => {
        const autosave = all.find(file => file.path.endsWith('grimoire-autosave.js'));
        const markDirty = methodSource(autosave.text, 'markDirty');
        expect(markDirty, 'markDirty').not.toBe('');
        expect(markDirty).toContain('setTimeout');
        expect(markDirty).toContain('SaveStatus.DIRTY');

        const elsewhere = all.filter(file =>
            !file.path.endsWith('grimoire-autosave.js') && !file.path.endsWith('ui-manager.js'));
        expect(matches(/SaveStatus\.DIRTY/g, elsewhere)).toEqual([]);
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

    it('gives the adventure button one DOM home, in the quest footer', () => {
        const page = new DOMParser().parseFromString(
            readFileSync(join(globalThis.process.cwd(), 'index.html'), 'utf8'), 'text/html'
        );

        const footers = page.querySelectorAll('.quest-footer');
        expect(footers.length, 'quest footers').toBe(1);

        const offered = Array.from(footers[0].querySelectorAll('button'))
            .filter(button => !button.classList.contains('hidden'))
            .map(button => button.id);
        expect(offered, 'the footer starts empty of offers').toEqual([]);

        const ids = Array.from(footers[0].querySelectorAll('button')).map(button => button.id);
        expect(ids, 'closed input set').toEqual(['perfect-score-btn', 'start-adventure']);
        expect(footers[0].classList.contains('hidden'), 'the footer starts without an offer')
            .toBe(true);

        const editorFooter = page.querySelector('.editor-footer');
        expect(editorFooter.querySelector('#start-adventure'), 'not in the editor footer').toBe(null);
    });

    it('never moves a button between footers', () => {
        expect(matches(/appendChild\([^)]*startAdventureBtn/g, all)).toEqual([]);
        expect(matches(/startAdventureBtn\.classList\.(?:add|remove)\(['"]hidden['"]\)/g,
            all.filter(file => !file.path.endsWith('ui-manager.js')))).toEqual([]);
    });

    it('writes the adventure offer in one renderer of the ui manager', () => {
        const uiManager = all.find(file => file.path.endsWith('ui-manager.js'));
        const renderer = methodSource(uiManager.text, 'renderQuestButtonVisibility');
        expect(renderer, 'renderQuestButtonVisibility').not.toBe('');

        const offer = /startAdventureBtn\.classList\.(?:add|remove)\(['"]hidden['"]\)/g;
        const elsewhere = matches(offer, all.filter(file => file !== uiManager));
        const otherUiMethods = (uiManager.text.replace(renderer, '').match(offer) || [])
            .map(hit => `ui-manager.js: ${hit}`);

        expect([...elsewhere, ...otherUiMethods], 'adventure offer').toEqual([]);
    });

    it('recomputes the quest footer in the screen render only', () => {
        const uiManager = all.find(file => file.path.endsWith('ui-manager.js'));
        expect(methodSource(uiManager.text, 'renderQuestFooter'), 'renderQuestFooter')
            .toContain("classList.toggle('hidden'");

        // The old per-site recompute is gone, and the renderer is called only by
        // the quest render pipeline
        expect(matches(/updateQuestFooterVisibility/g, all)).toEqual([]);
        expect(matches(/renderQuestFooter\(/g, all.filter(file =>
            !file.path.endsWith('ui-manager.js') && !file.path.endsWith('quest-manager.js')))).toEqual([]);

        const uiCalls = uiManager.text.match(/(?:this|ui)\.renderQuestFooter\(/g) || [];
        expect(uiCalls.map(hit => `ui-manager.js: ${hit}`), 'footer recomputed inside the ui manager')
            .toEqual([]);
    });

    it('describes a session failure in the error service only', () => {
        const copy = /session (?:has expired|could not be renewed)/g;
        const outside = matches(copy, all.filter(file => !file.path.endsWith('error-service.js')));

        expect(outside).toEqual([]);
        expect(matches(/apiErrorHint\(/g, all).length, 'sentence reader').toBeGreaterThan(1);
    });

    it('renews the token in the auth service only', () => {
        // A second caller of signinSilent would be a second attempt racing on
        // the same OIDC storage keys.
        const outside = matches(/signinSilent\s*\(/g, all.filter(file =>
            !file.path.endsWith('auth-service.js')));

        expect(outside).toEqual([]);
        expect(matches(/AuthService\.renewToken\(/g, all).length, 'renewal caller')
            .toBeGreaterThan(0);
    });

    it('hands a lost session to one subscriber', () => {
        const auth = all.find(file => file.path.endsWith('auth-service.js'));
        expect(methodSource(auth.text, 'renewToken'), 'renewToken').toContain('announceSessionLost');

        const subscriptions = matches(/AuthService\.onSessionLost\(/g, all.filter(file => file !== auth));
        expect(subscriptions).toHaveLength(1);
    });

    it('writes the signed-in chrome in one renderer', () => {
        const uiManager = all.find(file => file.path.endsWith('ui-manager.js'));
        const renderer = methodSource(uiManager.text, 'updateAuthUI');
        expect(renderer, 'updateAuthUI').not.toBe('');

        const chrome = /(?:loginContainer|logoutBtn|logoutContainerStart)\.classList\.(?:add|remove)\(/g;
        const elsewhere = matches(chrome, all.filter(file => file !== uiManager));
        const otherUiMethods = (uiManager.text.replace(renderer, '').match(chrome) || [])
            .map(hit => `ui-manager.js: ${hit}`);

        expect([...elsewhere, ...otherUiMethods], 'auth chrome').toEqual([]);
    });
});
