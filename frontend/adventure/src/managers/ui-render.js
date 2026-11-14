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

// The DOM-building renderers of the UI: pack tiles on the start screen, the
// manual's sections, the test payload and support module cards, and the
// clipboard wiring of the manual. They receive the element registry
// explicitly (the element references are UIManager's) and build from
// templates.

import { showToast } from '../services/toast-service.js';
import { ErrorLevel } from '../services/constants.js';
import { regoHighlighter } from '../services/rego-highlighter.js';
import { parseMarkdown } from '../services/markdown.js';
import { getSafeExternalUrl } from '../services/safe-url.js';
import { show } from '../services/visibility.js';

/**
 * Render pack list on start screen as fixed-height tiles (title + genre).
 * Clicking a tile opens a full-width detail panel below that tile's row
 * with the description, quest count and the pack entry button; one panel
 * is open at a time. The server answers an empty list when it runs with
 * no pack directory; that condition is stated here rather than left as a
 * blank selection.
 * @param {Object} elements - Element registry
 * @param {Array} packs - Array of pack objects
 * @param {Function} onPackClick - Callback when a pack's entry is chosen
 */
export function renderPackList(elements, packs, onPackClick) {
    elements.questPackList.innerHTML = '';
    // A stale open panel's tile is gone with the rerender; the module
    // state must not survive it.
    packPanelState = null;

    if (packs.length === 0) {
        const notice = document.createElement('p');
        notice.className = 'pack-list-empty';
        notice.textContent = 'No adventure packs are loaded. Start the server with a pack directory.';
        elements.questPackList.appendChild(notice);
        wirePackGrid(elements.questPackList);
        return;
    }

    const sortedPacks = [...packs].sort((a, b) => a.title.localeCompare(b.title));
    const tileTemplate = document.getElementById('quest-pack-tile-template');
    const detailTemplate = document.getElementById('quest-pack-detail-template');

    for (const pack of sortedPacks) {
        elements.questPackList.appendChild(packTile(pack, tileTemplate, detailTemplate, elements.questPackList, onPackClick));
    }

    wirePackGrid(elements.questPackList);
}

/**
 * The currently open pack detail: { tile, panel }, or null.
 * Kept at module scope so the single-open rule stays correct across
 * rerenders and so the grid-level keyboard wiring can close it from
 * wherever inside the grid the Escape arrives.
 */
let packPanelState = null;

/** Fallback removal timer for the closing panel: covers the
 * reduced-motion case, where no transition ever fires. */
const PACK_PANEL_CLOSE_FALLBACK_MS = 350;

/**
 * Build one pack tile button. The tile exposes title and genre only; it
 * toggles the detail panel inserted below its own row.
 * @param {Object} pack - Pack object (id, title, description, genre, quest_count?)
 * @param {HTMLTemplateElement} tileTemplate - Tile template
 * @param {HTMLTemplateElement} detailTemplate - Detail panel template
 * @param {HTMLElement} grid - The pack list grid
 * @param {Function} onPackClick - Callback when a pack's entry is chosen
 * @returns {HTMLButtonElement} The tile
 */
function packTile(pack, tileTemplate, detailTemplate, grid, onPackClick) {
    const tile = tileTemplate.content.cloneNode(true).querySelector('.quest-pack-tile');
    tile.dataset.packId = pack.id;
    tile.querySelector('.pack-title').textContent = pack.title;

    if (pack.genre) {
        const genreBadge = tile.querySelector('.genre-badge');
        genreBadge.textContent = pack.genre;
        show(genreBadge);
    }

    tile.setAttribute('aria-controls', `quest-pack-detail-${pack.id}`);
    tile.addEventListener('click', () => togglePackPanel(tile, pack, detailTemplate, grid, onPackClick));
    return tile;
}

/**
 * Open the pack's detail panel below the tile's row, or close it again
 * when this tile's panel is already the open one. Opening the panel of
 * another tile closes the previously open one: one panel at a time.
 * @param {HTMLButtonElement} tile - The clicked tile
 * @param {Object} pack - Pack belonging to the tile
 * @param {HTMLTemplateElement} detailTemplate - Detail panel template
 * @param {HTMLElement} grid - The pack list grid
 * @param {Function} onPackClick - Callback when a pack's entry is chosen
 */
