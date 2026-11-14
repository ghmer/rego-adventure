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
 * Pins the behavior of the local lint rules defined in the package's flat
 * eslint configuration. The rules are verified with the same wiring the
 * lint run uses: the real configuration export, the rule identified by ID
 * alone, so other lint diagnostics on the snippets stay irrelevant.
 */

import { Linter } from 'eslint';
import { describe, expect, it } from 'vitest';
import localConfig from '../eslint.config.js';

const linter = new Linter();

/**
 * Run the real configuration over a snippet and keep one rule's messages.
 * @param {string} code - Snippet under the rule
 * @returns {Array<Object>} Messages of the local rule only
 */
function mediaRuleMessages(code) {
    return linter.verify(code, localConfig.filter(entry => !entry.ignores))
        .filter(message => message.ruleId === 'local/no-bare-pack-media');
}

describe('lint rule local/no-bare-pack-media', () => {
    it('flags every element-source assignment shape that carries a pack path', () => {
        const violations = [
            "const packId = 'alpha';",
            'const basePath = `/quests/${packId}/assets/`;',
            '',
            'function broken(img, music, document) {',
            // the literal assignment form
            "    img.src = '/quests/p/assets/i.png';",
            // the static template assignment form
            '    music.src = `/quests/p/x.m4a`;',
            // the concatenation form: a tainted variable feeds the source
            "    img.src = basePath + 'npc.png';",
            // the bare tainted-variable form
            '    img.src = basePath;',
            // the interpolated form: a tainted variable inside a template
            "    document.body.style.backgroundImage = `url('${basePath}bg.jpg')`;",
            '}',
            ''
        ].join('\n');

        expect(mediaRuleMessages(violations)).toHaveLength(5);
    });

    it('passes asset-service resolutions and sources without pack paths', () => {
        const clean = [
            'function fine(img, music, document, link, AssetService, source, backgroundSource, npcAvatar, safeUrl) {',
            '    AssetService.mediaURL(path).then(resolved => { img.src = resolved; });',
            '    music.src = source;',
            '    document.body.style.backgroundImage = `url(\'${backgroundSource}\')`;',
            "    npcAvatar.src = '/public/assets/npc-questgiver.png';",
            '    link.href = safeUrl;',
            '}',
            ''
        ].join('\n');

        expect(mediaRuleMessages(clean)).toEqual([]);
    });
});
