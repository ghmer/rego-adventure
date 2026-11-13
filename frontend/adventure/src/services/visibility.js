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
 * The `hidden` class is the SPA's only visibility mechanism: `display: none
 * !important` (`frontend/shared/css/base.css`). Markup carries the initial
 * state; these four functions are the only writers and readers afterwards. A
 * widget's visibility is written by the render method that owns it and read
 * where derived state is computed. A missing element is ignored.
 */

/**
 * @param {Element|null} el - Element to make visible
 */
export function show(el) {
    if (!el) return;
    el.classList.remove('hidden');
}

/**
 * @param {Element|null} el - Element to hide
 */
export function hide(el) {
    if (!el) return;
    el.classList.add('hidden');
}

/**
 * @param {Element|null} el - Element whose visibility is derived
 * @param {boolean} hidden - true hides the element, false shows it
 */
export function setHidden(el, hidden) {
    if (!el) return;
    el.classList.toggle('hidden', hidden);
}

/**
 * @param {Element|null} el
 * @returns {boolean} true when the element carries the hidden class
 */
export function isHidden(el) {
    return el?.classList.contains('hidden') === true;
}
