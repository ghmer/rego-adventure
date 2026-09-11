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
/**
 * Fake UserManager standing in for the dynamically imported OIDC library.
 * Doubles record the settings and method calls; queues control the
 * users returned by getUser/signinSilent.
 */
const oidc = vi.hoisted(() => {
    return {
        instances: [],
        lastSettings: null,
        getUserQueue: [],
        silentUser: undefined,
        callbackCalled: false,
        redirectCalled: false,
        signoutCalled: false,
        silentError: null,
        callbackError: null,
        UserManager: class {
            constructor(settings) {
                oidc.lastSettings = settings;
                oidc.instances.push(this);
            }
            async getUser() {
                const user = oidc.getUserQueue.shift();
                if (user === undefined) return null;
                if (user instanceof Error) throw user;
                return user;
            }
            async signinCallback() {
                oidc.callbackCalled = true;
                if (oidc.callbackError) throw oidc.callbackError;
            }
            async signinSilent() {
                if (oidc.silentError) throw oidc.silentError;
                return oidc.silentUser;
            }
            async signinRedirect() {
                oidc.redirectCalled = true;
            }
            async signoutRedirect() {
                oidc.signoutCalled = true;
            }
        }
    };
});

const configServiceMock = vi.hoisted(() => ({
    get: vi.fn()
}));

vi.mock('oidc-client-ts', () => ({ UserManager: oidc.UserManager }));
vi.mock('./config-service.js', () => ({ ConfigService: configServiceMock }));

const ENABLED_CONFIG = {
    enabled: true,
    issuer: 'https://idp.example.org',
    client_id: 'rego-adventure'
};

describe('auth-service', () => {
    let AuthService;

    beforeEach(async () => {
        vi.clearAllMocks();
        vi.resetModules();
        vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        oidc.instances = [];
        oidc.lastSettings = null;
        oidc.getUserQueue = [];
        oidc.silentUser = undefined;
        oidc.silentError = null;
        oidc.callbackError = null;
        oidc.callbackCalled = false;
        oidc.redirectCalled = false;
        oidc.signoutCalled = false;
        configServiceMock.get.mockReturnValue(null);
        window.history.replaceState({}, '', '/');
        ({ AuthService } = await import('./auth-service.js'));
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('without authentication', () => {
        it('reports disabled when no config is loaded', () => {
            expect(AuthService.isEnabled()).toBeFalsy();
        });

        it('reports disabled when the config disables auth', () => {
            configServiceMock.get.mockReturnValue({ enabled: false });
            expect(AuthService.isEnabled()).toBeFalsy();
        });

        it('resolves no token when auth is disabled', async () => {
            await expect(AuthService.getToken()).resolves.toBeNull();
        });

        it('resolves no token when the config disables auth', async () => {
            configServiceMock.get.mockReturnValue({ enabled: false });
            await expect(AuthService.getToken()).resolves.toBeNull();
        });

        it('does not initialize the OIDC library on init', async () => {
            await AuthService.init();

            expect(oidc.instances).toHaveLength(0);
        });
    });

    describe('without a signed-in user', () => {
        beforeEach(() => {
            configServiceMock.get.mockReturnValue(ENABLED_CONFIG);
        });

        it('renews no token when not initialized', async () => {
            await expect(AuthService.renewToken()).resolves.toBe(false);
        });

        it('resolves no user when not initialized', async () => {
            await expect(AuthService.getUser()).resolves.toBeNull();
        });

        it('ignores login and logout when not initialized', async () => {
            await AuthService.login();
            await AuthService.logout();

            expect(oidc.redirectCalled).toBe(false);
            expect(oidc.signoutCalled).toBe(false);
        });

        it('initializes the user manager with the OIDC settings', async () => {
            await AuthService.init();

            expect(oidc.instances).toHaveLength(1);
            expect(oidc.lastSettings).toEqual({
                authority: ENABLED_CONFIG.issuer,
                client_id: ENABLED_CONFIG.client_id,
                redirect_uri: `${window.location.origin}/callback`,
                response_type: 'code',
                scope: 'openid profile email'
            });
        });

        it('handles the authorization code callback and cleans the URL', async () => {
            window.history.replaceState({}, '', '/?code=abc&state=xyz');

            await AuthService.init();

            expect(oidc.callbackCalled).toBe(true);
            expect(window.location.search).toBe('');
        });

        it('cleans the URL even when the callback fails', async () => {
            window.history.replaceState({}, '', '/?code=broken');
            oidc.callbackError = new Error('callback failed');
            vi.spyOn(console, 'error').mockImplementation(() => {});

            await AuthService.init();

            expect(oidc.callbackCalled).toBe(true);
            expect(console.error).toHaveBeenCalled();
            expect(window.location.search).toBe('');
        });
    });

    describe('with a signed-in user', () => {
        beforeEach(() => {
            configServiceMock.get.mockReturnValue(ENABLED_CONFIG);
        });

        /**
         * Initialize auth with a fresh (unexpired) token.
         */
        async function initSignedIn(token = 'tok') {
            await AuthService.init();
            oidc.getUserQueue.push({ access_token: token, expired: false });
        }

        it('returns the access token for a valid session', async () => {
            await initSignedIn('fresh-token');

            await expect(AuthService.getToken()).resolves.toBe('fresh-token');
        });

        it('renews an expired token via silent sign-in', async () => {
            await AuthService.init();
            oidc.getUserQueue.push({ access_token: 'old', expired: true });
            oidc.silentUser = { access_token: 'new', expired: false };
            oidc.getUserQueue.push({ access_token: 'new', expired: false });

            await expect(AuthService.getToken()).resolves.toBe('new');
        });

        it('returns no token when silent renewal fails', async () => {
            await AuthService.init();
            oidc.getUserQueue.push({ access_token: 'old', expired: true });
            oidc.silentError = new Error('refresh failed');

            await expect(AuthService.getToken()).resolves.toBeNull();
        });

        it('reports successful silent renewal', async () => {
            await AuthService.init();
            oidc.silentUser = { access_token: 'new', expired: false };

            await expect(AuthService.renewToken()).resolves.toBe(true);
        });

        it('reports failed silent renewal on errors', async () => {
            await AuthService.init();
            oidc.silentError = new Error('network down');

            await expect(AuthService.renewToken()).resolves.toBe(false);
            expect(console.warn).toHaveBeenCalled();
        });

        it('reports failed silent renewal without an access token', async () => {
            await AuthService.init();
            oidc.silentUser = { expired: true };

            await expect(AuthService.renewToken()).resolves.toBe(false);
        });

        it('redirects to the identity provider on login and signout', async () => {
            await AuthService.init();

            await AuthService.login();
            await AuthService.logout();

            expect(oidc.redirectCalled).toBe(true);
            expect(oidc.signoutCalled).toBe(true);
        });
    });
});
