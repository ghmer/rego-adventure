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
 * Pack Manager
 * Handles pack loading, theming, and asset management
 */

import { fetchPackDetails } from '../services/api-service.js';
import { AssetService } from '../services/asset-service.js';
import { handleApiError } from '../services/error-service.js';
import { DEFAULT_TEXT, ErrorLevel, TIMING } from '../services/constants.js';
import { showToast } from '../services/toast-service.js';
import { tutorial } from '../tutorial.js';

/**
 * Manages quest packs and theming
 */
export class PackManager {
    constructor(state, uiManager, audioManager, questManager, modalManager) {
        this.state = state;
        this.ui = uiManager;
        this.audio = audioManager;
        this.quest = questManager;
        this.modal = modalManager;
        // Generation token for the pack and theme context, the single place
        // its contract is stated: incremented by every pack entry (loadPack)
        // and by resetToDefaultTheme, and compared by an async continuation
        // before it writes. loadPack compares it once its fetch settles;
        // loadPackTheme, loadPackAssets and setupMusic compare it before they
        // start and again before they write; loadPackAssets compares it a
        // final time after preloading images.
        this.loadSeq = 0;
    }

    /**
     * Load the pack's details and apply everything that belongs to the pack:
     * state data, UI labels, page titles, theme links, asset paints and
     * music. The generation token is compared as soon as the fetch settles,
     * so an entry that has been superseded cannot write any of them - only
     * the fetch itself is allowed to finish.
     * @param {string} packId - Pack identifier
     * @returns {Promise<boolean>} false when a newer entry, or a move back to
     *   the default theme, took the page over while these details were in
     *   flight; true when this entry applied them
     * @throws {Error} Surfaced through the error service and rethrown so the
     *   caller can roll the pack entry back
     */
    async loadPack(packId) {
        const seq = ++this.loadSeq;
        try {
            const data = await fetchPackDetails(packId);

            if (seq !== this.loadSeq) return false;

            // Load pack data into state
            this.state.loadPackData(data);

            // Update UI with pack-specific labels
            this.ui.updateGrimoireTitle(this.state.label('grimoireTitle'));
            this.ui.elements.verifyBtnLabel.textContent = this.state.label('verifyButton');
            this.ui.updateHintButtonText(null, 0, this.state.label('hintButton'));

            // Update page titles
            const adventureTitle = this.state.meta?.title || DEFAULT_TEXT.ADVENTURE_TITLE;
            this.ui.updateTitles(adventureTitle);

            // The previous pack's media stops being current at this
            // handover; its elements keep painting from decoded data.
            AssetService.releaseMedia();

            // Load pack-specific theming
            this.loadPackTheme(packId, seq);

            // Load pack-specific assets (not awaited: images appear when
            // preloaded; the continuations check for staleness themselves)
            this.loadPackAssets(packId, seq);

            // Setup music
            this.audio.setupMusic(packId, seq);

            return true;
        } catch (error) {
            handleApiError(error, 'load pack details');
            throw error;
        }
    }

    /**
     * Load pack-specific CSS theme. Both stylesheets are fetched and
     * applied as inline style elements, in both authentication modes:
     * element-external requests cannot carry a bearer token, and a single
     * application path keeps the theme mechanics mode-independent.
     * custom.css is optional: when it is missing nothing is applied, which
     * is the only record of that sub-state - "pack themed" then means
     * theme.css alone. A pack is allowed to ship no custom.css, so this is
     * not an error and no UI reports it.
     * @param {string} packId - Pack identifier
     * @param {number} seq - Load sequence token from loadPack
     */
    async loadPackTheme(packId, seq) {
        if (seq !== this.loadSeq) return;

        // Remove any existing quest theme elements
        const existingThemeElements = document.querySelectorAll('[data-quest-theme]');
        existingThemeElements.forEach(element => element.remove());

        await this.applyPackStylesheet(packId, seq, 'theme', 'theme.css');
        await this.applyPackStylesheet(packId, seq, 'custom', 'custom.css', true);
    }

    /**
     * Fetch one pack stylesheet and append it as a style element. A failed
     * or absent sheet applies nothing; the pack renders unthemed.
     * @param {string} packId - Pack identifier
     * @param {number} seq - Load sequence token from loadPack
     * @param {string} variant - data-quest-theme value (theme or custom)
     * @param {string} filename - Stylesheet file in the pack directory
     * @param {boolean} [optional=false] - Treat a missing sheet as absent
     */
    async applyPackStylesheet(packId, seq, variant, filename, optional = false) {
        const url = `/quests/${packId}/${filename}`;
        let text;
        try {
            text = await AssetService.styleSheetText(url, optional);
        } catch (error) {
            console.warn(`Pack stylesheet ${url} could not be applied:`, error);
            return;
        }
        if (text === null || seq !== this.loadSeq) return;

        const style = document.createElement('style');
        style.setAttribute('data-quest-theme', variant);
        style.textContent = text;
        document.head.appendChild(style);
    }

    /**
     * Preload a single asset image
     * @param {string} src - Image source URL
     * @returns {Promise} Promise that resolves when image loads
     */
    preloadImage(src) {
        return new Promise((resolve) => {
            const img = new Image();
            img.onload = () => resolve(src);
            img.onerror = () => resolve(null);
            img.src = src;
        });
    }

