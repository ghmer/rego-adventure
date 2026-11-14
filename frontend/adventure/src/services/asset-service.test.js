/*
   Copyright 2026 Mario Enrico Ragucci

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

const authMock = vi.hoisted(() => ({
    isEnabled: vi.fn(() => false),
    getToken: vi.fn(async () => null),
    renewToken: vi.fn(async () => false)
}));

vi.mock('./auth-service.js', () => ({ AuthService: authMock }));

import { AssetService } from './asset-service.js';

const MEDIA_URL = '/quests/alpha/assets/picture.png';

/**
 * Answer body with the given status for every fetch.
 * @param {string} body - Response body
 * @param {number} status - Response status
 */
function stubFetchOnce(body, status = 200) {
    const first = new Response(body, { status });
    const fetchMock = vi.fn(async () => first.clone());
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
}

describe('AssetService', () => {
    let createObjectURL;
    let revokeObjectURL;

    beforeEach(() => {
        createObjectURL = vi.fn(() => 'blob:issued-1');
        revokeObjectURL = vi.fn();
        Object.defineProperty(URL, 'createObjectURL', { value: createObjectURL, configurable: true });
        Object.defineProperty(URL, 'revokeObjectURL', { value: revokeObjectURL, configurable: true });
        vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
        authMock.isEnabled.mockReset();
        authMock.isEnabled.mockImplementation(() => false);
        authMock.getToken.mockReset();
        authMock.getToken.mockImplementation(async () => null);
        authMock.renewToken.mockReset();
        authMock.renewToken.mockImplementation(async () => false);
    });

    describe('open mode', () => {
        it('passes media URLs through without fetching or issuing blobs', async () => {
            const fetchMock = vi.fn();
            vi.stubGlobal('fetch', fetchMock);

            await expect(AssetService.mediaURL(MEDIA_URL)).resolves.toBe(MEDIA_URL);

            expect(fetchMock).not.toHaveBeenCalled();
            expect(createObjectURL).not.toHaveBeenCalled();
        });

        it('fetches stylesheets without a token', async () => {
            stubFetchOnce('body{}');

            await expect(AssetService.styleSheetText('/quests/alpha/theme.css')).resolves.toBe('body{}');
        });
    });

    describe('authenticated mode', () => {
        it('hands out a blob URL for fetched media', async () => {
            authMock.isEnabled.mockReturnValue(true);
            authMock.getToken.mockResolvedValue('token-1');
            const fetchMock = stubFetchOnce('png-bytes');

            await expect(AssetService.mediaURL(MEDIA_URL)).resolves.toBe('blob:issued-1');

            expect(fetchMock).toHaveBeenCalledWith(MEDIA_URL, expect.objectContaining({
                headers: { Authorization: 'Bearer token-1' }
            }));
            expect(createObjectURL).toHaveBeenCalledTimes(1);
        });

        it('renews the token once and retries when the server rejects the token', async () => {
            authMock.isEnabled.mockReturnValue(true);
            authMock.getToken.mockResolvedValue('stale-token');
            authMock.renewToken.mockResolvedValue(true);
            const fetchMock = vi.fn()
                .mockResolvedValueOnce(new Response('denied', { status: 401 }))
                .mockResolvedValueOnce(new Response('png-bytes', { status: 200 }));
            vi.stubGlobal('fetch', fetchMock);

            await expect(AssetService.mediaURL(MEDIA_URL)).resolves.toBe('blob:issued-1');

            expect(authMock.renewToken).toHaveBeenCalledTimes(1);
            expect(fetchMock).toHaveBeenCalledTimes(2);
        });

        it('rejects when the retry is rejected too', async () => {
            authMock.isEnabled.mockReturnValue(true);
            authMock.getToken.mockResolvedValue('stale-token');
            authMock.renewToken.mockResolvedValue(true);
            const fetchMock = vi.fn(async () => new Response('denied', { status: 401 }));
            vi.stubGlobal('fetch', fetchMock);

            await expect(AssetService.mediaURL(MEDIA_URL)).rejects.toThrow('HTTP 401');
        });

        it('rejects without a renewal attempt when the failure is not a 401', async () => {
            authMock.isEnabled.mockReturnValue(true);
            authMock.getToken.mockResolvedValue('token-1');
            const fetchMock = stubFetchOnce('gone', 404);

            await expect(AssetService.mediaURL(MEDIA_URL)).rejects.toThrow('HTTP 404');

            expect(authMock.renewToken).not.toHaveBeenCalled();
            expect(createObjectURL).not.toHaveBeenCalled();
            expect(fetchMock).toHaveBeenCalledTimes(1);
        });

        it('resolves an optional missing stylesheet to null', async () => {
            authMock.isEnabled.mockReturnValue(true);
            authMock.getToken.mockResolvedValue('token-1');
            stubFetchOnce('gone', 404);

            await expect(AssetService.styleSheetText('/quests/alpha/custom.css', true)).resolves.toBeNull();
        });

        it('rejects a missing stylesheet that was not marked optional', async () => {
            authMock.isEnabled.mockReturnValue(true);
            authMock.getToken.mockResolvedValue('token-1');
            stubFetchOnce('gone', 404);

            await expect(AssetService.styleSheetText('/quests/alpha/theme.css')).rejects.toThrow('HTTP 404');
        });
    });

    describe('issued blob URLs', () => {
        it('revokes every issued URL together and re-issues afterwards', async () => {
            authMock.isEnabled.mockReturnValue(true);
            authMock.getToken.mockResolvedValue('token-1');
            stubFetchOnce('png-bytes');

            await AssetService.mediaURL(MEDIA_URL);
            AssetService.releaseMedia();

            expect(revokeObjectURL).toHaveBeenCalledTimes(1);
            expect(revokeObjectURL).toHaveBeenCalledWith('blob:issued-1');

            await AssetService.mediaURL(MEDIA_URL);
            AssetService.releaseMedia();
            expect(revokeObjectURL).toHaveBeenCalledTimes(2);
        });

        it('is a no-op without issued URLs', () => {
            AssetService.releaseMedia();
            expect(revokeObjectURL).not.toHaveBeenCalled();
        });
    });
});
