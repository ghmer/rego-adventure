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

import { showToast } from './toast-service.js';
import { ApiError } from './api-service.js';
import { ErrorLevel } from './constants.js';

/**
 * Display an error message to the user
 * @param {string} message - The error message to display
 * @param {string} level - The severity level (from ErrorLevel)
 */
export function showError(message, level = ErrorLevel.ERROR) {
    // Show toast notification for all error levels
    if (level === ErrorLevel.CRITICAL || level === ErrorLevel.ERROR) {
        showToast(message, level);
    }
    
    // Always log to console with appropriate level
    const logMethod = level === ErrorLevel.INFO ? 'info' : 
                     level === ErrorLevel.WARNING ? 'warn' : 'error';
    console[logMethod](`[${level.toUpperCase()}]`, message);
}

/**
 * Handle API errors with user-friendly messages, branching on the
 * error's data (status code) instead of matching message strings
 * @param {Error} error - The error object (ApiError from api-service)
 * @param {string} context - Context about what operation failed
 */
export function handleApiError(error, context) {
    console.error(`API Error in ${context}:`, error);

    let hint = 'Please try again.';
    if (error instanceof ApiError) {
        if (error.status === 401) {
            hint = 'Your session has expired. Please log in again.';
        } else if (error.status === 0) {
            hint = 'Please check if the server is running.';
        } else if (error.status >= 500) {
            hint = 'The server encountered an error. Please try again later.';
        }
    }

    showError(`Failed to ${context}. ${hint}`, ErrorLevel.ERROR);
}
