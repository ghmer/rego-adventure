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
// Guard with readyState in case the event has already fired before this module executes.
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        document.documentElement.classList.add('loaded');
    });
} else {
    document.documentElement.classList.add('loaded');
}

/**
 * Main Application Entry Point
 * Coordinates all managers and initializes the application
 */

import { ConfigService } from './services/config-service.js';
import { AuthService } from './services/auth-service.js';
import { ApiError, fetchPacks } from './services/api-service.js';
import { GameState } from './services/state-service.js';
import { ErrorLevel } from './services/constants.js';
import { showToast } from './services/toast-service.js';
import { migrateStorageKeys } from './services/storage-service.js';
import { EditorService } from './services/editor-service.js';
import { UIManager } from './managers/ui-manager.js';
import { GrimoireAutosave } from './managers/grimoire-autosave.js';
import { QuestManager } from './managers/quest-manager.js';
import { AudioManager } from './managers/audio-manager.js';
import { ModalManager } from './managers/modal-manager.js';
import { PackManager } from './managers/pack-manager.js';
import { EventManager } from './managers/event-manager.js';

// Initialize managers; the editor service mounts the Yace editor before the
// UI manager so the manager can reference the native textarea inside it
const editorService = new EditorService('#rego-editor');
const state = new GameState();
const uiManager = new UIManager(editorService);
const audioManager = new AudioManager(uiManager);
const grimoireAutosave = new GrimoireAutosave(state, uiManager);
const questManager = new QuestManager(state, uiManager, grimoireAutosave);
const modalManager = new ModalManager(state, uiManager);
const packManager = new PackManager(state, uiManager, audioManager, questManager, modalManager);
const eventManager = new EventManager(
    state, uiManager, questManager, audioManager, modalManager, packManager, grimoireAutosave
);

/**
 * Start (or resume) the given pack and load its current quest.
 * Guarded against concurrent starts: the resume path races the pack
 * cards (rendered and clickable before the resume completes), and two
 * interleaved startAdventure sequences would mix state from two packs.
 * @param {string} packId - Pack identifier
 */
let beginQuestInFlight = false;
async function beginQuest(packId) {
    if (beginQuestInFlight) {
        showToast('An adventure is already loading. Please wait for it.', ErrorLevel.INFO);
        return;
    }
    beginQuestInFlight = true;
    try {
        const entered = await packManager.startAdventure(packId);
        if (!entered) return;
        questManager.loadQuest(state.currentQuestId);
    } finally {
        beginQuestInFlight = false;
    }
}

/**
 * Initialize the application
 */
async function init() {
    try {
        // Initialize and apply effects state (loads from localStorage and updates UI)
        uiManager.initEffectsState();
        
        // Load Config and Init Auth
        // A config failure must not silently disable authentication;
        // surface a clear error and stop initialization.
        try {
            await ConfigService.load();
        } catch (error) {
            console.error('Configuration could not be loaded:', error);
            uiManager.elements.questPackList.innerHTML =
                '<p>Configuration could not be loaded. Is the backend running? Authentication state is unknown.</p>';
            return;
        }
        await AuthService.init();

        // Handle impressum footer visibility based on config
        const config = ConfigService.get();
        uiManager.updateImpressumVisibility(config.show_impressum);

        // Setup event listeners early so login button works
        eventManager.setupEventListeners();

        // Handle authentication
        const authEnabled = AuthService.isEnabled();
        let isAuthenticated = false;
        
        if (authEnabled) {
            const user = await AuthService.getUser();
            isAuthenticated = !!user;
        }
        
        uiManager.updateAuthUI(isAuthenticated, authEnabled);
        
        if (authEnabled && !isAuthenticated) {
            return; // Stop initialization until logged in
        }

        // Load pack list
        const packs = await fetchPacks();
        uiManager.renderPackList(packs, async (packId) => {
            try {
                await beginQuest(packId);
            } catch (e) {
                console.error("Failed to start adventure:", e);
            }
        });

        // If we have a saved pack, try to resume
        if (state.currentPackId) {
            try {
                await beginQuest(state.currentPackId);
            } catch (e) {
                // A failed entry is rolled back where it was made: the
                // pointer and all pack-scoped state are gone, so this page
                // load stays on the pack list
                console.error('Failed to resume:', e);
            }
        }
    } catch (error) {
        console.error("Failed to initialize:", error);
        if (error instanceof ApiError && error.status === 401) {
            uiManager.elements.questPackList.innerHTML =
                '<p>Your session has expired. Please log out and log in again.</p>';
        } else {
            uiManager.elements.questPackList.innerHTML = "<p>Error loading adventures. Is the backend running?</p>";
        }
    }
}

// Start the application
// Move legacy storage values to the current key scheme before any
// manager reads persisted state.
migrateStorageKeys();
init();