    /**
     * Load pack-specific assets (images, backgrounds).
     * Media is resolved for element use first (a blob URL when pack media
     * is token-protected, the plain path otherwise); a failed resolution
     * keeps the plain path, so the element's error handling decides what
     * a missing asset looks like. Preloads all assets in parallel before
     * displaying. The preload is async; the sequence token discards the
     * writes if another pack (or the home screen) took over in the
     * meantime.
     * @param {string} packId - Pack identifier
     * @param {number} seq - Load sequence token from loadPack
     */
    async loadPackAssets(packId, seq) {
        if (seq !== this.loadSeq) return;
        const basePath = `/quests/${packId}/assets/`;

        // Resolve and preload all assets in parallel
        const loadOne = async (name) => {
            const source = basePath + name;
            try {
                const resolved = await AssetService.mediaURL(source);
                await this.preloadImage(resolved);
                return resolved;
            } catch (error) {
                console.warn(`Pack asset ${source} could not be resolved:`, error);
                await this.preloadImage(source);
                return source;
            }
        };

        const [npcSource, heroSource, backgroundSource] = await Promise.all([
            loadOne('npc-questgiver.png'),
            loadOne('hero-avatar.png'),
            loadOne('bg-adventure.jpg')
        ]);

        if (seq !== this.loadSeq) return;

        // Update NPC avatar (now guaranteed to be loaded)
        const npcAvatar = document.querySelector('.npc-avatar');
        if (npcAvatar) {
            npcAvatar.src = npcSource;
            npcAvatar.onerror = () => {
                npcAvatar.src = '/public/assets/npc-questgiver.png';
            };
        }

        // Update hero avatar (now guaranteed to be loaded)
        const heroAvatar = document.querySelector('.avatar');
        if (heroAvatar) {
            heroAvatar.src = heroSource;
            heroAvatar.onerror = () => {
                heroAvatar.src = '/public/assets/hero-avatar.png';
            };
        }
        
        // Update background (now guaranteed to be loaded)
        document.body.style.backgroundImage = `url('${backgroundSource}')`;
    }

    /**
     * Reset to default theme and assets. Bumps the sequence so any
     * in-flight asset preload for a pack cannot paint afterwards.
     */
    resetToDefaultTheme() {
        this.loadSeq++;
        this.audio.invalidateTrack();
        AssetService.releaseMedia();
        // Remove quest-specific CSS
        const questThemeElements = document.querySelectorAll('[data-quest-theme]');
        questThemeElements.forEach(element => element.remove());

        // Reset assets to default
        document.body.style.backgroundImage = '';
        
        const npcAvatar = document.querySelector('.npc-avatar');
        if (npcAvatar) npcAvatar.src = '/public/assets/npc-questgiver.png';

        const heroAvatar = document.querySelector('.avatar');
        if (heroAvatar) heroAvatar.src = '/public/assets/hero-avatar.png';
        
        // Reset titles to default
        this.ui.updateTitles('Rego Adventure');
    }

    /**
     * Start an adventure (new or resume).
     * @param {string} packId - Pack identifier
     * @returns {Promise<boolean>} false when the entry was superseded by a
     *   newer one, in which case the caller must not continue into the pack;
     *   true when the pack is loaded and on screen
     * @throws {Error} If the pack details fail to load. The pack entry is
     *   rolled back before the error propagates: no pack pointer and no
     *   pack-scoped state survive a failed entry.
     */
    async startAdventure(packId) {
        this.clearPackCaches();
        this.ui.renderPerfectScoreButton(false);
        this.ui.resetInterfaceMinimized();

        // Set pack in state; the entry it returns says whether there is saved
        // progress to resume, and whether a saved body could not be read
        const entry = this.state.setCurrentPack(packId);
        const isResuming = entry.resumed !== null;
        if (entry.corrupt) {
            showToast(
                `Saved progress for pack "${packId}" could not be read. It is kept aside and the adventure starts fresh.`,
                ErrorLevel.WARNING
            );
        }

        // Load pack details (errors are shown via handleApiError in loadPack)
        let applied;
        try {
            applied = await this.loadPack(packId);
        } catch (error) {
            this.state.rollbackPackEntry();
            throw error;
        }
        if (!applied) return false;

        // Show game interface
        this.ui.showScreen('game');
        this.ui.updateScoreDisplay(this.state.totalScore);

        // The tour is offered on a fresh entry only. A resumed adventure finds
        // the player mid-policy, where a tour would interrupt the work they came
        // back to; the offer stays open to them until they take it.
        if (!isResuming) {
            setTimeout(() => {
                tutorial.showTutorialPrompt();
            }, TIMING.TUTORIAL_SHOW_DELAY);
        }

        return true;
    }

    /**
     * Drop the texts and payloads that a pack visit fetched: reveal texts,
     * test payloads and support module sources belong to the pack that is
     * open, and entering a pack, leaving it and restarting its progress each
     * end what the previous state of that visit relied on.
     */
    clearPackCaches() {
        this.quest.clearCaches();
        this.modal.clearCaches();
    }

    /**
     * Return to home screen
     */
    returnHome() {
        this.clearPackCaches();
        this.ui.renderPerfectScoreButton(false);
        this.ui.resetInterfaceMinimized();

        // Flush progress and clear the active pack pointer so a reload
        // stays on the start screen; progress itself is kept for resume
        this.state.clearCurrentPack();
        
        // Stop music
        this.audio.stopMusic();

        // Return to start screen
        this.ui.showScreen('start');

        // Reset theme and assets
        this.resetToDefaultTheme();
    }
}