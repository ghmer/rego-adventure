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
 * Rego tokenizer and Yace highlighter.
 *
 * Rule content is ported from the CNCF-hosted OPA grammars:
 *   - open-policy-agent/vscode-opa  syntaxes/Rego.tmLanguage
 *   - open-policy-agent/opa         misc/syntax/sublime/rego.sublime-syntax
 * Both are Apache-2.0. Keep the keyword list in sync when Rego gains new
 * keywords (see the OPA roadmap).
 *
 * This is a token-level highlighter (regex rules), not a parser: nested
 * constructs such as expressions inside string interpolation are approximated,
 * which is standard for textarea-overlay editors.
 */

/**
 * Escape a raw text chunk for innerHTML use.
 * @param {string} text
 * @returns {string} HTML-safe text
 */
export function escapeHtml(text) {
    return text.replace(/[&<>"']/g, (ch) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    }[ch]));
}

/**
 * Token rules in match order. Each entry is [type, stickyRegex]; the sticky
 * flag anchors every probe at the current scan position. Earlier rules win,
 * so comments and strings precede keywords/operators, and keywords precede
 * identifiers.
 * @type {Array<[string, RegExp]>}
 */
const TOKEN_RULES = [
    ['comment', /#[^\n]*/y],
    ['string', /\$"(?:\\.|[^"\\\n])*"?/y],
    ['string', /`[^`\n]*`?/y],
    ['string', /"(?:\\.|[^"\\\n])*"?/y],
    ['number', /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y],
    ['keyword', /\b(?:package|import|default|not|as|with|else|some|in|every|if|contains)\b/y],
    ['constant', /\b(?:true|false|null)\b/y],
    ['root', /(?<!\.)\b(?:input|data)\b/y],
    ['operator', /:=|==|!=|>=|<=|>|<|\+|-|\*|%|\/|\||&/y],
    ['call', /[A-Za-z_][A-Za-z0-9_]*(?=\()/y],
    ['identifier', /[A-Za-z_][A-Za-z0-9_]*/y]
];

/**
 * Tokenize Rego source into a flat token stream.
 *
 * Pure function: no DOM, no imports, no Yace coupling, so it can be unit
 * tested and reused by other renderers.
 *
 * @param {string} source - Raw Rego source text
 * @returns {Array<{type: string, value: string}>} Tokens in source order;
 *   unmatched characters are emitted as `{type: 'text', value}` runs
 */
export function tokenizeRego(source) {
    const tokens = [];
    let pos = 0;
    let textStart = -1;

    const flushText = () => {
        if (textStart >= 0) {
            tokens.push({ type: 'text', value: source.slice(textStart, pos) });
            textStart = -1;
        }
    };

    while (pos < source.length) {
        let match = null;
        for (const [type, rule] of TOKEN_RULES) {
            rule.lastIndex = pos;
            const found = rule.exec(source);
            if (found && found[0]) {
                match = { type, value: found[0] };
                break;
            }
        }

        if (match) {
            flushText();
            tokens.push(match);
            pos += match.value.length;
        } else {
            if (textStart < 0) textStart = pos;
            pos += 1;
        }
    }

    flushText();
    return tokens;
}

/**
 * Create a Yace-compatible highlighter for Rego.
 *
 * The returned function satisfies Yace's Highlighter contract
 * `(value: string, context?: { html: boolean }) => string` and must be the
 * first (or only) stage of the `highlighters` pipeline: it receives raw text
 * and escapes it before emitting spans.
 *
 * @param {Object} [options]
 * @param {string} [options.classPrefix='ra-'] Prefix for token class names
 * @returns {(value: string) => string} Highlighted HTML
 */
export function regoHighlighter({ classPrefix = 'ra-' } = {}) {
    return (value) => {
        let html = '';
        for (const token of tokenizeRego(value)) {
            const escaped = escapeHtml(token.value);
            html += token.type === 'text'
                ? escaped
                : `<span class="${classPrefix}${token.type}">${escaped}</span>`;
        }
        return html;
    };
}