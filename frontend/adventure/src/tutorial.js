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
 * Interactive Tutorial System
 * Provides a step-by-step walkthrough of the interface for first-time users.
 *
 * The guided tour itself is powered by driver.js (overlay, spotlight,
 * tooltip positioning, keyboard navigation, resize handling); this module
 * owns the prompt dialog, the step definitions, and the temporary
 * unhide/restore bookkeeping for elements the tour needs visible.
 */

import { driver } from 'driver.js';
import { getLocalStorage, setLocalStorage, STORAGE_KEYS } from './services/storage-service.js';

export class TutorialSystem {
    constructor() {
        this.driverObj = null;
        // Track selectors hidden by the tutorial so they can be restored
        this.hiddenElementsState = new Set();
    }

    /**
     * Check if tutorial should be shown
     */
    shouldShowTutorial() {
        return !getLocalStorage(STORAGE_KEYS.TUTORIAL_COMPLETED);
    }

    /**
     * Mark tutorial as completed
     */
    markCompleted() {
        setLocalStorage(STORAGE_KEYS.TUTORIAL_COMPLETED, 'true');
    }

    /**
     * Show initial tutorial prompt modal
     */
    showTutorialPrompt() {
        if (!this.shouldShowTutorial()) {
            return;
        }

        // Create modal
        const modal = document.createElement('dialog');
        modal.className = 'tutorial-prompt-modal';
        modal.setAttribute('aria-labelledby', 'tutorial-prompt-title');
        modal.innerHTML = `
            <div class="tutorial-prompt-content surface-bg">
                <h2 id="tutorial-prompt-title">Welcome, Adventurer!</h2>
                <p>Would you like a guided tour of the interface? This will help you understand how to navigate your quest.</p>
                <div class="tutorial-prompt-checkbox">
                    <input type="checkbox" id="tutorial-dont-show" />
                    <label for="tutorial-dont-show">Don't show this again</label>
                </div>
                <div class="tutorial-prompt-actions">
                    <button id="tutorial-decline-btn" class="action-btn secondary">No, I'll Explore</button>
                    <button id="tutorial-accept-btn" class="action-btn primary">Yes, Show Me Around</button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);
        modal.showModal();

        // Event listeners
        const acceptBtn = modal.querySelector('#tutorial-accept-btn');
        const declineBtn = modal.querySelector('#tutorial-decline-btn');
        const dontShowCheckbox = modal.querySelector('#tutorial-dont-show');

        acceptBtn.addEventListener('click', () => {
            if (dontShowCheckbox.checked) {
                this.markCompleted();
            }
            modal.close();
            modal.remove();
            this.startTutorial();
        });

        declineBtn.addEventListener('click', () => {
            if (dontShowCheckbox.checked) {
                this.markCompleted();
            }
            modal.close();
            modal.remove();
        });

        modal.addEventListener('cancel', (event) => {
            event.preventDefault();
            declineBtn.click();
        });

        // Focus on accept button
        setTimeout(() => acceptBtn.focus(), 100);
    }

    /**
     * Define tutorial steps (driver.js format)
     */
    defineTutorialSteps() {
        return [
            {
                element: '#quest-title',
                popover: {
                    title: 'Quest Title',
                    description: 'This shows the current quest you\'re working on. Each adventure has multiple quests to complete.',
                    side: 'bottom',
                    align: 'center'
                }
            },
            {
                element: '.lore-text',
                popover: {
                    title: 'Quest Lore',
                    description: 'Read the story here to understand the context of your quest. Some quests have multiple pages of lore you can navigate through.',
                    side: 'bottom',
                    align: 'center'
                }
            },
            {
                element: '#lore-prev-btn',
                popover: {
                    title: 'Previous Lore Page',
                    description: 'Let\'s you navigate to the previous page of lore',
                    side: 'bottom',
                    align: 'center'
                }
            },
            {
                element: '#lore-next-btn',
                popover: {
                    title: 'Next Lore Page',
                    description: 'Let\'s you navigate to the next page of lore',
                    side: 'bottom',
                    align: 'center'
                }
            },
            {
                element: '.task-box',
                popover: {
                    title: 'Your Task',
                    description: 'This is your objective. Read it carefully to understand what you need to accomplish.',
                    side: 'top',
                    align: 'center'
                }
            },
            {
                element: '#hint-btn',
                popover: {
                    title: 'Ask Advisor',
                    description: 'Stuck? Click here to get hints. Note that using hints will reduce your score, so try solving it yourself first!',
                    side: 'top',
                    align: 'center'
                }
            },
            {
                element: '#rego-editor',
                popover: {
                    title: 'Policy Grimoire (Editor)',
                    description: 'This is where you write your Rego policy code. Your solution to each quest goes here.',
                    side: 'left',
                    align: 'center'
                }
            },
            {
                element: '#check-manual-btn',
                popover: {
                    title: 'Manual',
                    description: 'Click here to view helpful documentation, data models, and code snippets for the current quest.',
                    side: 'bottom',
                    align: 'center'
                }
            },
            {
                element: '#check-test-payload-btn',
                popover: {
                    title: 'Test Payload',
                    description: 'Click here to view the test payload data that your policy will be evaluated against. This helps you understand what inputs your solution needs to handle.',
                    side: 'bottom',
                    align: 'center'
                }
            },
            {
                element: '#verify-btn',
                popover: {
                    title: 'Apply Policy',
                    description: 'When you\'re ready, click here to test your solution. You\'ll see if your policy passes all the tests.',
                    side: 'top',
                    align: 'center'
                }
            },
            {
                element: '#quest-back-btn',
                popover: {
                    title: 'Older Quests',
                    description: 'Let\'s you go back to already solved quests.',
                    side: 'top',
                    align: 'center'
                }
            },
            {
                element: '#quest-forward-btn',
                popover: {
                    title: 'Forward Quests',
                    description: 'Let\'s you go forward, again.',
                    side: 'top',
                    align: 'center'
                }
            },
            {
                element: '#minimize-btn',
                popover: {
                    title: 'Minimize Interface',
                    description: 'Click here to hide the editor and quest panes, revealing the background. Click again to restore the full interface.',
                    side: 'bottom',
                    align: 'center'
                }
            },
            {
                element: '#music-btn',
                popover: {
                    title: 'Music Control',
                    description: 'Toggle background music on or off. Immerse yourself in the adventure!',
                    side: 'bottom',
                    align: 'center'
                }
            },
            {
                element: '#effects-btn',
                popover: {
                    title: 'Effects Control',
                    description: 'Toggle effects to toggle visual effects on or off. This enhances the game experience, but might be disturbing to some.',
                    side: 'bottom',
                    align: 'center'
                }
            },
            {
                element: '#restart-btn',
                popover: {
                    title: 'Restart Adventure',
                    description: 'Click here to restart the current adventure from the beginning. All progress will be lost!',
                    side: 'bottom',
                    align: 'center'
                }
            },
            {
                element: '#home-btn',
                popover: {
                    title: 'Return Home',
                    description: 'Go back to the adventure selection screen. Your progress is automatically saved.',
                    side: 'bottom',
                    align: 'center'
                }
            },
            {
                element: '#logout-btn',
                popover: {
                    title: 'Logout',
                    description: 'Sign out of your session here. Your adventure progress is saved locally and will be there when you return.',
                    side: 'bottom',
                    align: 'center'
                }
            },
            {
                element: '#experience-points',
                popover: {
                    title: 'Experience Points',
                    description: 'Your total XP is shown here. Complete quests to earn points. Perfect solutions earn maximum points!',
                    side: 'bottom',
                    align: 'center'
                }
            },
            {
                element: '#quest-counter',
                popover: {
                    title: 'Quest Counter',
                    description: 'Wondering on wich quest you currently are on? This is where you get answers!',
                    side: 'bottom',
                    align: 'center'
                }
            },
            {
                element: '#start-adventure',
                popover: {
                    title: 'Start Your Adventure',
                    description: 'When you are ready to start your adventure, click here!',
                    side: 'top',
                    align: 'center'
                }
            }
        ];
    }

    /**
     * Temporarily unhide elements needed for the tutorial
     */
    temporarilyUnhideElements() {
        // List of elements that might be hidden initially but needed for tutorial
        const elementsToCheck = [
            '#rego-editor',
            '#editor-pane',
            '#check-manual-btn',
            '#check-test-payload-btn',
            '#verify-btn',
            '#quest-back-btn',
            '#quest-forward-btn'
        ];

        elementsToCheck.forEach(selector => {
            const element = document.querySelector(selector);
            if (element && element.classList.contains('hidden')) {
                this.hiddenElementsState.add(selector);
                element.classList.remove('hidden');
            }
        });
    }

    /**
     * Restore elements to their original hidden state and clear the state map
     */
    restoreHiddenElements() {
        this.hiddenElementsState.forEach((selector) => {
            const element = document.querySelector(selector);
            if (element) {
                element.classList.add('hidden');
            }
        });

        // Clear the tracked state
        this.hiddenElementsState.clear();
    }

    /**
     * Start the tutorial
     */
    startTutorial() {
        // Temporarily unhide elements needed for tutorial
        this.temporarilyUnhideElements();

        // Only include steps whose element exists and is actually visible;
        // the overlay blocks interaction, so visibility cannot change mid-tour
        const steps = this.defineTutorialSteps().filter(step => {
            const element = document.querySelector(step.element);
            if (!element) return false;
            const computedStyle = window.getComputedStyle(element);
            return computedStyle.display !== 'none' && computedStyle.visibility !== 'hidden';
        });

        if (steps.length === 0) {
            this.restoreHiddenElements();
            return;
        }

        this.driverObj = driver({
            steps,
            popoverClass: 'tutorial-driver-popover',
            showProgress: true,
            progressText: 'Step {{current}} of {{total}}',
            nextBtnText: 'Next',
            prevBtnText: 'Previous',
            doneBtnText: 'Finish',
            showButtons: ['close', 'previous', 'next'],
            // Highlighted elements are not clickable during the tour,
            // matching the old pointer-events: none behavior
            disableActiveInteraction: true,
            onDestroyed: () => {
                this.driverObj = null;
                this.restoreHiddenElements();
            }
        });

        this.driverObj.drive();
    }
}

// Create singleton instance
export const tutorial = new TutorialSystem();
