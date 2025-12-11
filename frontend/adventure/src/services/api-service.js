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
 * Get authentication headers for API requests
 * @returns {Promise<Object>} Headers object with auth token if available
 */
async function getAuthHeaders() {
    const headers = { 'Content-Type': 'application/json' };
    const token = await AuthService.getToken();
    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }
    return headers;
}

/**
 * Fetch all available quest packs
 * @returns {Promise<Array>} Array of quest pack summaries
 * @throws {Error} If the request fails
 */
export async function fetchPacks() {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API.BASE_URL}/packs`, { headers });
    
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
    const headers = await getAuthHeaders();
    const response = await fetch(`${API.BASE_URL}/packs/${packId}`, { headers });
    
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
    const headers = await getAuthHeaders();
    const response = await fetch(
        `${API.BASE_URL}/packs/${packId}/quests/${questId}/test-payload`,
        { headers }
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
    const headers = await getAuthHeaders();
    const response = await fetch(`${API.BASE_URL}/verify`, {
        method: 'POST',
        headers: headers,
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