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

// The DOM-building renderers of the UI: pack list cards, the manual's
// sections, the test payload and support module cards, and the clipboard
// wiring of the manual. They receive the element registry explicitly (the
// element references are UIManager's) and build from templates.

import { showToast } from '../services/toast-service.js';
import { ErrorLevel } from '../services/constants.js';
import { regoHighlighter } from '../services/rego-highlighter.js';
import { parseMarkdown } from '../services/markdown.js';
import { getSafeExternalUrl } from '../services/safe-url.js';
import { show } from '../services/visibility.js';

/**
 * Render pack list on start screen. The server answers an empty list when
 * it runs with no pack directory; that condition is stated here rather than
 * left as a blank selection.
 * @param {Object} elements - Element registry
 * @param {Array} packs - Array of pack objects
 * @param {Function} onPackClick - Callback when pack is clicked
 */
export function renderPackList(elements, packs, onPackClick) {
    elements.questPackList.innerHTML = '';

    if (packs.length === 0) {
        const notice = document.createElement('p');
        notice.className = 'pack-list-empty';
        notice.textContent = 'No adventure packs are loaded. Start the server with a pack directory.';
        elements.questPackList.appendChild(notice);
        return;
    }

    const sortedPacks = [...packs].sort((a, b) => a.title.localeCompare(b.title));
    const template = document.getElementById('quest-pack-card-template');

    sortedPacks.forEach(pack => {
        const card = template.content.cloneNode(true);
        const cardElement = card.querySelector('.quest-pack-card');

        cardElement.querySelector('.pack-title').textContent = pack.title;
        cardElement.querySelector('.pack-description').textContent = pack.description;

        if (pack.genre) {
            const genreBadge = cardElement.querySelector('.genre-badge');
            genreBadge.textContent = pack.genre;
            show(genreBadge);
        }

        // Accessibility
        cardElement.setAttribute('role', 'button');
        cardElement.setAttribute('tabindex', '0');
        cardElement.setAttribute('aria-label', `Start ${pack.title} adventure: ${pack.description}`);

        // Event handlers
        cardElement.addEventListener('click', () => onPackClick(pack.id));
        cardElement.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onPackClick(pack.id);
            }
        });

        elements.questPackList.appendChild(card);
    });
}

/**
 * Render manual content in modal
 * @param {Object} elements - Element registry
 * @param {Object} manual - Manual object with data_model, rego_snippet, external_link
 */
export function renderManual(elements, manual) {
    elements.manualContent.innerHTML = '';
    const template = document.getElementById('manual-template');
    const clone = template.content.cloneNode(true);

    if (!manual) {
        const noManualSection = clone.querySelector('[data-section="no-manual"]');
        elements.manualContent.appendChild(noManualSection);
        return;
    }

    if (manual.data_model) {
        const dataModelSection = clone.querySelector('[data-section="data-model"]');
        const content = dataModelSection.querySelector('.manual-section-content');
        content.innerHTML = parseMarkdown(manual.data_model);
        enhanceDataModelFields(content);
        elements.manualContent.appendChild(dataModelSection);
    }

    if (manual.rego_snippet) {
        const regoSection = clone.querySelector('[data-section="rego-snippet"]');
        const content = regoSection.querySelector('.manual-section-content');
        content.innerHTML = parseMarkdown(manual.rego_snippet);
        elements.manualContent.appendChild(regoSection);
    }

    if (manual.external_link && manual.external_link.trim() !== '') {
        const safeUrl = getSafeExternalUrl(manual.external_link);
        if (safeUrl) {
            const linkSection = clone.querySelector('[data-section="external-link"]');
            const link = linkSection.querySelector('a');
            link.href = safeUrl;
            elements.manualContent.appendChild(linkSection);
        }
    }
}

/**
 * Make Field entries of the Data Model table copyable.
 * Wraps the field code in the first table column with a button that
 * copies the field path to the clipboard when clicked.
 * @param {HTMLElement} content - Rendered Data Model section content
 */
