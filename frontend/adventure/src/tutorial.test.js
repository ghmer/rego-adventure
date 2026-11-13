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

import { beforeEach, describe, expect, it, vi } from 'vitest';

const driverMock = vi.hoisted(() => ({ driver: vi.fn() }));

vi.mock('driver.js', () => ({ driver: driverMock.driver }));

/**
 * A fresh tutorial instance: the module under test is re-imported, which
 * rebuilds its exported singleton.
 * @returns {Promise<Object>} TutorialSystem instance with empty state
 */
async function freshTutorial() {
    vi.resetModules();
    const { tutorial } = await import('./tutorial.js');
    return tutorial;
}

// The elements the tour hides on the quest screens and unhides while it runs
const TOUR_TARGETS = [
    '#editor-pane',
    '#rego-editor',
    '#check-manual-btn',
    '#check-test-payload-btn',
    '#verify-btn',
    '#quest-back-btn',
    '#quest-forward-btn'
];

/**
 * A quest screen with the tour targets hidden, as a quest screen really is.
 */
function createMarkup() {
    document.body.innerHTML = `
        <div id="game-interface" class="app-container">
            <section id="editor-pane" class="hidden">
                <div id="rego-editor" class="hidden"></div>
                <button id="check-manual-btn" class="hidden"></button>
                <button id="check-support-modules-btn" class="hidden"></button>
                <button id="check-test-payload-btn" class="hidden"></button>
                <button id="verify-btn" class="hidden"></button>
                <button id="quest-back-btn" class="hidden"></button>
                <button id="quest-forward-btn" class="hidden"></button>
            </section>
            <h2 id="quest-title">Quest</h2>
            <button id="start-adventure"></button>
            <button id="minimize-btn"></button>
            <button id="music-btn"></button>
            <button id="effects-btn"></button>
            <button id="restart-btn"></button>
            <button id="home-btn"></button>
            <span id="experience-points">0 XP</span>
            <span id="quest-counter">1 / 1</span>
        </div>
    `;
}

/**
 * A driver double that starts a tour and hands back the config the tour was
 * built with, so a test can run its destroy hook.
 * @returns {Object} { drive, config } Captured call state
 */
function runningTour() {
    let config = null;
    driverMock.driver.mockImplementation((given) => {
        config = given;
        return { drive: vi.fn(), isActivated: () => true };
    });
    return { getConfig: () => config };
}

/**
 * Whether the given selectors are hidden in the document.
 * @param {Array<string>} selectors - Selectors to inspect
 * @returns {Array<string>} The selectors that are visible
 */
function visibleTargets(selectors) {
    return selectors.filter(selector => {
        const element = document.querySelector(selector);
        return element && !element.classList.contains('hidden');
    });
}

describe('tutorial transaction', () => {
    beforeEach(() => {
        localStorage.clear();
        createMarkup();
        driverMock.driver.mockReset();
    });

    it('unhides the tour targets while a tour runs', async () => {
        const tour = runningTour();
        const system = await freshTutorial();

        system.startTutorial();

        expect(driverMock.driver).toHaveBeenCalledTimes(1);
        expect(visibleTargets(TOUR_TARGETS)).toEqual(TOUR_TARGETS);

        // The tour's own destroy is the undo path of a tour that ran
        tour.getConfig().onDestroyed();
        expect(visibleTargets(TOUR_TARGETS)).toEqual([]);
        expect(system.driverObj).toBe(null);
    });

    it('restores the tour targets when the tour ends before a step settles', async () => {
        const destroy = vi.fn();
        let config = null;
        driverMock.driver.mockImplementation((given) => {
            config = given;
            return { drive: vi.fn(), destroy };
        });
        const system = await freshTutorial();

        system.startTutorial();
        expect(visibleTargets(TOUR_TARGETS)).toEqual(TOUR_TARGETS);

        // driver.js calls onDestroyStarted on every exit, but reaches
        // onDestroyed only once a step transition has settled. An exit that
        // arrives earlier - Escape during the first step - still owes the undo,
        // and finishing the destroy is what lets the driver clean up after it.
        config.onDestroyStarted();

        expect(visibleTargets(TOUR_TARGETS)).toEqual([]);
        expect(system.driverObj).toBe(null);
        expect(destroy).toHaveBeenCalledTimes(1);
    });

    it('hands focus to the primary call to action once the tour has ended', async () => {
        const tour = runningTour();
        const system = await freshTutorial();

        system.startTutorial();
        tour.getConfig().onDestroyed();

        // The driver restores its own focus after its destroy hooks, so the
        // hand-off is deferred past that frame.
        await new Promise((resolve) => requestAnimationFrame(resolve));

        expect(document.activeElement.id).toBe('start-adventure');
        expect(system.driverObj).toBe(null);
    });

    it('restores once when a tour is exited twice', async () => {
        const destroy = vi.fn();
        let config = null;
        driverMock.driver.mockImplementation((given) => {
            config = given;
            return { drive: vi.fn(), destroy };
        });
        const system = await freshTutorial();

        system.startTutorial();
        config.onDestroyStarted();
        config.onDestroyed();

        expect(destroy).toHaveBeenCalledTimes(1);
        expect(visibleTargets(TOUR_TARGETS)).toEqual([]);
    });

    it('restores the tour targets when the tour fails to start', async () => {
        driverMock.driver.mockImplementation(() => ({
            drive: () => {
                throw new Error('driver could not start');
            }
        }));
        const system = await freshTutorial();

        expect(() => system.startTutorial()).toThrow('driver could not start');

        expect(visibleTargets(TOUR_TARGETS)).toEqual([]);
        expect(system.driverObj).toBe(null);
    });

    it('restores the tour targets when the tour cannot be built', async () => {
        driverMock.driver.mockImplementation(() => {
            throw new Error('no document');
        });
        const system = await freshTutorial();

        expect(() => system.startTutorial()).toThrow('no document');

        expect(visibleTargets(TOUR_TARGETS)).toEqual([]);
        expect(system.driverObj).toBe(null);
    });

    it('restores the tour targets when no step has an element to show', async () => {
        for (const selector of ['.quest-title', '#quest-title', '#start-adventure', '#minimize-btn',
            '#music-btn', '#effects-btn', '#restart-btn', '#home-btn', '#experience-points',
            '#quest-counter', '#editor-pane', '#rego-editor', '#check-manual-btn',
            '#check-support-modules-btn', '#check-test-payload-btn', '#verify-btn',
            '#quest-back-btn', '#quest-forward-btn']) {
            const element = document.querySelector(selector);
            if (element) element.style.display = 'none';
        }
        const system = await freshTutorial();

        system.startTutorial();

        expect(driverMock.driver).not.toHaveBeenCalled();
        expect(system.driverObj).toBe(null);
        expect(visibleTargets(TOUR_TARGETS)).toEqual([]);
    });
});
