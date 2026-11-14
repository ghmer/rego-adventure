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
 * Vitest configuration
 *
 * Tests live next to the code they cover as `<name>.test.js`. The
 * happy-dom environment provides the localStorage and DOM APIs the
 * services use, including the animation frames the tour's focus hand-off
 * defers its work to. The vitest toolchain itself is a declared
 * devDependency, pinned by the committed lockfile (npm ci).
 */
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
    test: {
        environment: 'happy-dom',
        environmentOptions: {
            happyDOM: {
                // The tour defers its focus hand-off to an animation frame,
                // which is what a browser gives it.
                pretendToBeVisual: true,
                settings: {
                    fetch: {
                        // A fetch that reaches the environment fetch must not
                        // open a real socket against the default window
                        // location: happy-dom aborts pending connections at
                        // teardown, which litters the run log with connection
                        // errors. Same-origin requests are answered from the
                        // package root instead, so every path the suite does
                        // not stub deterministically gets a 404.
                        virtualServers: [{
                            url: 'http://localhost:3000',
                            directory: fileURLToPath(new URL('.', import.meta.url))
                        }]
                    }
                }
            }
        },
        include: ['src/**/*.test.js']
    }
});
