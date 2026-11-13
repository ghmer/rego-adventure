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

import { ConfigService } from './config-service.js';

let userManager = null;
let UserManager = null;

// One signinSilent() at a time; concurrent callers await it. Overlapping calls
// race on the same OIDC storage keys.
let renewalInFlight = null;
// Set when the issuer refuses a silent renewal. Cleared only by login or
// logout, both of which leave the page.
let renewalRefused = false;
const sessionLostHandlers = [];

function announceSessionLost() {
    for (const handler of sessionLostHandlers) {
        try {
            handler();
        } catch (error) {
            console.error('[Auth] Session-lost handler failed:', error);
        }
    }
}

export const AuthService = {
    async init() {
        const config = ConfigService.get();
        if (!config || !config.enabled) return;

        // Dynamically import OIDC library only when authentication is enabled
        if (!UserManager) {
            const oidcModule = await import('oidc-client-ts');
            UserManager = oidcModule.UserManager;
        }

        const settings = {
            authority: config.issuer,
            client_id: config.client_id,
            redirect_uri: `${window.location.origin}/callback`,
            response_type: 'code',
            scope: 'openid profile email',
        };
        
        userManager = new UserManager(settings);

        // Handle callback if the authorization code is present in the URL
        const params = new URLSearchParams(window.location.search);
        if (params.has('code')) {
            try {
                await userManager.signinCallback();
            } catch (e) {
                console.error('Signin callback failed:', e);
            }
            // Clean the URL in all cases: a failing callback must not
            // leave the code param behind, or every reload repeats it
            window.history.replaceState({}, document.title, window.location.pathname);
        }
    },

    async getUser() {
        if (!userManager) return null;
        try {
            return await userManager.getUser();
        } catch {
            return null;
        }
    },

    /**
     * Register a handler for a refused silent renewal. It runs once per failed
     * attempt, after the refusal is recorded.
     * @param {Function} handler - Called with no arguments
     */
    onSessionLost(handler) {
        sessionLostHandlers.push(handler);
    },

    /**
     * Attempt a silent renewal. Concurrent callers await the attempt in flight,
     * and a refusal is held rather than re-asked.
     * @returns {Promise<boolean>} True if a fresh, unexpired token was obtained
     */
    renewToken() {
        if (!userManager || renewalRefused) return Promise.resolve(false);
        if (renewalInFlight) return renewalInFlight;

        const attempt = (async () => {
            try {
                const user = await userManager.signinSilent();
                return Boolean(user?.access_token && !user.expired);
            } catch (error) {
                console.warn('Silent token renewal failed:', error);
                return false;
            }
        })();

        renewalInFlight = attempt.then((renewed) => {
            renewalInFlight = null;
            if (!renewed) {
                renewalRefused = true;
                announceSessionLost();
            }
            return renewed;
        });

        return renewalInFlight;
    },

    async getToken() {
        const config = ConfigService.get();
        if (!config || !config.enabled) return null;

        const user = await this.getUser();
        if (user && !user.expired) return user.access_token;
        if (user && (await this.renewToken())) {
            const renewed = await this.getUser();
            if (renewed) return renewed.access_token;
        }
        return null;
    },

    async login() {
         if (userManager) await userManager.signinRedirect();
    },
    
    async logout() {
        if (userManager) {
            // The UserManager owns its storage and handles cleanup during signout;
            // manual key removal or sessionStorage.clear() would break in-flight
            // signout handling and delete unrelated session data.
            await userManager.signoutRedirect();
        }
    },

    isEnabled() {
        const config = ConfigService.get();
        return config && config.enabled;
    }
};