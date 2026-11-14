/*
   Copyright 2026 Mario Enrico Ragucci

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
import { PackManager } from './pack-manager.js';
import { GameState } from '../services/state-service.js';
import { ConfigService } from '../services/config-service.js';
import {
    getLocalStorage, setLocalStorage, getPackKey, getCorruptPackKey, STORAGE_KEYS
} from '../services/storage-service.js';
import { ErrorLevel, TIMING } from '../services/constants.js';

const apiMock = vi.hoisted(() => ({
    fetchPackDetails: vi.fn()
}));

vi.mock('../services/api-service.js', async (importOriginal) => {
    const actual = await importOriginal();
    return { ...actual, fetchPackDetails: apiMock.fetchPackDetails };
});
vi.mock('../services/error-service.js', () => ({ handleApiError: vi.fn() }));

const tutorialMock = vi.hoisted(() => ({ showTutorialPrompt: vi.fn() }));
vi.mock('../tutorial.js', () => ({ tutorial: { showTutorialPrompt: tutorialMock.showTutorialPrompt } }));

const toastMock = vi.hoisted(() => ({ showToast: vi.fn() }));
vi.mock('../services/toast-service.js', () => ({ showToast: toastMock.showToast }));

import { handleApiError } from '../services/error-service.js';

/**
 * Pack payload in the shape the API returns.
 * @param {string} packId - Pack identifier
 * @param {number} questCount - Number of quests to generate
 * @returns {Object} Pack details
 */
function packData(packId, questCount = 2) {
    return {
        quests: Array.from({ length: questCount }, (_, i) => ({
            id: i + 1,
            title: `${packId} quest ${i + 1}`,
            hints_count: 1
        })),
        prologue: [`${packId} prologue`],
        epilogue: [`${packId} epilogue`],
        meta: { title: `${packId} title` },
        ui_labels: {
            grimoire_title: `${packId} grimoire`,
            verify_button: `${packId} verify`,
            hint_button: `${packId} hint`
        }
    };
}

/**
 * UI double for the operations loadPack and startAdventure perform.
 * @returns {Object} UI manager double
 */
function createUi() {
    return {
        elements: { verifyBtnLabel: document.createElement('span') },
        updateGrimoireTitle: vi.fn(),
        updateHintButtonText: vi.fn(),
        updateTitles: vi.fn(),
        renderPerfectScoreButton: vi.fn(),
        resetInterfaceMinimized: vi.fn(),
        showScreen: vi.fn(),
        updateScoreDisplay: vi.fn()
    };
}

/**
 * Wire a pack manager to a fresh state, UI double and audio double.
 * @returns {Object} { state, ui, audio, pack }
 */
function createFixture() {
    const state = new GameState();
    const ui = createUi();
    const audio = { setupMusic: vi.fn(), stopMusic: vi.fn(), invalidateTrack: vi.fn() };
    const quest = { clearCaches: vi.fn() };
    const modal = { clearCaches: vi.fn() };
    return {
        state,
        ui,
        audio,
        quest,
        modal,
        pack: new PackManager(state, ui, audio, quest, modal)
    };
}

/**
 * Quest theme style elements currently in the document head.
 * @returns {Array<HTMLStyleElement>} data-quest-theme tagged elements
 */
function themeElements() {
    return Array.from(document.querySelectorAll('[data-quest-theme]'));
}

/**
 * Applied quest theme variants in the document head.
 * @returns {Array<string>} data-quest-theme values
 */
function themeVariants() {
    return themeElements().map(element => element.getAttribute('data-quest-theme'));
}

/**
 * Stub the global fetch for pack requests: stylesheets answer CSS text,
 * custom.css answers 404. Alpha URLs are marked in the body, so tests can
 * tell which pack a stylesheet came from.
 */
function stubPackStylesheets() {
    vi.stubGlobal('fetch', vi.fn(async (url) => {
        if (typeof url === 'string' && url.endsWith('custom.css')) {
            return new Response('not found', { status: 404 });
        }
        const body = typeof url === 'string' && url.includes('alpha') ? 'alpha{}' : 'beta{}';
        return new Response(body, { status: 200 });
    }));
}

