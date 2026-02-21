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
 * API Service
 * Handles all HTTP communication with the backend
 */

import { API } from './constants.js';
import { AuthService } from './auth-service.js';

/**
 * Helper to perform authenticated fetch requests with timeout support
 * @param {string} url - The URL to fetch
 * @param {Object} options - Fetch options
 * @param {number} timeout - Timeout in milliseconds (default: 30000)
 * @returns {Promise<Response>} The fetch response
 */
async function fetchWithAuth(url, options = {}, timeout = 30000) {
    const headers = { 'Content-Type': 'application/json' };
    const token = await AuthService.getToken();
    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }
    
    // Create abort controller for timeout support
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    
    const config = {
        ...options,
        headers: {
            ...headers,
            ...options.headers
        },
        signal: controller.signal
    };
    
    try {
        return await fetch(url, config);
    } catch (error) {
        if (error.name === 'AbortError') {
            throw new Error(`Request timeout after ${timeout}ms`);
        }
        throw error;
    } finally {
        clearTimeout(timeoutId);
    }
}

/**
 * Fetch all available quest packs
 * @returns {Promise<Array>} Array of quest pack summaries
 * @throws {Error} If the request fails
 */
export async function fetchPacks() {
    const response = await fetchWithAuth(`${API.BASE_URL}/packs`);
    
    if (!response.ok) {
        throw new Error('Failed to fetch packs');
    }
    
    return await response.json();
}

/**
 * Fetch detailed information for a specific quest pack
 * @param {string} packId - The pack identifier
 * @returns {Promise<Object>} Quest pack details including quests, prologue, epilogue, and metadata
 * @throws {Error} If the request fails
 */
export async function fetchPackDetails(packId) {
    const response = await fetchWithAuth(`${API.BASE_URL}/packs/${packId}`);
    
    if (!response.ok) {
        throw new Error('Failed to fetch pack details');
    }
    
    return await response.json();
}

/**
 * Fetch test payload data for a specific quest
 * @param {string} packId - The pack identifier
 * @param {number} questId - The quest identifier
 * @returns {Promise<Array>} Array of test payloads with expected outcomes
 * @throws {Error} If the request fails
 */
export async function fetchTestPayload(packId, questId) {
    const response = await fetchWithAuth(
        `${API.BASE_URL}/packs/${packId}/quests/${questId}/test-payload`
    );
    
    if (!response.ok) {
        throw new Error('Failed to fetch test payload');
    }
    
    return await response.json();
}

/**
 * Verify a Rego solution against quest test cases
 * @param {string} packId - The pack identifier
 * @param {number} questId - The quest identifier
 * @param {string} code - The Rego code to verify
 * @returns {Promise<Object>} Verification result with pass/fail status and test results
 * @throws {Error} If the request fails
 */
export async function verifySolution(packId, questId, code) {
    const response = await fetchWithAuth(`${API.BASE_URL}/verify`, {
        method: 'POST',
        body: JSON.stringify({ 
            pack_id: packId, 
            quest_id: questId, 
            rego_code: code 
        })
    });
    
    if (!response.ok) {
        throw new Error('Verification failed');
    }
    
    return await response.json();
}
