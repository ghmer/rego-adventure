/*
 * Copyright 2025 Mario Enrico Ragucci
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * The postinstall hook of the frontend manifest resolves the vendored
 * browser libraries (cmd/vendorgen extracts them from the sha512-pinned
 * npm tarballs package-lock.json names), so a server started after
 * `npm ci` serves the import map's /vendor/... entries same-origin.
 *
 * The resolution needs the Go toolchain. Toolchain-only installs - a CI
 * lint or vitest job, a contributor who only runs the editor - do not
 * resolve here: they skip with a pointer, the way every other consumer
 * (QA harness preflight, Docker builder, the server's boot guard) states
 * the one command that keeps the vendored tree fresh.
 */

const { spawnSync } = require('node:child_process');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..', '..');

function main() {
    if (spawnSync('go', ['version'], { encoding: 'utf8' }).status !== 0) {
        console.warn(
            'vendorgen skipped: Go toolchain not found. The vendored browser libraries ' +
                'resolve with "npm run vendor" (or go run ./cmd/vendorgen) once Go is available; ' +
                'the server refuses to boot without them.'
        );
        return;
    }

    const result = spawnSync('go', ['run', './cmd/vendorgen', '-pkg', 'frontend/adventure/package.json'], {
        cwd: repoRoot,
        stdio: 'inherit'
    });
    if (result.status !== 0) {
        process.exitCode = result.status || 1;
    }
}

main();
