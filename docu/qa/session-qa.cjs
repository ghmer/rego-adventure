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


// Session machine QA: what the client does when a silent renewal is refused.
// Run with: node docu/qa/session-qa.cjs
//
// Scenario one: a stored user whose token has expired, on the start screen.
// Scenario two: a signed-in player inside a quest, on a token that expires while
// the quest screen is open.
//
// The app server runs with AUTH_ENABLED=true against a stub discovery document
// naming a jwks_uri served by this file; scenario two signs its token with that
// key pair. The authority configured in the browser is a path the app server
// answers with 404, so the OIDC metadata lookup fails and the renewal is refused.
// Users are seeded into sessionStorage under the OIDC library's key. The suite
// needs network access: the import map loads oidc-client-ts from esm.sh.

const crypto = require('node:crypto');
const http = require('node:http');

const {
    repoRoot,
    buildServer,
    pickFreePort,
    gitStatus,
    leftoverChanges,
    stopServersSync,
    Server,
    Report,
    withBrowser,
    newPage,
    removePack,
    toastText
} = require('./qa-lib.cjs');

const CLIENT_ID = 'qa-session-client';
const AUDIENCE = 'qa-audience';
const DEAD_AUTHORITY_PATH = 'qa-dead-authority';
// The app's own reports of the unreachable issuer are expected output.
const NOISE = /favicon|net::ERR_|Failed to load resource|Failed to fetch|Failed to log in|Failed to reveal hint|metadata|FetchError|Unexpected token/i;
const PACK = 'qasession';
const KID = 'qa-session-key';
// Survives page load and pack entry; expires before the quest screen's request.
const TOKEN_LIFE_SECONDS = 3;
const WATCHDOG_MS = 45000;

/**
 * Discovery document for the app server's boot-time bootstrap, plus the JWKS
 * that verifies tokens this file signs. The browser consults neither.
 * @param {Object} jwk - Public RSA key in JWK form, empty for no keys
 * @returns {Promise<{server: import('node:http').Server, port: number}>}
 */
async function discoveryStub(jwk = null) {
    const server = http.createServer((req, res) => {
        const host = `http://127.0.0.1:${server.address().port}`;
        if (req.url.startsWith('/discovery')) {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ jwks_uri: `${host}/jwks.json` }));
            return;
        }
        const keys = jwk ? [{ ...jwk, kid: KID, alg: 'RS256', use: 'sig' }] : [];
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ keys }));
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    return { server, port: server.address().port };
}

/**
 * Sign an access token the app server accepts.
 * @param {Object} claims - Registered claims to carry
 * @param {import('node:crypto').KeyObject} privateKey - Signing key
 * @returns {string} A compact JWS
 */
function signedToken(claims, privateKey) {
    const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const unsigned = `${encode({ alg: 'RS256', typ: 'JWT', kid: KID })}.${encode(claims)}`;
    const signature = crypto.sign('sha256', Buffer.from(unsigned), privateKey).toString('base64url');
    return `${unsigned}.${signature}`;
}

/**
 * The sessionStorage entry the OIDC library reads for a signed-in user.
 * @param {string} authority - The authority the client is configured with
 * @param {string} accessToken - The token to carry
 * @param {number} expiresAt - Expiry as seconds since the epoch
 * @returns {{key: string, value: string}} Key and serialized user
 */
function storedUser(authority, accessToken, expiresAt) {
    const user = {
        access_token: accessToken,
        token_type: 'Bearer',
        scope: 'openid profile email',
        profile: { sub: 'qa-player' },
        expires_at: expiresAt
    };
    return { key: `oidc.user:${authority}:${CLIENT_ID}`, value: JSON.stringify(user) };
}

