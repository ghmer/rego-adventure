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
 * Toast Service
 * Simple, lightweight toast notification system
 */

// Error level constants (defined locally to avoid circular dependency)
const ErrorLevel = {
    INFO: 'info',
    WARNING: 'warning',
    ERROR: 'error',
    CRITICAL: 'critical'
};

// Toast configuration
const TOAST_DURATION = {
    [ErrorLevel.INFO]: 3000,
    [ErrorLevel.WARNING]: 4000,
    [ErrorLevel.ERROR]: 5000,
    [ErrorLevel.CRITICAL]: 6000
};

let toastContainer = null;

/**
 * Initialize the toast container
 */
function initToastContainer() {
    if (!toastContainer) {
        toastContainer = document.createElement('div');
        toastContainer.id = 'toast-container';
        toastContainer.setAttribute('role', 'region');
        toastContainer.setAttribute('aria-label', 'Notifications');
        document.body.appendChild(toastContainer);
    }
}

/**
 * Show a toast notification
 * @param {string} message - The message to display
 * @param {string} level - The severity level (from ErrorLevel)
 */
export function showToast(message, level = ErrorLevel.INFO) {
    initToastContainer();
    
    // Create toast element
    const toast = document.createElement('div');
    toast.className = `toast toast-${level}`;
    toast.setAttribute('role', 'alert');
    toast.setAttribute('aria-live', level === ErrorLevel.CRITICAL ? 'assertive' : 'polite');
    
    // Create icon based on level
    const icon = document.createElement('span');
    icon.className = 'toast-icon';
    icon.innerHTML = getIconForLevel(level);
    
    // Create message content
    const messageEl = document.createElement('span');
    messageEl.className = 'toast-message';
    messageEl.textContent = message;
    
    // Create close button
    const closeBtn = document.createElement('button');
    closeBtn.className = 'toast-close';
    closeBtn.innerHTML = '&times;';
    closeBtn.setAttribute('aria-label', 'Close notification');
    closeBtn.onclick = () => removeToast(toast);
    
    // Assemble toast
    toast.appendChild(icon);
    toast.appendChild(messageEl);
    toast.appendChild(closeBtn);
    
    // Add to container
    toastContainer.appendChild(toast);
    
    // Trigger animation
    setTimeout(() => toast.classList.add('toast-show'), 10);
    
    // Auto-dismiss after duration
    const duration = TOAST_DURATION[level] || TOAST_DURATION[ErrorLevel.INFO];
    setTimeout(() => removeToast(toast), duration);
}

/**
 * Remove a toast with animation
 * @param {HTMLElement} toast - The toast element to remove
 */
function removeToast(toast) {
    if (!toast || !toast.parentElement) return;
    
    toast.classList.remove('toast-show');
    toast.classList.add('toast-hide');
    
    // Remove from DOM after animation
    setTimeout(() => {
        if (toast.parentElement) {
            toast.parentElement.removeChild(toast);
        }
    }, 300);
}

/**
 * Get icon HTML for severity level
 * @param {string} level - The severity level
 * @returns {string} Icon HTML
 */
function getIconForLevel(level) {
    switch (level) {
        case ErrorLevel.INFO:
            return '<i class="fa-solid fa-circle-info"></i>';
        case ErrorLevel.WARNING:
            return '<i class="fa-solid fa-triangle-exclamation"></i>';
        case ErrorLevel.ERROR:
            return '<i class="fa-solid fa-circle-exclamation"></i>';
        case ErrorLevel.CRITICAL:
            return '<i class="fa-solid fa-circle-xmark"></i>';
        default:
            return '<i class="fa-solid fa-circle-info"></i>';
    }
}