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

import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest';
import { ErrorLevel } from './services/constants.js';

// app.js wires the managers together and starts init() at import time, so
// the collaborators are mocked and each test imports the module fresh. The
// hoisted control keeps every deferred promise and mock reachable from the
// import-time call flow and from the assertions.

const control = vi.hoisted(() => {
    function deferred() {
        let resolve;
        let reject;
        const promise = new Promise((res, rej) => {
            resolve = res;
            reject = rej;
        });
        return { promise, resolve, reject };
    }

    const state = {
        configLoad: deferred(),
        fetchPacks: vi.fn(),
        migrationOrder: [],
        showToast: vi.fn(),
        apiErrorHint: vi.fn(() => 'The session could not be renewed.'),
        uiElements: { questPackList: null },
        order: [],
        ui: {
            initEffectsState: vi.fn(),
            updateAuthUI: vi.fn(),
            updateImpressumVisibility: vi.fn(),
            renderPackList: vi.fn(),
            updateAuthUIArgs: undefined
        },
        packManager: {
            startAdventure: vi.fn(),
            returnHome: vi.fn()
        },
        questManager: {
            loadQuest: vi.fn()
        },
        stateService: { currentPackId: '' },
        editorTextarea: document.createElement('textarea')
    };
    return state;
});

vi.mock('./services/config-service.js', () => ({
    ConfigService: {
        load: vi.fn(() => control.configLoad.promise),
        get: vi.fn(() => ({ show_impressum: true }))
    }
}));

vi.mock('./services/auth-service.js', () => ({
    AuthService: {
        init: vi.fn(function () { control.order.push('auth:init'); }),
        onSessionLost: vi.fn(),
        isEnabled: vi.fn(() => false),
        getUser: vi.fn(() => Promise.resolve(null))
    }
}));

vi.mock('./services/api-service.js', () => {
    class ApiError extends Error {
        constructor(status) {
            super(`api error ${status}`);
            this.status = status;
        }
    }
    return {
        ApiError,
        fetchPacks: control.fetchPacks
    };
});

vi.mock('./services/error-service.js', () => ({ apiErrorHint: control.apiErrorHint }));
vi.mock('./services/toast-service.js', () => ({ showToast: control.showToast }));
vi.mock('./services/storage-service.js', () => ({
    migrateStorageKeys: vi.fn(function () { control.migrationOrder.push('migrate'); })
}));

vi.mock('./services/editor-service.js', () => ({
    EditorService: vi.fn(function () { control.order.push('editor'); return { textarea: control.editorTextarea }; })
}));

vi.mock('./services/state-service.js', () => ({
    GameState: vi.fn(function () { return control.stateService; })
}));

vi.mock('./managers/ui-manager.js', () => ({
    UIManager: vi.fn(function (editorService, ...rest) {
        control.order.push('ui');
        return {
            _editorService: editorService,
            _rest: rest,
            ...control.ui,
            elements: control.uiElements
        };
    })
}));

vi.mock('./managers/grimoire-autosave.js', () => ({
    GrimoireAutosave: vi.fn(function () { return {}; })
}));

vi.mock('./managers/quest-manager.js', () => ({
    QuestManager: vi.fn(function () { return control.questManager; })
}));

vi.mock('./managers/audio-manager.js', () => ({
    AudioManager: vi.fn(function () { return {}; })
}));

vi.mock('./managers/modal-manager.js', () => ({
    ModalManager: vi.fn(function () { return {}; })
}));

vi.mock('./managers/pack-manager.js', () => ({
    PackManager: vi.fn(function () { return control.packManager; })
}));

vi.mock('./managers/event-manager.js', () => ({
    EventManager: vi.fn(function () { return { setupEventListeners: vi.fn() }; })
}));

function freshDeferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

function flush() {
    return new Promise(resolve => setTimeout(resolve, 0));
}

async function loadedApp() {
    const app = await import('./app.js');
    await flush();
    return app;
}

beforeEach(() => {
    document.body.innerHTML = '';
    control.uiElements.questPackList = document.createElement('div');
    control.order = [];
    control.migrationOrder = [];
    control.stateService.currentPackId = '';
    control.ui.initEffectsState.mockClear();
    control.ui.updateAuthUI.mockClear();
    control.ui.updateImpressumVisibility.mockClear();
    control.ui.renderPackList.mockClear();
    control.packManager.startAdventure.mockReset();
    control.packManager.startAdventure.mockResolvedValue(true);
    control.packManager.returnHome.mockClear();
    control.questManager.loadQuest.mockClear();
    control.fetchPacks.mockClear();
    control.showToast.mockClear();
    control.apiErrorHint.mockClear();
    control.configLoad = freshDeferred();
    control.configLoad.resolve();
    vi.resetModules();
});

