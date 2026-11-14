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
 * Asset Service
 * Resolves pack media for elements that cannot send an Authorization
 * header. With authentication enabled, pack media is token-protected,
 * so <img>, <audio> and <link> cannot load it directly: the service
 * fetches each asset with the bearer token and hands out a blob URL for
 * the received body. Issued URLs are revoked when a pack transition
 * releases its media. With authentication disabled, media URLs pass
 * through unchanged and no blobs are issued.
 */

import { AuthService } from './auth-service.js';
import { API } from './constants.js';

// Blob URLs handed out by mediaURL; revoked together on releaseMedia.
const issuedURLs = new Set();

/**
 * Fetch an asset with the bearer token, renewing the token once when the
 * server rejects the request.
 * @param {string} url - Asset URL on the same origin
 * @returns {Promise<Response>} The response after the renewal attempt
 * @throws {Error} On network failure or timeout
 */
async function authorizedFetch(url) {
    const request = async () => {
        const headers = {};
        const token = await AuthService.getToken();
        if (token) {
            headers.Authorization = `Bearer ${token}`;
        }
        return fetch(url, {
            headers,
            signal: AbortSignal.timeout(API.REQUEST_TIMEOUT_MS)
        });
    };

    let response = await request();
    if (response.status === 401 && await AuthService.renewToken()) {
        response = await request();
    }
    return response;
}

/**
 * Raise a rejection that names the asset and the HTTP status. The caller
 * decides the per-context fallback.
 * @param {string} url - Asset URL
 * @param {number} status - HTTP status of the failed response
 * @throws {Error} Always
 */
function fail(url, status) {
    throw new Error(`Asset request failed (HTTP ${status}): ${url}`);
}

export const AssetService = {
    /**
     * Resolve an asset URL for img and audio element use. Authenticated
     * content arrives as a blob URL; open mode returns the input
     * unchanged. The promise rejects instead of handing out a URL that
     * would fail in the browser, so callers keep their own fallbacks.
     * @param {string} url - Asset URL on the same origin
     * @returns {Promise<string>} URL usable as an element source
     * @throws {Error} When the asset cannot be fetched
     */
    async mediaURL(url) {
        if (!AuthService.isEnabled()) return url;

        const response = await authorizedFetch(url);
        if (!response.ok) fail(url, response.status);

        const objectURL = URL.createObjectURL(await response.blob());
        issuedURLs.add(objectURL);
        return objectURL;
    },

    /**
     * Fetch a pack stylesheet's text for inline application. Works in
     * both modes: open mode fetches without a token. Optional stylesheets
     * that do not exist resolve to null instead of an error.
     * @param {string} url - Stylesheet URL on the same origin
     * @param {boolean} [optional=false] - Treat a missing sheet as absent
     * @returns {Promise<string|null>} CSS text, or null for an absent sheet
     * @throws {Error} When the sheet cannot be fetched
     */
    async styleSheetText(url, optional = false) {
        const response = await authorizedFetch(url);
        if (response.status === 404 && optional) return null;
        if (!response.ok) fail(url, response.status);
        return await response.text();
    },

    /**
     * Revoke every issued blob URL. Called when a pack transition ends
     * the lifetime of its media; elements already painting from those
     * URLs keep rendering from decoded data.
     */
    releaseMedia() {
        for (const url of issuedURLs) {
            URL.revokeObjectURL(url);
        }
        issuedURLs.clear();
    }
};
