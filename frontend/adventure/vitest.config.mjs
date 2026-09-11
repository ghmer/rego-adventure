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
 * services use. The vitest toolchain itself is not a committed
 * dependency; it is installed pinned and ephemeral (see CI and the
 * package.json comments).
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        environment: 'happy-dom',
        include: ['src/**/*.test.js']
    }
});
