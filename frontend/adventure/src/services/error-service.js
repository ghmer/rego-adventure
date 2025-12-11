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

/**
 * Error severity levels
 */
export const ErrorLevel = {
    INFO: 'info',
    WARNING: 'warning',
    ERROR: 'error',
    CRITICAL: 'critical'
};

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
 * Handle API errors with user-friendly messages
 * @param {Error} error - The error object
 * @param {string} context - Context about what operation failed
 */
export function handleApiError(error, context) {
    console.error(`API Error in ${context}:`, error);
    
    const userMessage = `Failed to ${context}. ${
        error.message.includes('fetch') 
            ? 'Please check if the server is running.' 
            : 'Please try again.'
    }`;
    
    showError(userMessage, ErrorLevel.ERROR);
}

/**
 * Handle storage errors
 * @param {Error} error - The error object
 * @param {string} operation - The storage operation that failed
 */
export function handleStorageError(error, operation) {
    console.error(`Storage Error during ${operation}:`, error);
    
    // Storage errors are usually not critical to user experience
    // Log but don't show alert
    console.warn(`localStorage ${operation} failed. Some progress may not be saved.`);
}

/**
 * Wrap an async function with error handling
 * @param {Function} fn - The async function to wrap
 * @param {string} context - Context for error messages
 * @returns {Function} Wrapped function with error handling
 */
export function withErrorHandling(fn, context) {
    return async (...args) => {
        try {
            return await fn(...args);
        } catch (error) {
            handleApiError(error, context);
            throw error; // Re-throw so caller can handle if needed
        }
    };
}

/**
 * Log an informational message
 * @param {string} message - The message to log
 */
export function logInfo(message) {
    console.info('[INFO]', message);
}

/**
 * Log a warning message
 * @param {string} message - The warning message
 */
export function logWarning(message) {
    console.warn('[WARNING]', message);
}