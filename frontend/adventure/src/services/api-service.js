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
 * Error thrown by API calls, carrying the HTTP status and response body
 * so error handling can branch on data instead of message-sniffing.
 * A status of 0 means the request never got a response
 * (network failure or timeout).
 */
export class ApiError extends Error {
    /**
     * @param {string} message - Human-readable error message
     * @param {number} status - HTTP status code, or 0 for network/timeout errors
     * @param {string} body - Raw response body, when available
     * @param {Object} [options] - Additional error options (e.g. { cause })
     */
    constructor(message, status = 0, body = '', options = {}) {
        super(message, options);
        this.name = 'ApiError';
        this.status = status;
        this.body = body;
    }
}

/**
 * Helper to perform a fetch request with timeout support
 * @param {string} url - The URL to fetch
 * @param {Object} options - Fetch options
 * @param {number} timeout - Timeout in milliseconds
 * @returns {Promise<Response>} The fetch response
 */
async function performFetch(url, options, timeout) {
    const headers = { ...options.headers };
    // Only declare a JSON content type when a body is actually sent
    if (options.body) {
        headers['Content-Type'] = 'application/json';
    }
    const token = await AuthService.getToken();
    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }

    const config = {
        ...options,
        headers,
        signal: AbortSignal.timeout(timeout)
    };

    try {
        return await fetch(url, config);
    } catch (error) {
        if (error.name === 'TimeoutError' || error.name === 'AbortError') {
            throw new ApiError(`Request timeout after ${timeout}ms`, 0, '', { cause: error });
        }
        throw new ApiError(`Network error: ${error.message}`, 0, '', { cause: error });
    }
}

/**
 * Helper to perform authenticated fetch requests with timeout support.
 * On a 401 response the token is renewed once and the request retried.
 * @param {string} url - The URL to fetch
 * @param {Object} options - Fetch options
 * @param {number} timeout - Timeout in milliseconds (default: 30000)
 * @returns {Promise<Response>} The fetch response
 * @throws {ApiError} On network failure or timeout
 */
async function fetchWithAuth(url, options = {}, timeout = 30000) {
    let response = await performFetch(url, options, timeout);
    if (response.status === 401 && (await AuthService.renewToken())) {
        response = await performFetch(url, options, timeout);
    }
    return response;
}

/**
 * Ensure a response is successful, otherwise throw an ApiError that
 * preserves the HTTP status and response body.
 * @param {Response} response - The fetch response
 * @param {string} message - Error message to use when the response failed
 * @throws {ApiError} If the response is not ok
 */
async function ensureOk(response, message) {
    if (response.ok) return;
    let body = '';
    try {
        body = await response.text();
    } catch (e) {
        // body stays empty
    }
    throw new ApiError(message, response.status, body);
}

/**
 * Fetch all available quest packs
 * @returns {Promise<Array>} Array of quest pack summaries
 * @throws {ApiError} If the request fails
 */
export async function fetchPacks() {
    const response = await fetchWithAuth(`${API.BASE_URL}/packs`);
    await ensureOk(response, 'Failed to fetch packs');
    return await response.json();
}

/**
 * Fetch detailed information for a specific quest pack
 * @param {string} packId - The pack identifier
 * @returns {Promise<Object>} Quest pack details including quests, prologue, epilogue, and metadata
 * @throws {ApiError} If the request fails
 */
export async function fetchPackDetails(packId) {
    const response = await fetchWithAuth(`${API.BASE_URL}/packs/${packId}`);
    await ensureOk(response, 'Failed to fetch pack details');
    return await response.json();
}

/**
 * Fetch test payload data for a specific quest
 * @param {string} packId - The pack identifier
 * @param {number} questId - The quest identifier
 * @returns {Promise<Array>} Array of test payloads with expected outcomes
 * @throws {ApiError} If the request fails
 */
export async function fetchTestPayload(packId, questId) {
    const response = await fetchWithAuth(
        `${API.BASE_URL}/packs/${packId}/quests/${questId}/test-payload`
    );
    await ensureOk(response, 'Failed to fetch test payload');
    return await response.json();
}

/**
 * Verify a Rego solution against quest test cases
 * @param {string} packId - The pack identifier
 * @param {number} questId - The quest identifier
 * @param {string} code - The Rego code to verify
 * @returns {Promise<Object>} Verification result with pass/fail status and test results
 * @throws {ApiError} If the request fails
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
    await ensureOk(response, 'Verification failed');
    return await response.json();
}
