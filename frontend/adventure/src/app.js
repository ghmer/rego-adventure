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

// Show content after styles load: adds 'loaded' class to transition from hidden to visible
document.addEventListener('DOMContentLoaded', () => {
    document.documentElement.classList.add('loaded');
});

/**
 * Main Application Entry Point
 * Coordinates all managers and initializes the application
 */

import { ConfigService } from './services/config-service.js';
import { AuthService } from './services/auth-service.js';
import { GameState } from './services/state-service.js';
import { UIManager } from './managers/ui-manager.js';
import { QuestManager } from './managers/quest-manager.js';
import { AudioManager } from './managers/audio-manager.js';
import { ModalManager } from './managers/modal-manager.js';
import { PackManager } from './managers/pack-manager.js';
import { EventManager } from './managers/event-manager.js';

// Initialize managers
const state = new GameState();
const uiManager = new UIManager();
const audioManager = new AudioManager(uiManager);
const questManager = new QuestManager(state, uiManager);
const modalManager = new ModalManager(state, uiManager);
const packManager = new PackManager(state, uiManager, audioManager);
const eventManager = new EventManager(state, uiManager, questManager, audioManager, modalManager, packManager);

/**
 * Initialize the application
 */
async function init() {
    try {
        // Initialize and apply effects state (loads from localStorage and updates UI)
        uiManager.initEffectsState();
        
        // Load Config and Init Auth
        await ConfigService.load();
        await AuthService.init();

        // Handle impressum footer visibility based on config
        const config = ConfigService.get();
        const impressumFooter = document.querySelector('.start-footer');
        if (impressumFooter && !config.show_impressum) {
            impressumFooter.style.display = 'none';
        }

        // Setup event listeners early so login button works
        eventManager.setupEventListeners();

        // Handle authentication
        if (AuthService.isEnabled()) {
            const user = await AuthService.getUser();
            if (!user) {
                // Show login button, hide quest pack list and logout button
                uiManager.elements.loginContainer.classList.remove('hidden');
                uiManager.elements.questPackList.style.display = 'none';
                uiManager.elements.logoutBtn.style.display = 'none';
                return; // Stop initialization until logged in
            } else {
                // Show logout button, hide login button
                uiManager.elements.logoutBtn.style.display = 'inline-block';
                uiManager.elements.loginContainer.style.display = 'none';
                uiManager.elements.questPackList.style.display = 'block';
            }
        } else {
            // Auth not enabled - hide both auth buttons
            uiManager.elements.loginContainer.style.display = 'none';
            uiManager.elements.logoutBtn.style.display = 'none';
        }

        // Load pack list
        const packs = await packManager.loadPackList();
        uiManager.renderPackList(packs, async (packId) => {
            const isResuming = await packManager.startAdventure(packId);
            questManager.loadQuest(state.currentQuestId);
        });
        
        // If we have a saved pack and quest, try to resume
        if (state.currentPackId && state.currentQuestId >= 0) {
            try {
                const isResuming = await packManager.startAdventure(state.currentPackId);
                questManager.loadQuest(state.currentQuestId);
            } catch (e) {
                console.error("Failed to resume:", e);
                // Fallback to start screen
                state.currentPackId = null;
                state.currentQuestId = 0;
            }
        }
    } catch (error) {
        console.error("Failed to initialize:", error);
        uiManager.elements.questPackList.innerHTML = "<p>Error loading adventures. Is the backend running?</p>";
    }
}

// Start the application
init();

// Initialize quest-footer visibility on page load
document.addEventListener('DOMContentLoaded', () => {
    uiManager.updateQuestFooterVisibility();
});