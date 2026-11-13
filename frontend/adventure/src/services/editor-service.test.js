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

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorService } from './editor-service.js';

// The real Yace mounts a DOM editor; the mock keeps the surface the service
// uses (textarea, painted layers, update pipeline) and records construction.
let yaceInstances;
vi.mock('yace', () => {
    class Yace {
        constructor(target, options) {
            this.target = target;
            this.options = options;
            this.value = target.value ?? '';
            this.textarea = document.createElement('textarea');
            this.pre = { style: {} };
            this.lines = { style: {} };
            this.root = { style: {} };
            this.updateCallbacks = [];
            yaceInstances.push(this);
        }

        onUpdate(cb) {
            this.updateCallbacks.push(cb);
        }

        update(patch) {
            if ('value' in patch) this.value = patch.value;
            this.updateCallbacks.forEach(cb => cb());
        }
    }
    return { Yace };
});

vi.mock('yace/plugins/tab', () => ({ tab: vi.fn(() => 'tab-plugin') }));
vi.mock('yace/plugins/preserveIndent', () => ({ preserveIndent: vi.fn(() => 'preserve-plugin') }));
vi.mock('yace/plugins/autoClose', () => ({ autoClose: vi.fn(() => 'autoclose-plugin') }));

vi.mock('./rego-highlighter.js', () => ({
    regoHighlighter: vi.fn(() => vi.fn(value => `hl:${value}`)),
    escapeHtml: vi.fn(value => `esc:${value}`)
}));

function mountEditor() {
    document.body.innerHTML = '<textarea id="rego-editor">package quest</textarea>';
    yaceInstances = [];
    return new EditorService('#rego-editor');
}

describe('editor service', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it('mounts Yace on the resolved element with the editor configuration', () => {
        mountEditor();
        const yace = yaceInstances[0];

        expect(yace.target).toBe(document.getElementById('rego-editor'));
        expect(yace.options.lineNumbers).toBe(true);
        expect(yace.options.plugins).toEqual(['tab-plugin', 'preserve-plugin', 'autoclose-plugin']);
        expect(yace.options.styles.fontFamily).toContain('var(--font-code');
        expect(Object.keys(yace.options.highlighters)).toHaveLength(1);
    });

    it('makes the textarea scrollable and labelled, and wires the scroll sync', () => {
        const service = mountEditor();
        const yace = yaceInstances[0];

        expect(yace.textarea.style.overflow).toBe('auto');
        expect(yace.textarea.getAttribute('aria-label')).toBe('Rego policy editor');
        expect(service.textarea).toBe(yace.textarea);
    });

    it('renders the placeholder through the highlighted layer for empty content', () => {
        mountEditor();
        const highlighter = yaceInstances[0].options.highlighters[0];

        expect(highlighter('')).toBe('<span class="ra-placeholder">esc:Write your Rego policy here...</span>');
    });

    it('renders non-empty content with the Rego highlighter', () => {
        mountEditor();
        const highlighter = yaceInstances[0].options.highlighters[0];

        expect(highlighter('package quest')).toBe('hl:package quest');
    });

    it('insets the gutter from the frame after the initial render', () => {
        mountEditor();
        const yace = yaceInstances[0];

        // textarea value "package quest" lines up on one line: digits+1 = 2ch
        expect(yace.root.style.paddingLeft).toBe('calc(2ch + 0.75rem)');
        expect(yace.pre.style.transform).toBe('translateY(0px)');
    });

    it('recomputes the gutter inset for more lines after an update', () => {
        mountEditor();
        const yace = yaceInstances[0];

        yace.value = Array.from({ length: 11 }, () => 'x').join('\n');
        yace.updateCallbacks[0]();

        expect(yace.root.style.paddingLeft).toBe('calc(3ch + 0.75rem)');
    });

    it('translates the painted layers in lockstep with the textarea scroll', () => {
        mountEditor();
        const yace = yaceInstances[0];

        yace.textarea.scrollTop = 42;
        yace.textarea.dispatchEvent(new Event('scroll'));

        expect(yace.pre.style.transform).toBe('translateY(-42px)');
        expect(yace.lines.style.transform).toBe('translate(0.75rem, -42px)');
    });

    it('keeps overlay width in parity with the textarea scrollbar', () => {
        mountEditor();
        const yace = yaceInstances[0];
        const textarea = yace.textarea;

        Object.defineProperty(textarea, 'offsetWidth', { value: 215, configurable: true });
        Object.defineProperty(textarea, 'clientWidth', { value: 200, configurable: true });

        window.dispatchEvent(new Event('resize'));

        const width = 'calc(100% - 15px)';
        expect(yace.pre.style.width).toBe(width);
        expect(yace.lines.style.width).toBe(width);
    });

    it('leaves overlay width natural when scrollbars do not take layout width', () => {
        mountEditor();
        const yace = yaceInstances[0];

        window.dispatchEvent(new Event('resize'));

        expect(yace.pre.style.width).toBe('100%');
        expect(yace.lines.style.width).toBe('100%');
    });

    it('writes values through the Yace update pipeline', () => {
        const service = mountEditor();
        const yace = yaceInstances[0];

        yace.textarea.scrollTop = 30;
        service.setValue('package play\n');
        expect(yace.textarea.scrollTop).toBe(0);
        expect(yace.pre.style.transform).toBe('translateY(0px)');
        expect(yace.value).toBe('package play\n');
    });

    it('exposes the current editor content', () => {
        const service = mountEditor();

        expect(service.value).toBe('package quest');
    });

    it('refuses a mount that does not exist', () => {
        expect(() => new EditorService('#does-not-exist')).toThrow('editor mount "#does-not-exist" not found');
    });
});
