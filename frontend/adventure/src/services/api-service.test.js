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

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const authServiceMock = vi.hoisted(() => ({
    getToken: vi.fn(),
    renewToken: vi.fn()
}));

vi.mock('./auth-service.js', () => ({ AuthService: authServiceMock }));

import {
    ApiError,
    fetchPacks,
    fetchPackDetails,
    fetchTestPayload,
    verifySolution
} from './api-service.js';

/**
 * Build a fetch-like response object.
 * @param {Object} body - JSON body to serve
 * @param {boolean} ok - Response ok flag
 * @param {number} status - HTTP status code
 * @returns {Object} Response double
 */
function jsonResponse(body, ok = true, status = 200) {
    return { ok, status, json: async () => body };
}

describe('api-service', () => {
    let fetchMock;

    beforeEach(() => {
        vi.clearAllMocks();
        authServiceMock.getToken.mockResolvedValue(null);
        authServiceMock.renewToken.mockResolvedValue(false);
        fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    describe('request building', () => {
        it('fetches packs from the packs endpoint', async () => {
            const packs = [{ id: 'fantasy' }, { id: 'noir' }];
            fetchMock.mockResolvedValue(jsonResponse(packs));

            await expect(fetchPacks()).resolves.toEqual(packs);
            expect(fetchMock).toHaveBeenCalledTimes(1);
            expect(fetchMock.mock.calls[0][0]).toBe('/api/packs');
        });

        it('fetches pack details and test payloads from their endpoints', async () => {
            fetchMock.mockResolvedValue(jsonResponse({}));
            await fetchPackDetails('fantasy');
            await fetchTestPayload('fantasy', 2);

            expect(fetchMock.mock.calls[0][0]).toBe('/api/packs/fantasy');
            expect(fetchMock.mock.calls[1][0]).toBe('/api/packs/fantasy/quests/2/test-payload');
        });

        it('sends the solution as a JSON POST body', async () => {
            fetchMock.mockResolvedValue(jsonResponse({ passed: true }));

            await verifySolution('fantasy', 1, 'package play');

            const [url, config] = fetchMock.mock.calls[0];
            expect(url).toBe('/api/verify');
            expect(config.method).toBe('POST');
            expect(config.headers['Content-Type']).toBe('application/json');
            expect(config.body).toBe(JSON.stringify({
                pack_id: 'fantasy',
                quest_id: 1,
                rego_code: 'package play'
            }));
        });

        it('attaches the bearer token when authenticated', async () => {
            authServiceMock.getToken.mockResolvedValue('tok');
            fetchMock.mockResolvedValue(jsonResponse([]));

            await fetchPacks();

            expect(fetchMock.mock.calls[0][1].headers['Authorization']).toBe('Bearer tok');
        });

        it('omits the content type header when no body is sent', async () => {
            fetchMock.mockResolvedValue(jsonResponse([]));

            await fetchPacks();

            expect(fetchMock.mock.calls[0][1].headers['Content-Type']).toBeUndefined();
        });
    });

    describe('error handling', () => {
        it('throws an ApiError with the status for failed responses', async () => {
            fetchMock.mockResolvedValue(jsonResponse({}, false, 503));

            const error = await fetchPacks().catch(e => e);

            expect(error).toBeInstanceOf(ApiError);
            expect(error.status).toBe(503);
            expect(error.message).toBe('Failed to fetch packs');
        });

        it('wraps network failures as ApiError with status 0', async () => {
            fetchMock.mockRejectedValue(new TypeError('boom'));

            const error = await fetchPacks().catch(e => e);

            expect(error).toBeInstanceOf(ApiError);
            expect(error.status).toBe(0);
            expect(error.message).toBe('Network error: boom');
        });

        it('wraps aborted requests as request timeouts', async () => {
            const abort = new Error('The operation was aborted');
            abort.name = 'AbortError';
            fetchMock.mockRejectedValue(abort);

            const error = await fetchPacks().catch(e => e);

            expect(error).toBeInstanceOf(ApiError);
            expect(error.status).toBe(0);
            expect(error.message).toBe('Request timeout after 30000ms');
        });
    });

    describe('401 retry', () => {
        it('renews the token once and retries on 401', async () => {
            authServiceMock.renewToken.mockResolvedValue(true);
            fetchMock
                .mockResolvedValueOnce(jsonResponse({}, false, 401))
                .mockResolvedValueOnce(jsonResponse({ id: 'fantasy' }));

            await expect(fetchPackDetails('fantasy')).resolves.toEqual({ id: 'fantasy' });

            expect(authServiceMock.renewToken).toHaveBeenCalledTimes(1);
            expect(fetchMock).toHaveBeenCalledTimes(2);
        });

        it('fails with the 401 when token renewal does not succeed', async () => {
            fetchMock.mockResolvedValue(jsonResponse({}, false, 401));

            const error = await fetchPackDetails('fantasy').catch(e => e);

            expect(error).toBeInstanceOf(ApiError);
            expect(error.status).toBe(401);
            expect(fetchMock).toHaveBeenCalledTimes(1);
        });
    });
});