function enhanceDataModelFields(content) {
    const fieldCells = content.querySelectorAll('tbody tr td:first-child');
    fieldCells.forEach(cell => {
        const code = cell.querySelector('code');
        if (!code) return;

        const fieldPath = code.textContent.trim();
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'copy-field-btn';
        button.setAttribute('aria-label', `Copy ${fieldPath} to clipboard`);
        button.title = `Copy ${fieldPath} to clipboard`;

        const icon = document.createElement('i');
        icon.className = 'fa-regular fa-copy';
        icon.setAttribute('aria-hidden', 'true');

        button.appendChild(code);
        button.appendChild(icon);

        button.addEventListener('click', () => copyToClipboard(fieldPath, button));
        cell.appendChild(button);
    });
}

/**
 * Copy text to the clipboard and give visual feedback on the trigger button
 * @param {string} text - Text to copy
 * @param {HTMLButtonElement} button - Button that triggered the copy
 */
export async function copyToClipboard(text, button) {
    try {
        if (navigator.clipboard && window.isSecureContext) {
            await navigator.clipboard.writeText(text);
        } else {
            const textarea = document.createElement('textarea');
            textarea.value = text;
            textarea.setAttribute('readonly', '');
            textarea.style.position = 'fixed';
            textarea.style.opacity = '0';
            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand('copy');
            textarea.remove();
        }

        showCopyFeedback(button);
        showToast(`Copied ${text} to clipboard`, ErrorLevel.INFO);
    } catch (err) {
        console.error('Failed to copy field to clipboard:', err);
        showToast(`Could not copy ${text}`, ErrorLevel.ERROR);
    }
}

/**
 * Briefly show a success state on the copy button
 * @param {HTMLButtonElement} button - Copy button to give feedback on
 */
function showCopyFeedback(button) {
    if (button.dataset.copyFeedback === 'true') return;

    const icon = button.querySelector('i');
    if (!icon) return;

    const originalIconClass = icon.className;
    button.dataset.copyFeedback = 'true';
    icon.className = 'fa-solid fa-check';
    button.classList.add('copy-success');

    setTimeout(() => {
        icon.className = originalIconClass;
        button.classList.remove('copy-success');
        delete button.dataset.copyFeedback;
    }, 1500);
}

/**
 * Render test payload data in modal
 * @param {Object} elements - Element registry
 * @param {Array} testPayloads - Array of test case objects
 */
export function renderTestPayload(elements, testPayloads) {
    elements.testPayloadData.innerHTML = '';
    const template = document.getElementById('test-case-template');

    testPayloads.forEach((test, index) => {
        const testCase = template.content.cloneNode(true);

        testCase.querySelector('.test-case-title').textContent = `Test Case ${index + 1}`;

        const expectedSpan = testCase.querySelector('.test-case-expected');
        const expectedValue = test.expected_value;
        expectedSpan.textContent = `Expected: ${expectedValue}`;
        expectedSpan.classList.add(expectedValue ? 'expected-true' : 'expected-false');

        testCase.querySelector('.test-case-input-data').textContent =
            JSON.stringify(test.payload.input, null, 2);

        if (test.payload.data) {
            const dataSection = testCase.querySelector('.test-case-data');
            show(dataSection);
            testCase.querySelector('.test-case-data-content').textContent =
                JSON.stringify(test.payload.data, null, 2);
        }

        elements.testPayloadData.appendChild(testCase);
    });
}

/**
 * Render support modules in the modal. Each module is shown with its
 * package path in the heading and its Rego source highlighted with the
 * same tokenizer the editor uses.
 * @param {Object} elements - Element registry
 * @param {Array<string>} modules - Rego module sources
 */
export function renderSupportModules(elements, modules) {
    elements.supportModulesContent.innerHTML = '';
    const template = document.getElementById('support-module-template');
    const highlight = regoHighlighter();

    modules.forEach((module, index) => {
        if (typeof module !== 'string' || module.trim() === '') return;

        const packageMatch = module.match(/package\s+([A-Za-z0-9_.]+)/);
        const packagePath = packageMatch ? packageMatch[1] : 'unknown';
        const title = modules.length > 1
            ? `Module ${index + 1} — data.${packagePath}`
            : `Policy under test — data.${packagePath}`;

        const card = template.content.cloneNode(true);
        card.querySelector('.support-module-title').textContent = title;
        card.querySelector('.support-module-code code').innerHTML = highlight(module);

        elements.supportModulesContent.appendChild(card);
    });
}
