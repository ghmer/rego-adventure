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

import { describe, expect, it } from 'vitest';
import { tokenizeRego, regoHighlighter, escapeHtml } from './rego-highlighter.js';

/**
 * Compact helper: tokenize and return `[type, value]` pairs, dropping
 * unstyled `text` runs for readability unless requested.
 * @param {string} source
 * @param {Object} [options]
 * @param {boolean} [options.withText] - Include text runs
 * @returns {Array<[string, string]>}
 */
function tokens(source, { withText = false } = {}) {
    return tokenizeRego(source)
        .filter((t) => withText || t.type !== 'text')
        .map((t) => [t.type, t.value]);
}

describe('tokenizeRego', () => {
    it('recognizes all Rego keywords', () => {
        const source = 'package import default not as with else some in every if contains';
        expect(tokens(source)).toEqual(source.split(' ').map((w) => ['keyword', w]));
    });

    it('recognizes constants and root documents', () => {
        expect(tokens('true false null input data')).toEqual([
            ['constant', 'true'],
            ['constant', 'false'],
            ['constant', 'null'],
            ['root', 'input'],
            ['root', 'data']
        ]);
    });

    it('does not treat property access on input/data as a root reference', () => {
        // foo.input is a plain identifier reference; tmLanguage uses the
        // same negative lookbehind rule
        expect(tokens('foo.input.bar')).toEqual([['identifier', 'foo'], ['identifier', 'input'], ['identifier', 'bar']]);
        expect(tokens('input.foo')).toEqual([['root', 'input'], ['identifier', 'foo']]);
    });

    it('tokenizes numbers including decimals and exponents', () => {
        expect(tokens('0 42 -7 3.14 1e10 -2.5E-3')).toEqual([
            ['number', '0'],
            ['number', '42'],
            ['number', '-7'],
            ['number', '3.14'],
            ['number', '1e10'],
            ['number', '-2.5E-3']
        ]);
    });

    it('tokenizes assignment before comparison operators', () => {
        expect(tokens('allow := a == b')).toEqual([
            ['identifier', 'allow'],
            ['operator', ':='],
            ['identifier', 'a'],
            ['operator', '=='],
            ['identifier', 'b']
        ]);
    });

    it('tokenizes function calls', () => {
        expect(tokens('count(inputs)')).toEqual([
            ['call', 'count'],
            ['identifier', 'inputs']
        ]);
    });

    it('keeps comments intact to end of line', () => {
        const source = 'allow := true # trailing comment := "not a string"';
        expect(tokens(source)).toEqual([
            ['identifier', 'allow'],
            ['operator', ':='],
            ['constant', 'true'],
            ['comment', '# trailing comment := "not a string"']
        ]);
    });

    it('tokenizes double-quoted strings with escapes', () => {
        expect(tokens('"hello \\"world\\""')).toEqual([['string', '"hello \\"world\\""']]);
    });

    it('tokenizes raw strings', () => {
        expect(tokens('`raw text`')).toEqual([['string', '`raw text`']]);
    });

    it('tokenizes interpolated strings as strings', () => {
        expect(tokens('$"user {input.name}"')).toEqual([['string', '$"user {input.name}"']]);
    });

    it('tolerates unterminated strings without swallowing the document', () => {
        // the closing quote is optional so a half-typed string still
        // tokenizes to end of line instead of consuming the rest
        const [stringToken] = tokens('"unterminated policy');
        expect(stringToken[0]).toBe('string');
        const rest = tokens('"unterminated\npackage play"');
        expect(rest.some(([, v]) => v.includes('package'))).toBe(true);
    });

    it('emits unstyled text runs for punctuation and whitespace', () => {
        const all = tokens('allow {\n\ttrue\n}', { withText: true });
        expect(all.some(([type, value]) => type === 'text' && value.includes('{'))).toBe(true);
        expect(all.some(([type, value]) => type === 'text' && value.includes('\n\t'))).toBe(true);
    });

    it('round-trips the source exactly', () => {
        const source = 'package play\n\nimport rego.v1\n\ndefault allow := false\n\nallow if {\n    input.user == "admin" # admin only\n}';
        const roundTrip = tokenizeRego(source).map((t) => t.value).join('');
        expect(roundTrip).toBe(source);
    });
});

describe('regoHighlighter', () => {
    const highlight = regoHighlighter();

    it('escapes HTML-sensitive characters in plain text and tokens', () => {
        const html = highlight('a < b & c > d');
        expect(html).not.toContain('< ');
        expect(html).toContain('&lt;');
        expect(html).toContain('&amp;');
        expect(html).toContain('&gt;');
    });

    it('does not allow script injection through policy text', () => {
        const html = highlight('"><script>alert(1)</script>');
        expect(html).not.toContain('<script>');
    });

    it('wraps tokens in classed spans with the configured prefix', () => {
        const custom = regoHighlighter({ classPrefix: 'tok-' });
        const html = custom('package play');
        expect(html).toBe('<span class="tok-keyword">package</span> <span class="tok-identifier">play</span>');
    });

    it('produces HTML that matches a full policy render', () => {
        const html = highlight('default allow := false\n\nallow if input.role == "admin"');
        expect(html).toContain('<span class="ra-keyword">default</span>');
        expect(html).toContain('<span class="ra-operator">:=</span>');
        expect(html).toContain('<span class="ra-keyword">if</span>');
        expect(html).toContain('<span class="ra-root">input</span>');
        expect(html).toContain('<span class="ra-string">&quot;admin&quot;</span>');
        expect(html).toContain('<span class="ra-constant">false</span>');
    });

    it('renders the empty policy as empty HTML', () => {
        expect(highlight('')).toBe('');
    });
});

describe('escapeHtml', () => {
    it('escapes all HTML-sensitive characters', () => {
        expect(escapeHtml(`<a href="x">&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
    });
});