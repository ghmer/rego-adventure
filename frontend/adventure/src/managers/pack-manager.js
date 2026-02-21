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

import { fetchPacks, fetchPackDetails } from '../services/api-service.js';
import { handleApiError } from '../services/error-service.js';
import { DEFAULT_TEXT, TIMING } from '../services/constants.js';
import { tutorial } from '../tutorial.js';
import { getLocalStorage, getPackKey, STORAGE_KEYS } from '../services/storage-service.js';

/**
 * Manages quest packs and theming
 */
export class PackManager {
    constructor(state, uiManager, audioManager) {
        this.state = state;
        this.ui = uiManager;
        this.audio = audioManager;
    }

    /**
     * Load and render the list of available quest packs
     */
    async loadPackList() {
        try {
            const packs = await fetchPacks();
            return packs;
        } catch (error) {
            handleApiError(error, 'load adventures');
            throw error;
        }
    }

    /**
     * Load pack details and setup theming
     * @param {string} packId - Pack identifier
     */
    async loadPack(packId) {
        try {
            const data = await fetchPackDetails(packId);
            
            // Load pack data into state
            this.state.loadPackData(data);
            
            // Update UI with pack-specific labels
            this.ui.updateGrimoireTitle(this.state.grimoireTitle);
            this.ui.elements.verifyBtn.textContent = this.state.verifyButton;
            this.ui.updateHintButtonText(null, 0, this.state.hintButton);
            
            // Update page titles
            const adventureTitle = this.state.meta?.title || DEFAULT_TEXT.ADVENTURE_TITLE;
            this.ui.updateTitles(adventureTitle);
            
            // Load pack-specific theming
            this.loadPackTheme(packId);
            
            // Load pack-specific assets
            this.loadPackAssets(packId);
            
            // Setup music
            this.audio.setupMusic(packId);
        } catch (error) {
            handleApiError(error, 'load pack details');
            throw error;
        }
    }

    /**
     * Load pack-specific CSS theme
     * @param {string} packId - Pack identifier
     */
    loadPackTheme(packId) {
        // Remove any existing quest theme links
        const existingThemeLinks = document.querySelectorAll('[data-quest-theme]');
        existingThemeLinks.forEach(link => link.remove());
        
        // Load theme.css
        const themeLink = document.createElement('link');
        themeLink.rel = 'stylesheet';
        themeLink.href = `/quests/${packId}/theme.css`;
        themeLink.setAttribute('data-quest-theme', 'theme');
        document.head.appendChild(themeLink);
        
        // Load custom.css if it exists (for themes with special effects)
        const customLink = document.createElement('link');
        customLink.rel = 'stylesheet';
        customLink.href = `/quests/${packId}/custom.css`;
        customLink.setAttribute('data-quest-theme', 'custom');
        customLink.onerror = () => {
            // Custom CSS is optional, silently ignore if not found
            customLink.remove();
        };
        document.head.appendChild(customLink);
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
     * Load pack-specific assets (images, backgrounds)
     * Preloads all assets in parallel before displaying
     * @param {string} packId - Pack identifier
     */
    async loadPackAssets(packId) {
        const basePath = `/quests/${packId}/assets/`;
        
        // Preload all assets in parallel
        await Promise.all([
            this.preloadImage(basePath + 'npc-questgiver.png'),
            this.preloadImage(basePath + 'hero-avatar.png'),
            this.preloadImage(basePath + 'bg-adventure.jpg')
        ]);
        
        // Update NPC avatar (now guaranteed to be loaded)
        const npcAvatar = document.querySelector('.npc-avatar');
        if (npcAvatar) {
            npcAvatar.src = basePath + 'npc-questgiver.png';
            npcAvatar.onerror = () => {
                npcAvatar.src = 'public/assets/npc-questgiver.png';
            };
        }

        // Update hero avatar (now guaranteed to be loaded)
        const heroAvatar = document.querySelector('.avatar');
        if (heroAvatar) {
            heroAvatar.src = basePath + 'hero-avatar.png';
            heroAvatar.onerror = () => {
                heroAvatar.src = 'public/assets/hero-avatar.png';
            };
        }
        
        // Update background (now guaranteed to be loaded)
        document.body.style.backgroundImage = `url('${basePath}bg-adventure.jpg')`;
    }

    /**
     * Reset to default theme and assets
     */
    resetToDefaultTheme() {
        // Remove quest-specific CSS
        const questThemeLinks = document.querySelectorAll('[data-quest-theme]');
        questThemeLinks.forEach(link => link.remove());

        // Reset assets to default
        document.body.style.backgroundImage = '';
        
        const npcAvatar = document.querySelector('.npc-avatar');
        if (npcAvatar) npcAvatar.src = 'public/assets/npc-questgiver.png';

        const heroAvatar = document.querySelector('.avatar');
        if (heroAvatar) heroAvatar.src = 'public/assets/hero-avatar.png';
        
        // Reset titles to default
        this.ui.updateTitles('Rego Adventure');
    }

    /**
     * Start an adventure (new or resume)
     * @param {string} packId - Pack identifier
     */
    async startAdventure(packId) {
        // Hide perfect score button when starting new adventure
        const perfectScoreBtn = document.getElementById('perfect-score-btn');
        if (perfectScoreBtn) {
            perfectScoreBtn.style.display = 'none';
        }
        this.ui.updateQuestFooterVisibility();

        // Check if resuming by looking at localStorage (supports both old and new key formats)
        let isResuming = false;
        
        // First check new PACK_STATE format
        const packedState = getLocalStorage(getPackKey(STORAGE_KEYS.PACK_STATE, packId), null);
        if (packedState) {
            try {
                const state = JSON.parse(packedState);
                isResuming = state.questId > 0;
            } catch (e) {
                // Fall back to old format
            }
        }
        
        // If not found in new format, check old individual keys
        if (!isResuming) {
            const savedQuestId = parseInt(
                getLocalStorage(getPackKey(STORAGE_KEYS.QUEST_ID, packId), '0')
            ) || 0;
            isResuming = savedQuestId > 0;
        }
        
        // Set pack in state
        this.state.setCurrentPack(packId, isResuming);
        
        // Load pack details
        try {
            await this.loadPack(packId);
        } catch (error) {
            // Error already shown via handleApiError in loadPack
            return false;
        }
        
        // Show game interface
        this.ui.showScreen('game');
        this.ui.updateScoreDisplay(this.state.totalScore);
        
        // Show tutorial prompt when entering an adventure (not when resuming)
        if (!isResuming) {
            setTimeout(() => {
                tutorial.showTutorialPrompt();
            }, TIMING.TUTORIAL_SHOW_DELAY);
        }
        
        return isResuming;
    }

    /**
     * Return to home screen
     */
    returnHome() {
        // Hide perfect score button
        const perfectScoreBtn = document.getElementById('perfect-score-btn');
        if (perfectScoreBtn) {
            perfectScoreBtn.style.display = 'none';
        }
        this.ui.updateQuestFooterVisibility();

        // Save current progress
        this.state.savePackState();
        
        // Stop music
        this.audio.stopMusic();

        // Return to start screen
        this.ui.showScreen('start');

        // Reset theme and assets
        this.resetToDefaultTheme();
    }
}