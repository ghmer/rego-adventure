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
 * Provides a step-by-step walkthrough of the interface for first-time users
 */

import { getLocalStorage, setLocalStorage, STORAGE_KEYS } from './services/storage-service.js';

export class TutorialSystem {
    constructor() {
        this.currentStep = 0;
        this.isActive = false;
        this.tutorialSteps = [];
        this.overlay = null;
        this.spotlight = null;
        this.tooltip = null;
        this.hiddenElementsState = new Map(); // Track originally hidden elements
        this.resizeHandler = null; // Store resize handler for cleanup
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
        const modal = document.createElement('div');
        modal.className = 'tutorial-prompt-modal';
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-labelledby', 'tutorial-prompt-title');
        modal.setAttribute('aria-modal', 'true');
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

        // Event listeners
        const acceptBtn = modal.querySelector('#tutorial-accept-btn');
        const declineBtn = modal.querySelector('#tutorial-decline-btn');
        const dontShowCheckbox = modal.querySelector('#tutorial-dont-show');

        acceptBtn.addEventListener('click', () => {
            if (dontShowCheckbox.checked) {
                this.markCompleted();
            }
            modal.remove();
            this.startTutorial();
        });

        declineBtn.addEventListener('click', () => {
            if (dontShowCheckbox.checked) {
                this.markCompleted();
            }
            modal.remove();
        });

        // Keyboard support for modal
        const handleKeyDown = (e) => {
            if (e.key === 'Escape') {
                declineBtn.click();
            }
        };
        modal.addEventListener('keydown', handleKeyDown);

        // Focus on accept button
        setTimeout(() => acceptBtn.focus(), 100);
    }

    /**
     * Define tutorial steps
     */
    defineTutorialSteps() {
        this.tutorialSteps = [
            {
                element: '#quest-title',
                title: 'Quest Title',
                description: 'This shows the current quest you\'re working on. Each adventure has multiple quests to complete.',
                position: 'bottom'
            },
            {
                element: '.lore-text',
                title: 'Quest Lore',
                description: 'Read the story here to understand the context of your quest. Some quests have multiple pages of lore you can navigate through.',
                position: 'bottom'
            },
            {
                element: '#lore-prev-btn',
                title: 'Previous Lore Page',
                description: 'Let\'s you navigate to the previous page of lore',
                position: 'bottom'
            },
            {
                element: '#lore-next-btn',
                title: 'Next Lore Page',
                description: 'Let\'s you navigate to the next page of lore',
                position: 'bottom'
            },
            {
                element: '.task-box',
                title: 'Your Task',
                description: 'This is your objective. Read it carefully to understand what you need to accomplish.',
                position: 'top'
            },
            {
                element: '#hint-btn',
                title: 'Ask Advisor',
                description: 'Stuck? Click here to get hints. Note that using hints will reduce your score, so try solving it yourself first!',
                position: 'top'
            },
            {
                element: '#rego-editor',
                title: 'Policy Grimoire (Editor)',
                description: 'This is where you write your Rego policy code. Your solution to each quest goes here.',
                position: 'left'
            },
            {
                element: '#check-manual-btn',
                title: 'Manual',
                description: 'Click here to view helpful documentation, data models, and code snippets for the current quest.',
                position: 'bottom'
            },
            {
                element: '#check-test-payload-btn',
                title: 'Test Payload',
                description: 'Click here to view the test payload data that your policy will be evaluated against. This helps you understand what inputs your solution needs to handle.',
                position: 'bottom'
            },
            {
                element: '#verify-btn',
                title: 'Apply Policy',
                description: 'When you\'re ready, click here to test your solution. You\'ll see if your policy passes all the tests.',
                position: 'top'
            },
            {
                element: '#quest-back-btn',
                title: 'Older Quests',
                description: 'Let\'s you go back to already solved quests.',
                position: 'top'
            },
            {
                element: '#quest-forward-btn',
                title: 'Forward Quests',
                description: 'Let\'s you go forward, again.',
                position: 'top'
            },
            {
                element: '#music-btn',
                title: 'Music Control',
                description: 'Toggle background music on or off. Immerse yourself in the adventure!',
                position: 'bottom'
            },
            {
                element: '#effects-btn',
                title: 'Effects Control',
                description: 'Toggle effects to toggle visual effects on or off. This enhances the game experience, but might be disturbing to some.',
                position: 'bottom'
            },
            {
                element: '#restart-btn',
                title: 'Restart Adventure',
                description: 'Click here to restart the current adventure from the beginning. All progress will be lost!',
                position: 'bottom'
            },
            {
                element: '#home-btn',
                title: 'Return Home',
                description: 'Go back to the adventure selection screen. Your progress is automatically saved.',
                position: 'bottom'
            },
            {
                element: '#experience-points',
                title: 'Experience Points',
                description: 'Your total XP is shown here. Complete quests to earn points. Perfect solutions earn maximum points!',
                position: 'bottom'
            },
            {
                element: '#quest-counter',
                title: 'Quest Counter',
                description: 'Wondering on wich quest you currently are on? This is where you get answers!',
                position: 'bottom'
            },
            {
                element: '#start-adventure',
                title: 'Start Your Adventure',
                description: 'When you are ready to start your adventure, click here!',
                position: 'top'
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
            if (element) {
                const computedStyle = window.getComputedStyle(element);
                const isHidden = computedStyle.display === 'none' ||
                                element.classList.contains('hidden') ||
                                element.style.display === 'none';
                
                if (isHidden) {
                    // Store original state
                    this.hiddenElementsState.set(selector, {
                        display: element.style.display,
                        hasHiddenClass: element.classList.contains('hidden')
                    });
                    
                    // Temporarily show the element
                    element.classList.remove('hidden');
                    if (element.style.display === 'none') {
                        element.style.display = '';
                    }
                }
            }
        });
        
        // Also ensure the editor pane parent is visible
        const editorPane = document.querySelector('#editor-pane');
        if (editorPane && editorPane.classList.contains('hidden')) {
            if (!this.hiddenElementsState.has('#editor-pane')) {
                this.hiddenElementsState.set('#editor-pane', {
                    display: editorPane.style.display,
                    hasHiddenClass: true
                });
            }
            editorPane.classList.remove('hidden');
        }
    }