describe('PackManager', () => {
    beforeEach(() => {
        localStorage.clear();
        apiMock.fetchPackDetails.mockReset();
        handleApiError.mockReset();
        tutorialMock.showTutorialPrompt.mockReset();
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
        document.querySelectorAll('[data-quest-theme]').forEach(link => link.remove());
        document.querySelectorAll('.npc-avatar, .avatar').forEach(el => el.remove());
        document.body.style.backgroundImage = '';
    });

    describe('authenticated pack media', () => {
        /** Point a pair of avatar elements at the fixture DOM. */
        function mountAvatars() {
            const npc = document.createElement('img');
            npc.className = 'npc-avatar';
            const hero = document.createElement('img');
            hero.className = 'avatar';
            document.body.append(npc, hero);
            return { npc, hero };
        }

        /**
         * Enable authentication in ConfigService, which AuthService reads,
         * and stub global fetch plus blob URL creation.
         */
        function enableAuth(fetchMock) {
            vi.stubGlobal('fetch', fetchMock);
            ConfigService.config = { enabled: true };
            const createObjectURL = vi.fn(() => 'blob:test-1');
            const original = Object.getOwnPropertyDescriptor(URL, 'createObjectURL');
            Object.defineProperty(URL, 'createObjectURL', { value: createObjectURL, configurable: true });
            return () => {
                if (original) Object.defineProperty(URL, 'createObjectURL', original);
            };
        }

        afterEach(() => {
            ConfigService.config = null;
        });

        it('paints pack media from blob URLs when authentication is enabled', async () => {
            const fetchMock = vi.fn(async () => new Response('png-bytes', { status: 200 }));
            const restore = enableAuth(fetchMock);
            const { pack } = createFixture();
            mountAvatars();
            pack.preloadImage = vi.fn(async src => src);

            await pack.loadPackAssets('alpha', pack.loadSeq);

            expect(fetchMock).toHaveBeenCalledWith('/quests/alpha/assets/npc-questgiver.png',
                expect.objectContaining({ headers: {} }));
            expect(document.querySelector('.npc-avatar').getAttribute('src')).toBe('blob:test-1');
            expect(document.querySelector('.avatar').getAttribute('src')).toBe('blob:test-1');
            expect(document.body.style.backgroundImage).toContain('blob:test-1');
            restore();
        });

        it('keeps the plain path when resolution fails, letting the element error handling decide', async () => {
            const fetchMock = vi.fn(async () => new Response('denied', { status: 401 }));
            const restore = enableAuth(fetchMock);
            const { pack } = createFixture();
            const { npc } = mountAvatars();
            pack.preloadImage = vi.fn(async src => src);

            await pack.loadPackAssets('alpha', pack.loadSeq);

            expect(fetchMock).toHaveBeenCalledTimes(3);
            expect(npc.getAttribute('src')).toBe('/quests/alpha/assets/npc-questgiver.png');
            restore();
        });
    });

    describe('caches of one pack visit', () => {
        it('drops what was fetched when a pack is entered and when it is left', async () => {
            apiMock.fetchPackDetails.mockResolvedValue(packData('alpha'));
            const { pack, quest, modal } = createFixture();

            await pack.startAdventure('alpha');

            expect(quest.clearCaches).toHaveBeenCalledTimes(1);
            expect(modal.clearCaches).toHaveBeenCalledTimes(1);

            pack.returnHome();

            expect(quest.clearCaches).toHaveBeenCalledTimes(2);
            expect(modal.clearCaches).toHaveBeenCalledTimes(2);
        });
    });

    describe('perfect-score button', () => {
        it('is rendered hidden when a pack is entered and when it is left', async () => {
            apiMock.fetchPackDetails.mockResolvedValue(packData('alpha'));
            const { ui, pack } = createFixture();

            await pack.startAdventure('alpha');

            expect(ui.renderPerfectScoreButton).toHaveBeenCalledTimes(1);
            expect(ui.renderPerfectScoreButton).toHaveBeenCalledWith(false);

            pack.returnHome();

            expect(ui.renderPerfectScoreButton).toHaveBeenCalledTimes(2);
        });
    });

    describe('interface minimize', () => {
        it('returns a minimized interface to normal when a pack is entered and left', async () => {
            apiMock.fetchPackDetails.mockResolvedValue(packData('alpha'));
            const { ui, pack } = createFixture();

            await pack.startAdventure('alpha');
            expect(ui.resetInterfaceMinimized).toHaveBeenCalledTimes(1);

            pack.returnHome();
            expect(ui.resetInterfaceMinimized).toHaveBeenCalledTimes(2);
        });
    });

    describe('entering a pack', () => {
        it('keeps an unreadable saved body aside and says so', async () => {
            apiMock.fetchPackDetails.mockResolvedValue(packData('alpha'));
            const corruptBody = 'not json{';
            setLocalStorage(getPackKey(STORAGE_KEYS.PACK_STATE, 'alpha'), corruptBody);

            const { pack } = createFixture();
            await pack.startAdventure('alpha');

            expect(getLocalStorage(getCorruptPackKey(STORAGE_KEYS.PACK_STATE, 'alpha')))
                .toBe(corruptBody);
            expect(toastMock.showToast)
                .toHaveBeenCalledWith(expect.stringContaining('alpha'), ErrorLevel.WARNING);
        });

        it('applies data, labels, titles, theme styles and music', async () => {
            stubPackStylesheets();
            apiMock.fetchPackDetails.mockResolvedValue(packData('alpha'));
            const { state, ui, audio, pack } = createFixture();

            const entered = await pack.startAdventure('alpha');
            await vi.advanceTimersByTimeAsync(0);

            expect(entered).toBe(true);
            expect(apiMock.fetchPackDetails).toHaveBeenCalledWith('alpha');
            expect(state.quests).toHaveLength(2);
            expect(state.questsMap.get(2).title).toBe('alpha quest 2');
            expect(ui.updateGrimoireTitle).toHaveBeenCalledWith('alpha grimoire');
            expect(ui.elements.verifyBtnLabel.textContent).toBe('alpha verify');
            expect(ui.updateHintButtonText).toHaveBeenCalledWith(null, 0, 'alpha hint');
            expect(ui.updateTitles).toHaveBeenCalledWith('alpha title');
            expect(themeVariants()).toEqual(['theme']);
            expect(audio.setupMusic).toHaveBeenCalledWith('alpha', expect.any(Number));
            expect(ui.showScreen).toHaveBeenCalledWith('game');
        });

        it('offers the tutorial when entering without saved progress', async () => {
            apiMock.fetchPackDetails.mockResolvedValue(packData('alpha'));
            const { state, pack } = createFixture();

            await pack.startAdventure('alpha');
            vi.advanceTimersByTime(TIMING.TUTORIAL_SHOW_DELAY);
            expect(tutorialMock.showTutorialPrompt).toHaveBeenCalledTimes(1);

            // A second entry now has a saved position to resume, so the
            // prompt is not offered again
            tutorialMock.showTutorialPrompt.mockClear();
            state.enterQuest(1);
            await pack.startAdventure('alpha');
            vi.advanceTimersByTime(TIMING.TUTORIAL_SHOW_DELAY);
            expect(tutorialMock.showTutorialPrompt).not.toHaveBeenCalled();
        });
    });

    describe('theming', () => {
        it('applies theme.css and skips the optional custom.css when it is missing', async () => {
            stubPackStylesheets();
            const { pack } = createFixture();

            await pack.loadPackTheme('alpha', pack.loadSeq);

            // "pack themed" can mean theme.css alone: the optional stylesheet
            // applies nothing when it is absent, and nothing else changes
            expect(themeVariants()).toEqual(['theme']);
            expect(themeElements()[0].textContent).toBe('alpha{}');
        });

        it('replaces the previous pack theme wholesale', async () => {
            vi.stubGlobal('fetch', vi.fn(async url =>
                new Response(url.includes('alpha') ? 'alpha{}' : 'beta{}', { status: 200 })));
            const { pack } = createFixture();

            await pack.loadPackTheme('alpha', pack.loadSeq);
            await pack.loadPackTheme('beta', pack.loadSeq);

            expect(themeVariants()).toEqual(['theme', 'custom']);
            expect(themeElements().map(element => element.textContent)).toEqual(['beta{}', 'beta{}']);
        });
    });

    describe('superseded loads', () => {
        it('discards every write of a load whose details arrived late', async () => {
            let releaseAlpha;
            apiMock.fetchPackDetails.mockImplementation(packId => {
                if (packId === 'alpha') {
                    return new Promise(resolve => { releaseAlpha = resolve; });
                }
                return Promise.resolve(packData('beta'));
            });
            const { state, ui, pack } = createFixture();
            stubPackStylesheets();

            const alpha = pack.loadPack('alpha');
            const beta = pack.loadPack('beta');
            await beta;
            releaseAlpha(packData('alpha'));
            const applied = await alpha;

            expect(applied).toBe(false);
            expect(state.quests.map(q => q.title)).toEqual(['beta quest 1', 'beta quest 2']);
            await vi.advanceTimersByTimeAsync(0);
            expect(themeVariants()).toEqual(['theme']);
            expect(themeElements().some(element => element.textContent.includes('alpha'))).toBe(false);
            expect(ui.updateTitles).toHaveBeenCalledWith('beta title');
            expect(ui.updateTitles).not.toHaveBeenCalledWith('alpha title');
        });

        it('discards a load that a move back to the default theme superseded', async () => {
            let releaseAlpha;
            apiMock.fetchPackDetails.mockImplementation(() => new Promise(resolve => { releaseAlpha = resolve; }));
            const { state, pack } = createFixture();

            const alpha = pack.loadPack('alpha');
            pack.resetToDefaultTheme();
            releaseAlpha(packData('alpha'));

            expect(await alpha).toBe(false);
            expect(state.quests).toEqual([]);
            await vi.advanceTimersByTimeAsync(0);
            expect(themeVariants()).toEqual([]);
        });

        it('does not take the game screen into when its entry was superseded', async () => {
            let releaseAlpha;
            apiMock.fetchPackDetails.mockImplementation(packId => {
                if (packId === 'alpha') {
                    return new Promise(resolve => { releaseAlpha = resolve; });
                }
                return Promise.resolve(packData('beta'));
            });
            const { ui, pack } = createFixture();

            const alpha = pack.startAdventure('alpha');
            await pack.startAdventure('beta');
            releaseAlpha(packData('alpha'));

            expect(await alpha).toBe(false);
            expect(ui.showScreen).toHaveBeenCalledTimes(1);
            expect(ui.updateScoreDisplay).toHaveBeenCalledTimes(1);
        });

        it('stops painting assets once the generation moved on', async () => {
            const { pack } = createFixture();
            const npc = document.createElement('img');
            npc.className = 'npc-avatar';
            const hero = document.createElement('img');
            hero.className = 'avatar';
            document.body.append(npc, hero);

            pack.preloadImage = vi.fn(async src => src);

            const inFlight = pack.loadPack('alpha');
            const seq = pack.loadSeq;
            pack.resetToDefaultTheme();
            await pack.loadPackAssets('alpha', seq);
            expect(await inFlight).toBe(false);

            expect(npc.getAttribute('src')).toBe('/public/assets/npc-questgiver.png');
            expect(hero.getAttribute('src')).toBe('/public/assets/hero-avatar.png');
            expect(document.body.style.backgroundImage).toBe('');
            expect(themeVariants()).toEqual([]);

            await pack.loadPackAssets('alpha', pack.loadSeq);

            expect(npc.getAttribute('src')).toBe('/quests/alpha/assets/npc-questgiver.png');
            expect(hero.getAttribute('src')).toBe('/quests/alpha/assets/hero-avatar.png');
            expect(document.body.style.backgroundImage).toContain('/quests/alpha/assets/bg-adventure.jpg');
        });
    });

    describe('failed load', () => {
        it('leaves no pack-scoped state behind', async () => {
            apiMock.fetchPackDetails.mockResolvedValue(packData('alpha'));
            const { state, ui, audio, pack } = createFixture();
            await pack.startAdventure('alpha');

            // Progress in the loaded pack, then an entry that cannot load
            state.currentQuestId = 2;
            state.completeQuest(1);
            apiMock.fetchPackDetails.mockRejectedValue(new Error('pack unavailable'));

            await expect(pack.startAdventure('beta')).rejects.toThrow('pack unavailable');

            expect(handleApiError).toHaveBeenCalledWith(expect.any(Error), 'load pack details');
            expect(state.currentPackId).toBeNull();
            expect(getLocalStorage(STORAGE_KEYS.PACK_ID)).toBeNull();
            expect(state.quests).toEqual([]);
            expect(state.questsMap.size).toBe(0);
            expect(state.meta).toBeNull();
            expect(state.currentQuestId).toBe(0);
            expect(state.activeQuestId).toBe(0);
            expect(state.totalScore).toBe(0);
            expect(state.questScores).toEqual({});
            expect(state.questHints).toEqual({});
            expect(state.grimoires).toEqual({});
            expect(ui.showScreen).toHaveBeenCalledTimes(1);
            expect(audio.setupMusic).toHaveBeenCalledTimes(1);

            // The progress that was already saved survives untouched
            const savedAlpha = JSON.parse(getLocalStorage(getPackKey(STORAGE_KEYS.PACK_STATE, 'alpha')));
            expect(savedAlpha.questId).toBe(2);
            expect(savedAlpha.questScores[1].pointsEarned).toBe(10);
        });

        it('keeps the pack list ready after a failed resume entry', async () => {
            apiMock.fetchPackDetails.mockRejectedValue(new Error('pack unavailable'));
            const { state, ui, pack } = createFixture();
            localStorage.setItem(STORAGE_KEYS.PACK_ID, 'alpha');

            await expect(pack.startAdventure('alpha')).rejects.toThrow('pack unavailable');

            expect(state.currentPackId).toBeNull();
            expect(getLocalStorage(STORAGE_KEYS.PACK_ID)).toBeNull();
            expect(ui.showScreen).not.toHaveBeenCalled();
        });
    });

    describe('leaving a pack', () => {
        it('flushes progress and keeps the saved body for resume', async () => {
            apiMock.fetchPackDetails.mockResolvedValue(packData('alpha'));
            const { state, audio, pack } = createFixture();
            await pack.startAdventure('alpha');
            state.currentQuestId = 1;
            state.completeQuest(1);

            pack.returnHome();

            expect(getLocalStorage(STORAGE_KEYS.PACK_ID)).toBeNull();
            expect(audio.stopMusic).toHaveBeenCalledTimes(1);
            const saved = JSON.parse(getLocalStorage(getPackKey(STORAGE_KEYS.PACK_STATE, 'alpha')));
            expect(saved.questId).toBe(1);
            expect(saved.questScores[1].pointsEarned).toBe(10);
        });
    });
});
