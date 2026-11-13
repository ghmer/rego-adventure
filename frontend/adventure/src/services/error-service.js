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
 * Error Service
 * Centralized error handling and user notification
 */

import { ApiError } from './api-service.js';
import { showError } from './error-display.js';
import { ErrorLevel, AuthFailure } from './constants.js';

/**
 * The sentence for a failed API call, chosen from the error's own data (status
 * and, for a 401, authFailure) rather than from message text. handleApiError
 * and initializeApp both use it.
 * @param {Error} error - ApiError from api-service
 * @returns {string} User-facing sentence
 */
export function apiErrorHint(error) {
    if (error instanceof ApiError) {
        if (error.status === 401) {
            return error.authFailure === AuthFailure.RenewalFailed
                ? 'The session could not be renewed. Please log in again.'
                : 'Your session has expired. Please log in again.';
        }
        if (error.status === 0) {
            return 'Please check if the server is running.';
        }
        if (error.status === 408) {
            // Mirrors the player-facing timeout message the backend puts
            // in the 408 body (backend/http/handlers.go timeoutMessage);
            // kept here because ensureOk discards error response bodies.
            return 'Your policy took too long to evaluate. Check for unbounded loops or very large comprehensions.';
        }
        if (error.status >= 500) {
            return 'The server encountered an error. Please try again later.';
        }
    }
    return 'Please try again.';
}

/**
 * Handle API errors with user-friendly messages, branching on the
 * error's data (status code) instead of matching message strings
 * @param {Error} error - The error object (ApiError from api-service)
 * @param {string} context - Context about what operation failed
 */
export function handleApiError(error, context) {
    console.error(`API Error in ${context}:`, error);
    showError(`Failed to ${context}. ${apiErrorHint(error)}`, ErrorLevel.ERROR);
}