function togglePackPanel(tile, pack, detailTemplate, grid, onPackClick) {
    if (packPanelState && packPanelState.tile === tile) {
        closePackPanel();
        return;
    }
    closePackPanel();

    const panelId = `quest-pack-detail-${pack.id}`;
    const panel = detailTemplate.content.cloneNode(true).querySelector('.quest-pack-detail');
    panel.id = panelId;
    panel.setAttribute('aria-labelledby', `${panelId}-title`);
    panel.querySelector('.detail-title').id = `${panelId}-title`;
    panel.querySelector('.detail-title').textContent = pack.title;

    if (pack.genre) {
        const genreBadge = panel.querySelector('.genre-badge');
        genreBadge.textContent = pack.genre;
        show(genreBadge);
    }

    const questCount = panel.querySelector('.quest-count');
    const count = Number(pack.quest_count);
    if (Number.isFinite(count) && count > 0) {
        questCount.textContent = count === 1 ? '1 quest' : `${count} quests`;
        show(questCount);
    }

    panel.querySelector('.pack-description').textContent = pack.description;

    const startButton = panel.querySelector('.start-pack-btn');
    startButton.addEventListener('click', () => onPackClick(pack.id));

    // The panel opens directly below the clicked tile's row: it is
    // inserted after the last tile of that row and spans the full grid
    // width from there.
    const rowLast = lastTileInRow(grid, tile);
    grid.insertBefore(panel, rowLast ? rowLast.nextSibling : null);

    // Flush the unstyled insert so the row animation runs from its start
    // value instead of folding the first frame into the last.
    void panel.offsetHeight;
    panel.classList.add('open');

    tile.setAttribute('aria-expanded', 'true');
    packPanelState = { tile, panel };
}

/**
 * Remove the open detail panel, animating the row closed. Only the
 * panel's own height transition may settle it: transitions bubbling
 * from the panel's buttons would remove it mid-hover otherwise. The
 * fallback timer covers a suppressed transition (reduced motion).
 */
function closePackPanel() {
    if (!packPanelState) return;
    const { tile, panel } = packPanelState;
    packPanelState = null;

    tile.setAttribute('aria-expanded', 'false');
    panel.classList.remove('open');

    let settled = false;
    const settle = () => {
        if (settled) return;
        settled = true;
        panel.remove();
    };
    panel.addEventListener('transitionend', (event) => {
        if (event.target !== panel || event.propertyName !== 'grid-template-rows') return;
        settle();
    });
    setTimeout(settle, PACK_PANEL_CLOSE_FALLBACK_MS);
}

/**
 * The last tile of the row that contains the given tile, so the detail
 * panel can anchor directly after its row. Column count comes from the
 * grid's own token, which the responsive rules rest per breakpoint.
 * @param {HTMLElement} grid - The pack list grid
 * @param {HTMLButtonElement} tile - The tile whose row to resolve
 * @returns {HTMLButtonElement|null} The row's last tile, or null
 */
function lastTileInRow(grid, tile) {
    const tiles = grid.querySelectorAll('.quest-pack-tile');
    const index = Array.prototype.indexOf.call(tiles, tile);
    if (index === -1) return null;
    const columns = packGridColumns(grid);
    const rowStart = Math.floor(index / columns) * columns;
    return tiles[Math.min(rowStart + columns, tiles.length) - 1] || null;
}

/**
 * Read the pack list's column count from its grid token.
 * @param {HTMLElement} grid - The pack list grid
 * @returns {number} Columns as declared per breakpoint, minimum 1
 */
function packGridColumns(grid) {
    const declared = parseInt(getComputedStyle(grid).getPropertyValue('--pack-columns'), 10);
    return Number.isFinite(declared) && declared > 0 ? declared : 3;
}

/**
 * Wire the grid's keyboard behaviour and the outside-click close once:
 * the grid node survives every rerender, so the wiring is keyed on the
 * node itself rather than on a render count.
 * @param {HTMLElement} grid - The pack list grid
 */
function wirePackGrid(grid) {
    if (grid.dataset.packGridWired) return;
    grid.dataset.packGridWired = 'true';

    grid.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && packPanelState) {
            event.preventDefault();
            const { tile } = packPanelState;
            closePackPanel();
            tile.focus();
            return;
        }
        moveTileFocus(grid, event);
    });

    document.addEventListener('click', (event) => {
        if (!packPanelState) return;
        if (event.target.closest('.quest-pack-tile') || event.target.closest('.quest-pack-detail')) return;
        closePackPanel();
    });
}

/**
 * Grid-order focus movement over the tiles: arrows move one step (or one
 * row in the wrap directions), Home and End jump to the ends. Tiles are
 * buttons in tab order already; this is the shortcut layer on top.
 * @param {HTMLElement} grid - The pack list grid
 * @param {KeyboardEvent} event - The grid's keydown event, consumed here
 */
function moveTileFocus(grid, event) {
    const steps = {
        ArrowRight: 1, ArrowLeft: -1, Home: 'start', End: 'end',
    };
    if (!(event.key in steps)) return;

    const tiles = grid.querySelectorAll('.quest-pack-tile');
    if (tiles.length < 2) return;

    const index = Array.prototype.indexOf.call(tiles, document.activeElement);
    if (index === -1) return;

    event.preventDefault();
    let next;
    if (steps[event.key] === 'start') next = 0;
    else if (steps[event.key] === 'end') next = tiles.length - 1;
    else {
        const delta = steps[event.key];
        const stride = (event.key === 'ArrowDown') ? packGridColumns(grid)
            : (event.key === 'ArrowUp') ? -packGridColumns(grid) : delta;
        // Wrap in both directions: a step past the edge continues from
        // the opposite edge of the tile sequence.
        next = ((index + stride) % tiles.length + tiles.length) % tiles.length;
    }
    tiles[next].focus();
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
