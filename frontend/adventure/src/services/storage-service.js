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
 * Storage Service
 * Provides localStorage access with error handling and pack-scoped keys
 */

/**
 * Get an item from localStorage
 * @param {string} key - The storage key
 * @param {*} defaultValue - Default value if key doesn't exist or access fails
 * @returns {string|null} The stored value or default
 */
export function getLocalStorage(key, defaultValue = null) {
    try {
        return localStorage.getItem(key) || defaultValue;
    } catch (e) {
        console.error('localStorage access failed:', e);
        return defaultValue;
    }
}

/**
 * Set an item in localStorage
 * @param {string} key - The storage key
 * @param {string} value - The value to store
 * @returns {boolean} True if successful, false otherwise
 */
export function setLocalStorage(key, value) {
    try {
        localStorage.setItem(key, value);
        return true;
    } catch (e) {
        console.error('localStorage write failed:', e);
        return false;
    }
}

/**
 * Remove an item from localStorage
 * @param {string} key - The storage key
 * @returns {boolean} True if successful, false otherwise
 */
export function removeLocalStorage(key) {
    try {
        localStorage.removeItem(key);
        return true;
    } catch (e) {
        console.error('localStorage remove failed:', e);
        return false;
    }
}

/**
 * Create a pack-scoped localStorage key
 * @param {string} baseKey - The base key name
 * @param {string} packId - The pack identifier
 * @returns {string} The scoped key
 */
export function getPackKey(baseKey, packId) {
    return packId ? `${baseKey}_${packId}` : baseKey;
}

/**
 * Clear all grimoires for a specific pack
 * @param {string} packId - The pack identifier
 */
export function clearAllGrimoires(packId) {
    try {
        const keys = Object.keys(localStorage);
        keys.forEach(key => {
            if (key.startsWith(`rego_grimoire_q`) && key.includes(`_${packId}`)) {
                removeLocalStorage(key);
            }
        });
    } catch (e) {
        console.error('Failed to clear grimoires:', e);
    }
}

/**
 * Storage keys used throughout the application
 */
export const STORAGE_KEYS = {
    PACK_ID: 'rego_pack_id',
    QUEST_ID: 'rego_quest_id',
    ACTIVE_QUEST_ID: 'rego_active_quest_id',
    TOTAL_SCORE: 'rego_total_score',
    QUEST_SCORES: 'rego_quest_scores',
    EFFECTS_ENABLED: 'rego_effects_enabled',
    TUTORIAL_COMPLETED: 'adventureTutorialCompleted'
};