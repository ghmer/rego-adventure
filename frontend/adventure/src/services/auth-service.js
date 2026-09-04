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
        
        // Handle callback if code is present in URL
        if (window.location.search.includes("code=")) {
            try {
                await userManager.signinCallback();
                // Clean URL
                window.history.replaceState({}, document.title, "/");
            } catch (e) {
                console.error("Signin callback failed:", e);
            }
        }
    },

    async getUser() {
        if (!userManager) return null;
        try {
            return await userManager.getUser();
        } catch (e) {
            return null;
        }
    },

    /**
     * Attempt a silent token renewal via the UserManager.
     * @returns {Promise<boolean>} True if a fresh, unexpired token was obtained
     */
    async renewToken() {
        if (!userManager) return false;
        try {
            const user = await userManager.signinSilent();
            return Boolean(user?.access_token && !user.expired);
        } catch (e) {
            console.warn('Silent token renewal failed:', e);
            return false;
        }
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