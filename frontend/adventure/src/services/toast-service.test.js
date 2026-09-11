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
import { ErrorLevel } from './constants.js';

describe('toast-service', () => {
    let showToast;

    beforeEach(async () => {
        vi.useFakeTimers();
        clearToasts();
        ({ showToast } = await import('./toast-service.js'));
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    /**
     * Get the toast container, creating nothing.
     * @returns {HTMLElement|null} Container element
     */
    function container() {
        return document.getElementById('toast-container');
    }

    /**
     * Get all toast elements shown so far.
     * @returns {NodeList} Toast elements
     */
    function toasts() {
        return container()?.querySelectorAll('.toast') ?? [];
    }

    /**
     * Get the most recently shown toast element.
     * @returns {HTMLElement|null} Last toast element
     */
    function lastToast() {
        const all = toasts();
        return all.length ? all[all.length - 1] : null;
    }

    /**
     * Remove all toasts between tests (the module caches its container,
     * so the container itself must survive across tests).
     */
    function clearToasts() {
        toasts().forEach(toast => toast.remove());
    }

    it('creates a single container with accessibility attributes', () => {
        showToast('hello');
        showToast('again');

        expect(container()).not.toBeNull();
        expect(container().getAttribute('role')).toBe('region');
        expect(container().getAttribute('aria-label')).toBe('Notifications');
        expect(toasts()).toHaveLength(2);
    });

    it('renders the message as text content', () => {
        showToast('Policy saved locally.');

        const message = lastToast().querySelector('.toast-message');
        expect(message.textContent).toBe('Policy saved locally.');
    });

    it('marks toasts as alerts with polite live announcements by default', () => {
        showToast('hello', ErrorLevel.INFO);

        expect(lastToast().getAttribute('role')).toBe('alert');
        expect(lastToast().getAttribute('aria-live')).toBe('polite');
    });

    it('uses assertive announcements for critical toasts', () => {
        showToast('catastrophe', ErrorLevel.CRITICAL);

        expect(lastToast().getAttribute('aria-live')).toBe('assertive');
        expect(lastToast().classList.contains('toast-critical')).toBe(true);
    });

    it('picks the icon for the severity level', () => {
        const expectations = [
            [ErrorLevel.INFO, 'fa-circle-info'],
            [ErrorLevel.WARNING, 'fa-triangle-exclamation'],
            [ErrorLevel.ERROR, 'fa-circle-exclamation'],
            [ErrorLevel.CRITICAL, 'fa-circle-xmark']
        ];

        for (const [level, icon] of expectations) {
            showToast(`toast-${icon}`, level);
            expect(lastToast().querySelector('.toast-icon').innerHTML).toContain(icon);
        }
    });

    it('falls back to the info icon and class for unknown levels', () => {
        showToast('weird', 'unknown-level');

        expect(lastToast().classList.contains('toast-unknown-level')).toBe(true);
        expect(lastToast().querySelector('.toast-icon').innerHTML).toContain('fa-circle-info');
    });

    it('shows the toast after the animation delay and auto-dismisses per level', () => {
        showToast('msg', ErrorLevel.ERROR);

        expect(lastToast().classList.contains('toast-show')).toBe(false);
        vi.advanceTimersByTime(10);
        expect(lastToast().classList.contains('toast-show')).toBe(true);

        // Auto-dismiss first hides the toast, then removes it after the
        // 300ms hide animation
        vi.advanceTimersByTime(5000);
        expect(lastToast().classList.contains('toast-hide')).toBe(true);

        vi.advanceTimersByTime(300);
        expect(toasts()).toHaveLength(0);
    });

    it('auto-dismisses info toasts after 3 seconds', () => {
        showToast('msg', ErrorLevel.INFO);

        vi.advanceTimersByTime(2999);
        expect(toasts()).toHaveLength(1);

        vi.advanceTimersByTime(1 + 300);
        expect(toasts()).toHaveLength(0);
    });

    it('removes the toast via the close button', () => {
        showToast('dismissible', ErrorLevel.INFO);

        lastToast().querySelector('.toast-close').click();
        expect(lastToast().classList.contains('toast-hide')).toBe(true);

        vi.advanceTimersByTime(300);
        expect(toasts()).toHaveLength(0);
    });

    it('annotates the close button for assistive technology', () => {
        showToast('msg');

        expect(lastToast().querySelector('.toast-close').getAttribute('aria-label'))
            .toBe('Close notification');
    });

    it('tolerates repeated removal attempts for the same toast', () => {
        showToast('once', ErrorLevel.INFO);
        const toast = lastToast();
        toast.querySelector('.toast-close').click();

        vi.advanceTimersByTime(300);
        // A second removal attempt (e.g. the auto-dismiss timer) on an
        // already removed toast must not throw
        expect(() => {
            toast.querySelector('.toast-close').onclick?.(new Event('click'));
            vi.advanceTimersByTime(300);
        }).not.toThrow();
    });
});
