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

export const ConfigService = {
    config: null,
    async load() {
        try {
            const res = await fetch('/config');
            if (!res.ok) throw new Error('Failed to load config');
            this.config = await res.json();
            return this.config;
        } catch (e) {
            console.error("Config load failed:", e);
            // Fallback to disabled auth if config fails
            this.config = { enabled: false };
            return this.config;
        }
    },
    get() {
        return this.config;
    }
};