async function refusedRenewal(browser, report, binary) {
    console.log('\nan expired token whose renewal is refused');
    const stub = await discoveryStub();
    const authority = `http://127.0.0.1:${PORT}/${DEAD_AUTHORITY_PATH}`;
    const server = new Server({ cwd: repoRoot, port: PORT, binary, env: authEnv(authority, stub.port) });
    await server.start();

    try {
        const harness = await newPage(browser, PORT);
        const { page } = harness;
        const requests = [];
        page.on('request', (request) => {
            requests.push({ url: request.url(), headers: request.headers() });
        });

        const stored = storedUser(authority, 'stale-token', Math.floor(Date.now() / 1000) - 3600);
        await page.addInitScript(({ key, value }) => {
            window.sessionStorage.setItem(key, value);
        }, stored);
        await page.goto(harness.url(), { waitUntil: 'domcontentloaded' });

        // Wait for the renewal's effect on the chrome, not for a fixed pause.
        await page.waitForSelector('#login-container:not(.hidden)', { timeout: 5000 }).catch(() => {});

        // The OIDC module arrives through the import map's esm.sh entry.
        const moduleLoads = requests.filter((entry) => entry.url.includes('esm.sh'));
        report.check(
            'the OIDC client arrived from the import map',
            moduleLoads.length > 0,
            'no esm.sh request: without network access the session machine is unreachable'
        );

        const metadata = requests.filter((entry) => entry.url.includes('.well-known/openid-configuration'));
        report.check(
            'the silent renewal is attempted once',
            metadata.length === 1,
            `metadata requests: ${metadata.length} (${metadata.map((e) => e.url).join(' ')})`
        );

        const apiCalls = requests.filter((entry) => entry.url.includes('/api/packs'));
        report.check(
            'the API request goes out without the stale token',
            apiCalls.length === 1 && !apiCalls[0].headers['authorization'],
            `api calls: ${apiCalls.length}, authorization: ${JSON.stringify(apiCalls[0] ? apiCalls[0].headers['authorization'] : null)}`
        );

        const chrome = await page.evaluate(() => {
            const hidden = (selector) => {
                const element = document.querySelector(selector);
                return element ? element.classList.contains('hidden') : null;
            };
            return {
                login: hidden('#login-container'),
                logout: hidden('#logout-btn'),
                logoutStart: hidden('#logout-container-start'),
                packList: hidden('#quest-pack-list')
            };
        });
        report.check(
            'the logged-in chrome is gone, the login control is offered',
            chrome.login === false && chrome.logout === true && chrome.logoutStart === true && chrome.packList === true,
            JSON.stringify(chrome)
        );

        const notice = await page.evaluate(() => document.getElementById('quest-pack-list').textContent.trim());
        report.check(
            'the start screen says the session could not be renewed',
            /could not be renewed/i.test(notice),
            `start screen: ${notice}`
        );

        await page.click('#login-btn');
        await page.waitForSelector('.toast', { timeout: 3000 }).catch(() => {});
        const toast = await toastText(page);
        report.check(
            'the login attempt that cannot reach the issuer is reported',
            Boolean(toast && /log in/i.test(toast)),
            `toast: ${toast}`
        );
        report.check(
            'the failed login leaves the page on the start screen',
            page.url().startsWith(`http://127.0.0.1:${PORT}/`),
            page.url()
        );

        // The issuer is unreachable by design; the app's reports of it are
        // expected output.
        const errors = harness.consoleErrors.filter((line) => !NOISE.test(line));
        report.check('no unexpected page errors', errors.length === 0, errors.slice(0, 4).join(' ;; '));

        await harness.context.close();
    } finally {
        await server.stop('SIGTERM');
        stub.server.close();
    }
}

/**
 * Server configuration for both scenarios: auth on, an authority the browser
 * cannot reach, and a discovery document only the server consults.
 * @param {string} authority - The authority handed to the browser
 * @param {number} stubPort - Port of the discovery document
 * @returns {Object} Extra environment for the server process
 */
function authEnv(authority, stubPort) {
    return {
        AUTH_ENABLED: 'true',
        AUTH_ISSUER: authority,
        AUTH_DISCOVERY_URL: `http://127.0.0.1:${stubPort}/discovery`,
        AUTH_CLIENT_ID: CLIENT_ID,
        AUTH_AUDIENCE: AUDIENCE
    };
}

/**
 * A renewal refused while the player is inside a quest. Expected outcome: the
 * start screen, the login control, and an adventure flushed and closed.
 */