describe('app init wiring', () => {
    afterEach(() => {
        control.configLoad.resolve();
    });

    it('migrates storage, mounts the editor before the UI manager and shows the page', async () => {
        await loadedApp();

        expect(document.documentElement.classList.contains('loaded')).toBe(true);
        const editorIndex = control.order.indexOf('editor');
        const uiIndex = control.order.indexOf('ui');
        expect(editorIndex).toBeGreaterThan(-1);
        expect(editorIndex).toBeLessThan(uiIndex);
        expect(control.migrationOrder[0]).toBe('migrate');
        expect(control.ui.initEffectsState).toHaveBeenCalledTimes(1);
    });

    it('wires the pack list to the auth-disabled flow', async () => {
        control.fetchPacks.mockResolvedValue([{ id: 'fantasy', title: 'Fantasy' }]);

        await loadedApp();

        expect(control.ui.updateImpressumVisibility).toHaveBeenCalledWith(true);
        expect(control.ui.updateAuthUI).toHaveBeenCalledWith(false, false);
        expect(control.ui.renderPackList).toHaveBeenCalledWith(
            [{ id: 'fantasy', title: 'Fantasy' }],
            expect.any(Function)
        );
    });

    it('stops after the pack list when the user is not authenticated', async () => {
        const { AuthService } = await import('./services/auth-service.js');
        AuthService.isEnabled.mockReturnValue(true);
        AuthService.getUser.mockResolvedValue(null);

        await loadedApp();

        expect(control.ui.updateAuthUI).toHaveBeenCalledWith(false, true);
        expect(control.ui.renderPackList).not.toHaveBeenCalled();
    });

    it('continues to the pack list when the user is authenticated', async () => {
        const { AuthService } = await import('./services/auth-service.js');
        AuthService.isEnabled.mockReturnValue(true);
        AuthService.getUser.mockResolvedValue({ name: 'player' });
        control.fetchPacks.mockResolvedValue([{ id: 'fantasy', title: 'Fantasy' }]);

        await loadedApp();

        expect(control.ui.updateAuthUI).toHaveBeenCalledWith(true, true);
        expect(control.ui.renderPackList).toHaveBeenCalledWith(
            [{ id: 'fantasy', title: 'Fantasy' }],
            expect.any(Function)
        );
    });

    it('resumes the saved pack through the guarded beginQuest path', async () => {
        control.stateService.currentPackId = 'fantasy';
        control.stateService.currentQuestId = 2;
        control.fetchPacks.mockResolvedValue([{ id: 'fantasy', title: 'Fantasy' }]);

        await loadedApp();

        expect(control.packManager.startAdventure).toHaveBeenCalledWith('fantasy');
        expect(control.questManager.loadQuest).toHaveBeenCalledWith(2);
    });

    it('reports a pack list click through the same guarded path', async () => {
        control.fetchPacks.mockResolvedValue([{ id: 'scifi', title: 'Scifi' }]);

        await loadedApp();

        const packListHandler = control.ui.renderPackList.mock.calls[0][1];
        await packListHandler('scifi');

        expect(control.packManager.startAdventure).toHaveBeenCalledWith('scifi');
        expect(control.questManager.loadQuest).toHaveBeenCalled();
    });

    it('rejects a second concurrent start with a toast and no second load', async () => {
        control.fetchPacks.mockResolvedValue([{ id: 'scifi', title: 'Scifi' }]);
        let releaseStart;
        control.packManager.startAdventure.mockImplementation(() => new Promise(resolve => {
            releaseStart = resolve;
        }));

        await loadedApp();

        const packListHandler = control.ui.renderPackList.mock.calls[0][1];
        const first = packListHandler('scifi');
        await packListHandler('scifi');

        expect(control.showToast).toHaveBeenCalledWith(
            'An adventure is already loading. Please wait for it.',
            ErrorLevel.INFO
        );
        expect(control.packManager.startAdventure).toHaveBeenCalledTimes(1);

        releaseStart(true);
        await first;
        expect(control.questManager.loadQuest).toHaveBeenCalledTimes(1);
    });

    it('renders a configuration failure instead of guessing auth state', async () => {
        control.configLoad = freshDeferred(); // an unresolved load must fail, not resolve
        control.configLoad.promise.catch(() => {});
        control.configLoad.reject(new Error('offline'));

        await loadedApp();

        expect(control.uiElements.questPackList.innerHTML).toContain('Configuration could not be loaded');
        const { AuthService } = await import('./services/auth-service.js');
        expect(AuthService.init).not.toHaveBeenCalled();
    });

    it('describes a refused session renewal through the api hint', async () => {
        const { ApiError } = await import('./services/api-service.js');
        control.fetchPacks.mockRejectedValue(new ApiError(401));

        await loadedApp();

        expect(control.apiErrorHint).toHaveBeenCalledWith(expect.objectContaining({ status: 401 }));
        expect(control.uiElements.questPackList.innerHTML).toContain('The session could not be renewed.');
    });

    it('falls back to a generic sentence on other failures', async () => {
        control.fetchPacks.mockRejectedValue(new Error('offline'));

        await loadedApp();

        expect(control.apiErrorHint).not.toHaveBeenCalled();
        expect(control.uiElements.questPackList.innerHTML).toContain('Error loading adventures.');
    });
});