    /**
     * Restore elements to their original hidden state and clear the state map
     */
    restoreHiddenElements() {
        this.hiddenElementsState.forEach((state, selector) => {
            const element = document.querySelector(selector);
            if (element) {
                if (state.hasHiddenClass) {
                    element.classList.add('hidden');
                }
                if (state.display === 'none') {
                    element.style.display = 'none';
                }
            }
        });
        
        // Clear the state map
        this.hiddenElementsState.clear();
    }

    /**
     * Start the tutorial
     */
    startTutorial() {
        this.isActive = true;
        this.currentStep = 0;
        
        // Add resize listener
        this.resizeHandler = () => this.handleResize();
        window.addEventListener('resize', this.resizeHandler);
        
        // Temporarily unhide elements needed for tutorial
        this.temporarilyUnhideElements();
        
        this.defineTutorialSteps();
        this.createTutorialElements();
        this.showStep(0);
    }

    /**
     * Create overlay and tooltip elements
     */
    createTutorialElements() {
        // Create dark overlay that blocks all interactions
        this.overlay = document.createElement('div');
        this.overlay.className = 'tutorial-overlay';
        this.overlay.style.pointerEvents = 'auto'; // Ensure overlay captures all clicks
        this.overlay.setAttribute('aria-hidden', 'true');
        document.body.appendChild(this.overlay);

        // Create spotlight border (just the border, no shadow)
        this.spotlight = document.createElement('div');
        this.spotlight.className = 'tutorial-spotlight';
        this.spotlight.setAttribute('aria-hidden', 'true');
        document.body.appendChild(this.spotlight);

        // Create tooltip
        this.tooltip = document.createElement('div');
        this.tooltip.className = 'tutorial-tooltip';
        this.tooltip.setAttribute('role', 'dialog');
        this.tooltip.setAttribute('aria-labelledby', 'tutorial-tooltip-title');
        this.tooltip.setAttribute('aria-describedby', 'tutorial-tooltip-content');
        this.tooltip.setAttribute('aria-modal', 'true');
        this.tooltip.innerHTML = `
            <div class="tutorial-tooltip-header">
                <h3 id="tutorial-tooltip-title" class="tutorial-tooltip-title"></h3>
                <button class="tutorial-close-btn" aria-label="Close tutorial">&times;</button>
            </div>
            <div id="tutorial-tooltip-content" class="tutorial-tooltip-content"></div>
            <div class="tutorial-tooltip-footer">
                <div class="tutorial-progress">
                    <span class="tutorial-step-counter" aria-live="polite" aria-atomic="true"></span>
                </div>
                <div class="tutorial-tooltip-actions">
                    <button class="tutorial-skip-btn action-btn secondary small">Skip Tutorial</button>
                    <div class="tutorial-navigation-buttons">
                        <button class="tutorial-prev-btn action-btn secondary small" aria-label="Go to previous tutorial step">Previous</button>
                        <button class="tutorial-next-btn action-btn primary small" aria-label="Go to next tutorial step">Next</button>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(this.tooltip);

        // Event listeners
        this.tooltip.querySelector('.tutorial-close-btn').addEventListener('click', () => this.endTutorial());
        this.tooltip.querySelector('.tutorial-skip-btn').addEventListener('click', () => this.endTutorial());
        this.tooltip.querySelector('.tutorial-prev-btn').addEventListener('click', () => this.previousStep());
        this.tooltip.querySelector('.tutorial-next-btn').addEventListener('click', () => this.nextStep());

        // Keyboard navigation
        this.handleKeyDown = (e) => {
            if (!this.isActive) return;
            
            switch(e.key) {
                case 'Escape':
                    this.endTutorial();
                    break;
                case 'ArrowRight':
                case 'ArrowDown':
                    e.preventDefault();
                    this.nextStep();
                    break;
                case 'ArrowLeft':
                case 'ArrowUp':
                    e.preventDefault();
                    this.previousStep();
                    break;
            }
        };
        document.addEventListener('keydown', this.handleKeyDown);
    }

    /**
     * Show a specific tutorial step
     */
    showStep(stepIndex) {
        if (stepIndex < 0 || stepIndex >= this.tutorialSteps.length) {
            this.endTutorial();
            return;
        }

        this.currentStep = stepIndex;
        const step = this.tutorialSteps[stepIndex];
        const element = document.querySelector(step.element);

        if (!element) {
            console.warn(`Tutorial element not found: ${step.element}, skipping to next step`);
            // Skip to next step if element not found
            if (stepIndex < this.tutorialSteps.length - 1) {
                this.showStep(stepIndex + 1);
            } else {
                this.endTutorial();
            }
            return;
        }
        
        // Check if element is actually visible
        const computedStyle = window.getComputedStyle(element);
        if (computedStyle.display === 'none' || computedStyle.visibility === 'hidden') {
            console.warn(`Tutorial element not visible: ${step.element}, skipping to next step`);
            // Skip to next step if element not visible
            if (stepIndex < this.tutorialSteps.length - 1) {
                this.showStep(stepIndex + 1);
            } else {
                this.endTutorial();
            }
            return;
        }

        // Update spotlight position
        this.positionSpotlight(element);
        
        // Ensure highlighted element is not interactive during tutorial
        // Only the tutorial controls should be clickable
        element.style.pointerEvents = 'none';

        // Update tooltip content
        this.tooltip.querySelector('.tutorial-tooltip-title').textContent = step.title;
        this.tooltip.querySelector('.tutorial-tooltip-content').textContent = step.description;
        this.tooltip.querySelector('.tutorial-step-counter').textContent =
            `Step ${stepIndex + 1} of ${this.tutorialSteps.length}`;

        // Update button states
        const prevBtn = this.tooltip.querySelector('.tutorial-prev-btn');
        const nextBtn = this.tooltip.querySelector('.tutorial-next-btn');
        
        prevBtn.disabled = stepIndex === 0;
        prevBtn.setAttribute('aria-disabled', stepIndex === 0 ? 'true' : 'false');
        
        if (stepIndex === this.tutorialSteps.length - 1) {
            nextBtn.textContent = 'Finish';
            nextBtn.setAttribute('aria-label', 'Finish tutorial');
        } else {
            nextBtn.textContent = 'Next';
            nextBtn.setAttribute('aria-label', 'Go to next tutorial step');
        }

        // Position tooltip
        this.positionTooltip(element, step.position);

        // Scroll element into view if needed
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });

        // Add highlight animation
        this.spotlight.classList.remove('tutorial-spotlight-pulse');
        void this.spotlight.offsetWidth; // Force reflow
        this.spotlight.classList.add('tutorial-spotlight-pulse');

        // Focus on the tooltip for screen readers
        setTimeout(() => {
            const nextButton = this.tooltip.querySelector('.tutorial-next-btn');
            if (nextButton) {
                nextButton.focus();
            }
        }, 100);
    }

    /**
     * Position the spotlight around an element
     * Creates a border around the element and uses clip-path to cut out the highlighted area from the overlay
     * The polygon creates a frame by drawing around the viewport edges and creating a rectangular hole
     */
    positionSpotlight(element) {
        const rect = element.getBoundingClientRect();
        const padding = 8;

        // Use transform for GPU-accelerated positioning
        const x = rect.left - padding;
        const y = rect.top - padding;
        const width = rect.width + padding * 2;
        const height = rect.height + padding * 2;

        this.spotlight.style.top = '0';
        this.spotlight.style.left = '0';
        this.spotlight.style.transform = `translate(${x}px, ${y}px)`;
        this.spotlight.style.width = `${width}px`;
        this.spotlight.style.height = `${height}px`;
        
        // Update overlay clip-path to cut out the highlighted area
        const clipPath = `polygon(
            0% 0%,
            0% 100%,
            ${rect.left - padding}px 100%,
            ${rect.left - padding}px ${rect.top - padding}px,
            ${rect.right + padding}px ${rect.top - padding}px,
            ${rect.right + padding}px ${rect.bottom + padding}px,
            ${rect.left - padding}px ${rect.bottom + padding}px,
            ${rect.left - padding}px 100%,
            100% 100%,
            100% 0%
        )`;
        this.overlay.style.clipPath = clipPath;
    }

    /**
     * Position the tooltip relative to the highlighted element
     */
    positionTooltip(element, position) {
        const rect = element.getBoundingClientRect();
        const tooltipRect = this.tooltip.getBoundingClientRect();
        const spacing = 20;

        let top, left;

        switch (position) {
            case 'top':
                top = rect.top - tooltipRect.height - spacing;
                left = rect.left + (rect.width - tooltipRect.width) / 2;
                break;
            case 'bottom':
                top = rect.bottom + spacing;
                left = rect.left + (rect.width - tooltipRect.width) / 2;
                break;
            case 'left':
                top = rect.top + (rect.height - tooltipRect.height) / 2;
                left = rect.left - tooltipRect.width - spacing;
                break;
            case 'right':
                top = rect.top + (rect.height - tooltipRect.height) / 2;
                left = rect.right + spacing;
                break;
            default:
                top = rect.bottom + spacing;
                left = rect.left + (rect.width - tooltipRect.width) / 2;
        }

        // Keep tooltip within viewport
        const maxTop = window.innerHeight - tooltipRect.height - 20;
        const maxLeft = window.innerWidth - tooltipRect.width - 20;
        
        top = Math.max(20, Math.min(top, maxTop));
        left = Math.max(20, Math.min(left, maxLeft));

        this.tooltip.style.top = `${top}px`;
        this.tooltip.style.left = `${left}px`;
    }

    /**
     * Go to next step
     */
    nextStep() {
        if (this.currentStep < this.tutorialSteps.length - 1) {
            this.showStep(this.currentStep + 1);
        } else {
            this.endTutorial();
        }
    }

    /**
     * Go to previous step
     */
    previousStep() {
        if (this.currentStep > 0) {
            this.showStep(this.currentStep - 1);
        }
    }

    /**
     * End the tutorial
     */
    endTutorial() {
        this.isActive = false;
        
        // Remove resize event listener
        if (this.resizeHandler) {
            window.removeEventListener('resize', this.resizeHandler);
            this.resizeHandler = null;
        }
        
        // Remove keyboard event listener
        if (this.handleKeyDown) {
            document.removeEventListener('keydown', this.handleKeyDown);
            this.handleKeyDown = null;
        }
        
        // Re-enable pointer events on all previously highlighted elements
        this.tutorialSteps.forEach(step => {
            const element = document.querySelector(step.element);
            if (element) {
                element.style.pointerEvents = '';
            }
        });
        
        if (this.overlay) {
            this.overlay.remove();
            this.overlay = null;
        }
        
        if (this.spotlight) {
            this.spotlight.remove();
            this.spotlight = null;
        }
        
        if (this.tooltip) {
            this.tooltip.remove();
            this.tooltip = null;
        }

        // Restore elements to their original hidden state
        this.restoreHiddenElements();

        // Don't automatically mark as completed
        // Only mark as completed when user checks "Don't show this again"
    }

    /**
     * Handle window resize
     */
    handleResize() {
        if (this.isActive && this.currentStep >= 0) {
            const step = this.tutorialSteps[this.currentStep];
            const element = document.querySelector(step.element);
            if (element) {
                this.positionSpotlight(element);
                this.positionTooltip(element, step.position);
            }
        }
    }
}

// Create singleton instance
export const tutorial = new TutorialSystem();