async function refusedInsideAQuest(browser, report, binary) {
    console.log('\na renewal refused inside a quest');
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const stub = await discoveryStub(publicKey.export({ format: 'jwk' }));
    const authority = `http://127.0.0.1:${PORT}/${DEAD_AUTHORITY_PATH}`;
    const issuedAt = Math.floor(Date.now() / 1000);
    const expiresAt = issuedAt + TOKEN_LIFE_SECONDS;
    const token = signedToken({
        iss: authority,
        aud: AUDIENCE,
        sub: 'qa-player',
        iat: issuedAt,
        exp: expiresAt
    }, privateKey);

    const server = new Server({ cwd: repoRoot, port: PORT, binary, env: authEnv(authority, stub.port) });
    await server.start({ packs: [PACK] });

    try {
        const harness = await newPage(browser, PORT);
        const { page } = harness;
        await page.addInitScript(({ user, tutorial }) => {
            window.sessionStorage.setItem(user.key, user.value);
            // The tour prompt is a modal over the quest screen.
            window.localStorage.setItem(tutorial.key, tutorial.value);
        }, {
            user: storedUser(authority, token, expiresAt),
            tutorial: { key: 'rego_tutorial_completed', value: 'true' }
        });
        await page.goto(harness.url(), { waitUntil: 'domcontentloaded' });

        const offered = await page.waitForSelector('#quest-pack-list .quest-pack-tile', { timeout: 5000 })
            .then(() => true).catch(() => false);
        report.check('a signed-in player is offered the packs', offered, 'no pack tiles: the server refused the token');
        if (!offered) {
            return;
        }

        await page.locator('#quest-pack-list .quest-pack-tile').first().click();
        await page.locator('#quest-pack-list .quest-pack-detail .start-pack-btn').first().click();
        await page.waitForSelector('#game-interface:not(.hidden)', { timeout: 5000 });
        await page.click('#start-adventure');
        // The hint control is enabled only on a playable quest screen.
        const entered = await page.waitForSelector('#hint-btn:not([disabled])', { timeout: 5000 })
            .then(() => true).catch(() => false);
        report.check('the signed-in player reaches a playable quest', entered, 'the quest screen never opened');

        // The token expires while the quest screen is open.
        const remaining = (expiresAt - Date.now() / 1000) * 1000 + 700;
        if (remaining > 0) {
            await page.waitForTimeout(remaining);
        }

        // A reveal goes through the hint confirm dialog; the confirm performs
        // the fetch.
        await page.click('#hint-btn');
        await page.waitForSelector('#hint-modal[open]', { timeout: 3000 });
        await page.click('#confirm-hint-btn');
        const home = await page.waitForSelector('#start-screen:not(.hidden)', { timeout: 5000 })
            .then(() => true).catch(() => false);
        const screens = await page.evaluate(() => ({
            start: !document.getElementById('start-screen').classList.contains('hidden'),
            game: !document.getElementById('game-interface').classList.contains('hidden'),
            login: !document.getElementById('login-container').classList.contains('hidden'),
            logout: !document.getElementById('logout-btn').classList.contains('hidden')
        }));
        report.check(
            'the refused renewal takes the player back to the start screen',
            home && screens.start && !screens.game,
            JSON.stringify(screens)
        );
        report.check(
            'the login control is what they are offered',
            screens.login && !screens.logout,
            JSON.stringify(screens)
        );

        const kept = await page.evaluate((pack) => ({
            pointer: localStorage.getItem('rego_pack_id'),
            body: localStorage.getItem(`rego_pack_state_${pack}`)
        }), PACK);
        report.check(
            'the adventure is left flushed and closed, not open on a dead session',
            kept.pointer === null && kept.body !== null,
            JSON.stringify({ pointer: kept.pointer, body: kept.body === null ? null : 'present' })
        );

        const toast = await toastText(page);
        report.check(
            'the quest request that failed says the session could not be renewed',
            Boolean(toast && /could not be renewed/i.test(toast)),
            `toast: ${toast}`
        );

        const errors = harness.consoleErrors.filter((line) => !NOISE.test(line));
        report.check('no unexpected page errors inside a quest', errors.length === 0, errors.slice(0, 4).join(' ;; '));

        await harness.context.close();
    } finally {
        await server.stop('SIGTERM');
        stub.server.close();
        removePack(repoRoot, PACK);
    }
}

let PORT = Number(process.env.QA_PORT || 0);

async function main() {
    const baseline = gitStatus(repoRoot);
    if (!PORT) {
        PORT = await pickFreePort();
    }
    console.log(`port ${PORT}`);
    const report = new Report('session machine browser QA');

    let phase = 'startup';
    const watchdog = setTimeout(() => {
        console.error(`\nsession QA exceeded ${WATCHDOG_MS / 1000}s during "${phase}"`);
        stopServersSync();
        process.exit(2);
    }, WATCHDOG_MS);
    process.on('SIGINT', () => {
        stopServersSync();
        process.exit(130);
    });
    process.on('SIGTERM', () => {
        stopServersSync();
        process.exit(130);
    });

    const binary = buildServer(repoRoot);
    try {
        // Both phases always run, each reporting its own outcome, and the
        // completion check is recorded either way, so the set of check names does
        // not depend on what happened mid-run.
        const phases = [
            ['refused renewal on the start screen', refusedRenewal],
            ['refused renewal inside a quest', refusedInsideAQuest]
        ];
        await withBrowser(async (browser) => {
            for (const [name, run] of phases) {
                phase = name;
                const completed = `${name} ran to the end`;
                try {
                    await run(browser, report, binary);
                    report.check(completed, true);
                } catch (error) {
                    report.check(completed, false, error.message.split('\n')[0]);
                }
            }
        });
    } catch (error) {
        report.check('the suite ran to the end', false, error.message.split('\n')[0]);
    } finally {
        stopServersSync();
    }

    clearTimeout(watchdog);
    const clean = report.done();
    const left = leftoverChanges(repoRoot, baseline);
    if (left.length > 0) {
        console.log(`\nleft behind by the run:\n${left.join('\n')}`);
    }
    process.exit(clean && left.length === 0 ? 0 : 1);
}

main();
