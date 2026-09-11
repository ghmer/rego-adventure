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
 * Editor Service
 *
 * Owns the Yace instance that upgrades the plain policy textarea:
 * line-number gutter, Rego syntax highlighting, tab indentation,
 * auto-indentation on newline, and bracket auto-closing.
 *
 * Yace keeps a real <textarea> as the input layer, so the native textarea
 * element (this.textarea) remains the source of truth for existing DOM
 * listeners (input/blur) and for read-only handling. Programmatic value
 * writes, however, must go through setValue(): assigning textarea.value
 * directly would bypass Yace's render pipeline and desynchronize the
 * highlighted layer.
 */

import { Yace } from 'yace';
import { tab } from 'yace/plugins/tab';
import { preserveIndent } from 'yace/plugins/preserveIndent';
import { autoClose } from 'yace/plugins/autoClose';
import { regoHighlighter, escapeHtml } from './rego-highlighter.js';

const EDITOR_PLACEHOLDER = 'Write your Rego policy here...';

/**
 * Brackets auto-closed by the editor. Quotes are deliberately excluded:
 * Rego string interpolation ($"...{expr}...") fights inserted closing quotes.
 */
const BRACKET_PAIRS = {
    '{': '}',
    '[': ']',
    '(': ')'
};

/**
 * First pipeline stage: render the empty editor with the placeholder and
 * everything else with the Rego highlighter. The native textarea placeholder
 * is not usable with Yace because its text layer is transparent, so the
 * placeholder lives in the highlighted layer instead.
 * @param {string} value - Current editor content
 * @returns {string} HTML for the highlighted layer
 */
function editorHighlighter(value) {
    if (value === '') {
        return `<span class="ra-placeholder">${escapeHtml(EDITOR_PLACEHOLDER)}</span>`;
    }
    return regoHighlighter()(value);
}

/**
 * Horizontal inset between the editor frame and the line-number gutter. Yace
 * positions the gutter numbers at the container's padding-box edge, so this
 * gap must be added by the service on top of Yace's own (digits + 1)ch
 * reservation.
 */
const GUTTER_GAP = '0.75rem';

/**
 * Owns the Yace editor instance for the Rego policy textarea
 */
export class EditorService {
    /**
     * @param {string|HTMLElement} mount - CSS selector or DOM node to mount into
     * @param {Object} [options] Yace option overrides (tests, future tweaks)
     */
    constructor(mount, options = {}) {
        const target = typeof mount === 'string' ? document.querySelector(mount) : mount;
        if (!target) {
            throw new Error(`editor mount "${mount}" not found`);
        }

        this.instance = new Yace(target, {
            lineNumbers: true,
            highlighters: [editorHighlighter],
            plugins: [tab('\t'), preserveIndent(), autoClose(BRACKET_PAIRS)],
            styles: {
                fontFamily: 'var(--font-code, Menlo, monospace)',
                fontSize: '1rem'
            },
            ...options
        });

        // Yace ships the textarea with overflow:hidden and no scroll sync for
        // the layers below it; enable internal scrolling (native scrollbar)
        // and translate the highlighted layer and the gutter in lockstep
        this.instance.textarea.style.overflow = 'auto';
        this.instance.textarea.setAttribute('aria-label', 'Rego policy editor');
        this.handleScroll = () => this.syncScroll();
        this.instance.textarea.addEventListener('scroll', this.handleScroll);
        this.handleResize = () => this.applyWrapParity();
        window.addEventListener('resize', this.handleResize);
        this.instance.onUpdate(() => this.syncLayers());
        // the initial render happens inside the Yace constructor, before the
        // update callback above is registered
        this.syncLayers();
    }

    /**
     * Re-apply all layout couplings between the textarea and the painted
     * layers; runs after every Yace render and on window resize.
     */
    syncLayers() {
        this.applyGutterInset();
        this.applyWrapParity();
        this.syncScroll();
    }

    /**
     * Inset the line-number gutter from the editor frame. Yace reserves
     * (digits + 1)ch for the gutter and paints the numbers at the container's
     * left edge; this adds GUTTER_GAP to both the code offset and the number
     * column, so the gap between numbers and code stays 1ch.
     *
     * Runs after every Yace render because Yace recomputes the raw padding on
     * each one. The number column is shifted with a translate so the numbers
     * stay in the gutter area Yace does not reserve.
     */
    applyGutterInset() {
        const lineCount = this.instance.value.split('\n').length;
        const digits = String(lineCount).length;
        this.instance.root.style.paddingLeft = `calc(${digits + 1}ch + ${GUTTER_GAP})`;
        this.syncScroll();
    }

    /**
     * Keep the highlighted pre layer and the line-number gutter aligned with
     * the scrolling textarea. The gutter additionally carries the horizontal
     * GUTTER_GAP shift from applyGutterInset; the pre layer does not, because
     * the code text already sits behind the padded code column.
     */
    syncScroll() {
        const top = -this.instance.textarea.scrollTop;
        this.instance.pre.style.transform = `translateY(${top}px)`;
        if (this.instance.lines) {
            this.instance.lines.style.transform = `translate(${GUTTER_GAP}, ${top}px)`;
        }
    }

    /**
     * Match the painted layers' wrapping width to the textarea's. The
     * textarea's visible scrollbar takes layout width inside the textarea,
     * so its text wraps earlier than the overlay layers would; narrow both
     * overlay layers by the scrollbar width to keep every line's wrap point
     * (and therefore the caret) aligned with its painted copy. On systems
     * with overlay scrollbars (e.g. macOS) the difference is zero and the
     * layers keep their natural width.
     */
    applyWrapParity() {
        const textarea = this.instance.textarea;
        const scrollbarWidth = textarea.offsetWidth - textarea.clientWidth;
        const width = scrollbarWidth > 0 ? `calc(100% - ${scrollbarWidth}px)` : '100%';
        this.instance.pre.style.width = width;
        if (this.instance.lines) {
            this.instance.lines.style.width = width;
        }
    }

    /**
     * The native textarea inside the Yace instance: the DOM element existing
     * managers reference as `ui.elements.editor`
     * @returns {HTMLTextAreaElement} Textarea input layer
     */
    get textarea() {
        return this.instance.textarea;
    }

    /**
     * Current editor content
     * @returns {string} Editor text
     */
    get value() {
        return this.instance.value;
    }

    /**
     * Replace the editor content through Yace's update pipeline so the
     * highlighted layer stays synchronized
     * @param {string} value - New editor text
     */
    setValue(value) {
        // browsers reset scrollTop on value assignment; mirror that in the
        // painted layers so they cannot stay shifted after a quest switch
        this.instance.textarea.scrollTop = 0;
        this.syncScroll();
        this.instance.update({ value });
    }

    /**
     * Read-only flag for history and narrative modes. readOnly (not disabled)
     * keeps selection and copying available while blocking edits; Yace also
     * suppresses its plugin pipeline on read-only keydowns.
     * @returns {boolean} Whether the editor is read-only
     */
    get readOnly() {
        return this.instance.textarea.readOnly;
    }

    set readOnly(readOnly) {
        this.instance.textarea.readOnly = readOnly;
    }

    /**
     * Tear down the editor and restore the mount node
     */
    destroy() {
        this.instance.textarea.removeEventListener('scroll', this.handleScroll);
        window.removeEventListener('resize', this.handleResize);
        this.instance.destroy();
    }
}