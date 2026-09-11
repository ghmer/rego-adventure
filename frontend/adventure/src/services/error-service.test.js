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

const toastMock = vi.hoisted(() => ({
    showToast: vi.fn()
}));

vi.mock('./toast-service.js', () => ({ showToast: toastMock.showToast }));

import { showError, handleApiError } from './error-service.js';
import { ApiError } from './api-service.js';
import { ErrorLevel } from './constants.js';

describe('error-service', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.spyOn(console, 'info').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('showError', () => {
        it('fires a toast for ERROR level', () => {
            showError('something broke', ErrorLevel.ERROR);

            expect(toastMock.showToast).toHaveBeenCalledWith('something broke', ErrorLevel.ERROR);
        });

        it('fires a toast for CRITICAL level', () => {
            showError('catastrophe', ErrorLevel.CRITICAL);

            expect(toastMock.showToast).toHaveBeenCalledWith('catastrophe', ErrorLevel.CRITICAL);
        });

        it('logs INFO to the console without a toast', () => {
            showError('fyi', ErrorLevel.INFO);

            expect(toastMock.showToast).not.toHaveBeenCalled();
            expect(console.info).toHaveBeenCalled();
        });

        it('logs WARNING to the console without a toast', () => {
            showError('hmm', ErrorLevel.WARNING);

            expect(toastMock.showToast).not.toHaveBeenCalled();
            expect(console.warn).toHaveBeenCalled();
        });

        it('defaults to ERROR level', () => {
            showError('oops');

            expect(toastMock.showToast).toHaveBeenCalledWith('oops', ErrorLevel.ERROR);
        });
    });

    describe('handleApiError', () => {
        it('shows the generic retry hint for unknown errors', () => {
            handleApiError(new Error('mystery'), 'verify solution');

            expect(toastMock.showToast).toHaveBeenCalledWith(
                'Failed to verify solution. Please try again.',
                ErrorLevel.ERROR
            );
        });

        it('shows the session hint on 401', () => {
            handleApiError(new ApiError('unauthorized', 401), 'load packs');

            expect(toastMock.showToast).toHaveBeenCalledWith(
                'Failed to load packs. Your session has expired. Please log in again.',
                ErrorLevel.ERROR
            );
        });

        it('shows the server hint on network failures (status 0)', () => {
            handleApiError(new ApiError('Network error: boom', 0), 'load packs');

            expect(toastMock.showToast).toHaveBeenCalledWith(
                'Failed to load packs. Please check if the server is running.',
                ErrorLevel.ERROR
            );
        });

        it('shows the evaluation timeout hint on 408', () => {
            handleApiError(new ApiError('Verification timed out', 408), 'verify solution');

            expect(toastMock.showToast).toHaveBeenCalledWith(
                'Failed to verify solution. Your policy took too long to evaluate. ' +
                'Check for unbounded loops or very large comprehensions.',
                ErrorLevel.ERROR
            );
        });

        it('shows the server error hint on 5xx', () => {
            handleApiError(new ApiError('Internal server error', 500), 'load packs');

            expect(toastMock.showToast).toHaveBeenCalledWith(
                'Failed to load packs. The server encountered an error. Please try again later.',
                ErrorLevel.ERROR
            );
        });

        it('keeps the generic hint for 4xx statuses without a dedicated hint', () => {
            handleApiError(new ApiError('not found', 404), 'load pack details');

            expect(toastMock.showToast).toHaveBeenCalledWith(
                'Failed to load pack details. Please try again.',
                ErrorLevel.ERROR
            );
        });

        it('always logs the failing context', () => {
            handleApiError(new ApiError('unauthorized', 401), 'verify solution');

            expect(console.error).toHaveBeenCalledWith(
                'API Error in verify solution:',
                expect.any(ApiError)
            );
        });
    });
});
