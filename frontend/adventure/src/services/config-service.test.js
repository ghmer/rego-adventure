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
 * Config loading: the request is bounded by a timeout of its own, and a failed
 * load leaves no half-read configuration behind for the rest of the page.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConfigService } from './config-service.js';

/**
 * A fetch response double for the /config answer.
 * @param {Object} body - JSON body to serve
 * @param {boolean} ok - Response ok flag
 * @param {number} status - HTTP status code
 * @returns {Object} Response double
 */
function configResponse(body, ok = true, status = 200) {
    return { ok, status, json: async () => body };
}

describe('config-service', () => {
    let fetchMock;

    beforeEach(() => {
        ConfigService.config = null;
        vi.spyOn(console, 'error').mockImplementation(() => {});
        fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
        ConfigService.config = null;
    });

    it('serves the configuration it loaded', async () => {
        fetchMock.mockResolvedValue(configResponse({ enabled: false }));

        await expect(ConfigService.load()).resolves.toEqual({ enabled: false });
        expect(ConfigService.get()).toEqual({ enabled: false });
    });

    it('bounds the configuration request with a timeout signal', async () => {
        fetchMock.mockResolvedValue(configResponse({ enabled: true }));

        await ConfigService.load();

        const [url, config] = fetchMock.mock.calls[0];
        expect(url).toBe('/config');
        expect(config.signal).toBeInstanceOf(globalThis.AbortSignal);
    });

    it('gives up on a configuration request that never answers', async () => {
        const timeout = new Error('timed out');
        timeout.name = 'TimeoutError';
        fetchMock.mockRejectedValue(timeout);

        await expect(ConfigService.load()).rejects.toBe(timeout);
        expect(ConfigService.get()).toBeNull();
    });

    it('keeps an unsuccessful answer out of the configuration', async () => {
        fetchMock.mockResolvedValue(configResponse(null, false, 503));

        await expect(ConfigService.load()).rejects.toThrow('Failed to load config (HTTP 503)');
        expect(ConfigService.get()).toBeNull();
    });

    it('drops a configuration a later load could not confirm', async () => {
        fetchMock.mockResolvedValueOnce(configResponse({ enabled: true }));
        await ConfigService.load();

        fetchMock.mockResolvedValueOnce(configResponse(null, false, 500));

        await expect(ConfigService.load()).rejects.toThrow('Failed to load config (HTTP 500)');
        expect(ConfigService.get()).toBeNull();
    });
});
