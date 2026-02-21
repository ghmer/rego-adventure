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
 * UI Manager
 * Handles DOM element references and UI rendering operations
 */

import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { getLocalStorage, setLocalStorage, STORAGE_KEYS } from '../services/storage-service.js';
import { DEFAULT_TEXT } from '../services/constants.js';

/**
 * Manages all DOM elements and UI rendering
 */
export class UIManager {
    constructor() {
        this.elements = this.initializeElements();
    }

    /**
     * Initialize all DOM element references
     * @returns {Object} Object containing all DOM element references
     */
    initializeElements() {
        return {
            // Quest elements
            questCounter: document.getElementById('quest-counter'),
            questTitle: document.getElementById('quest-title'),
            questLore: document.getElementById('quest-lore'),
            loreControls: document.getElementById('lore-controls'),
            lorePrevBtn: document.getElementById('lore-prev-btn'),
            loreNextBtn: document.getElementById('lore-next-btn'),
            lorePageIndicator: document.getElementById('lore-page-indicator'),
            questTask: document.getElementById('quest-task'),
            
            // Hints
            hintsList: document.getElementById('hints-list'),
            hintBtn: document.getElementById('hint-btn'),
            
            // Outcome
            outcomeArea: document.getElementById('outcome-area'),
            outcomeMessage: document.getElementById('outcome-message'),
            testResults: document.getElementById('test-results'),
            
            // Editor
            editor: document.getElementById('rego-editor'),
            verifyBtn: document.getElementById('verify-btn'),
            editorPane: document.getElementById('editor-pane'),
            
            // Navigation buttons
            startAdventureBtn: document.getElementById('start-adventure'),
            restartBtn: document.getElementById('restart-btn'),
            homeBtn: document.getElementById('home-btn'),
            questBackBtn: document.getElementById('quest-back-btn'),
            questForwardBtn: document.getElementById('quest-forward-btn'),
            
            // Audio controls
            musicBtn: document.getElementById('music-btn'),
            effectsBtn: document.getElementById('effects-btn'),
            musicProgressRing: document.querySelector('.progress-ring__circle'),
            bgMusic: document.getElementById('bg-music'),
            
            // Modals
            restartModal: document.getElementById('restart-modal'),
            confirmRestartBtn: document.getElementById('confirm-restart-btn'),
            cancelRestartBtn: document.getElementById('cancel-restart-btn'),
            manualModal: document.getElementById('manual-modal'),
            closeManualBtn: document.getElementById('close-manual-btn'),
            manualContent: document.getElementById('manual-content'),
            checkManualBtn: document.getElementById('check-manual-btn'),
            testPayloadModal: document.getElementById('test-payload-modal'),
            closeTestPayloadBtn: document.getElementById('close-test-payload-btn'),
            testPayloadData: document.getElementById('test-payload-data'),
            checkTestPayloadBtn: document.getElementById('check-test-payload-btn'),
            resultModal: document.getElementById('result-modal'),
            resultIcon: document.getElementById('result-icon'),
            resultTitle: document.getElementById('result-title'),
            resultMessage: document.getElementById('result-message'),
            resultTestList: document.getElementById('result-test-list'),
            closeResultBtn: document.getElementById('close-result-btn'),
            nextQuestBtn: document.getElementById('next-quest-btn'),
            perfectScoreModal: document.getElementById('perfect-score-modal'),
            perfectScoreMessage: document.getElementById('perfect-score-message'),
            perfectScoreImage: document.getElementById('perfect-score-image'),
            closePerfectScoreBtn: document.getElementById('close-perfect-score-btn'),
            
            // Screens
            startScreen: document.getElementById('start-screen'),
            gameInterface: document.getElementById('game-interface'),
            questPackList: document.getElementById('quest-pack-list'),
            
            // Score
            experiencePoints: document.getElementById('experience-points'),
            scoreSummary: document.getElementById('score-summary'),
            pointsEarned: document.getElementById('points-earned'),
            pointsPossible: document.getElementById('points-possible'),
            
            // Auth
            loginBtn: document.getElementById('login-btn'),
            loginContainer: document.getElementById('login-container'),
            logoutBtn: document.getElementById('logout-btn')
        };
    }

    /**
     * Parse markdown text to sanitized HTML
     * @param {string} text - Markdown text to parse
     * @returns {string} Sanitized HTML
     */
    parseMarkdown(text) {
        if (!text) return '';
        const rawHtml = marked.parse(text);
        return DOMPurify.sanitize(rawHtml);
    }

    /**
     * Render quest lore with pagination support
     * @param {Object} quest - Quest object containing lore
     * @param {number} currentLoreIndex - Current lore page index
     */
    renderLore(quest, currentLoreIndex) {
        const lore = quest.description_lore;
        
        if (Array.isArray(lore)) {
            if (lore.length > 1) {
                this.elements.loreControls.classList.remove('hidden');
                this.elements.questLore.innerHTML = this.parseMarkdown(lore[currentLoreIndex]);
                this.elements.lorePageIndicator.textContent = `${currentLoreIndex + 1}/${lore.length}`;
                
                this.elements.lorePrevBtn.disabled = currentLoreIndex === 0;
                this.elements.loreNextBtn.disabled = currentLoreIndex === lore.length - 1;
            } else {
                this.elements.loreControls.classList.add('hidden');
                this.elements.questLore.innerHTML = this.parseMarkdown(lore[0]);
            }
        } else {
            this.elements.loreControls.classList.add('hidden');
            this.elements.questLore.innerHTML = this.parseMarkdown(lore);
        }
        
        // Trigger attention animation
        this.elements.questLore.classList.remove('attention');
        void this.elements.questLore.offsetWidth; // Force reflow
        this.elements.questLore.classList.add('attention');
    }

    /**
     * Render quest information
     * @param {Object} quest - Quest object
     * @param {number} totalQuests - Total number of quests
     */
    renderQuest(quest, totalQuests) {
        this.elements.questCounter.textContent = `Quest ${quest.id}/${totalQuests}`;
        this.elements.questTitle.textContent = quest.title;
        this.elements.questTask.textContent = quest.description_task;
    }

    /**
     * Render pack list on start screen
     * @param {Array} packs - Array of pack objects
     * @param {Function} onPackClick - Callback when pack is clicked
     */
    renderPackList(packs, onPackClick) {
        this.elements.questPackList.innerHTML = '';
        const sortedPacks = [...packs].sort((a, b) => a.title.localeCompare(b.title));
        const template = document.getElementById('quest-pack-card-template');
        
        sortedPacks.forEach(pack => {
            const card = template.content.cloneNode(true);
            const cardElement = card.querySelector('.quest-pack-card');
            
            cardElement.querySelector('.pack-title').textContent = pack.title;
            cardElement.querySelector('.pack-description').textContent = pack.description;
            
            if (pack.genre) {
                const genreBadge = cardElement.querySelector('.genre-badge');
                genreBadge.textContent = pack.genre;
                genreBadge.classList.remove('hidden');
            }
            
            // Accessibility
            cardElement.setAttribute('role', 'button');
            cardElement.setAttribute('tabindex', '0');
            cardElement.setAttribute('aria-label', `Start ${pack.title} adventure: ${pack.description}`);
            
            // Event handlers
            cardElement.addEventListener('click', () => onPackClick(pack.id));
            cardElement.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onPackClick(pack.id);
                }
            });
            
            this.elements.questPackList.appendChild(card);
        });
    }

    /**
     * Render manual content in modal
     * @param {Object} manual - Manual object with data_model, rego_snippet, external_link
     */
    renderManual(manual) {
        this.elements.manualContent.innerHTML = '';
        const template = document.getElementById('manual-template');
        const clone = template.content.cloneNode(true);
        
        if (!manual) {
            const noManualSection = clone.querySelector('[data-section="no-manual"]');
            this.elements.manualContent.appendChild(noManualSection);
            return;
        }
        
        if (manual.data_model) {
            const dataModelSection = clone.querySelector('[data-section="data-model"]');
            const content = dataModelSection.querySelector('.manual-section-content');
            content.innerHTML = this.parseMarkdown(manual.data_model);
            this.elements.manualContent.appendChild(dataModelSection);
        }
        
        if (manual.rego_snippet) {
            const regoSection = clone.querySelector('[data-section="rego-snippet"]');
            const content = regoSection.querySelector('.manual-section-content');
            content.innerHTML = this.parseMarkdown(manual.rego_snippet);
            this.elements.manualContent.appendChild(regoSection);
        }
        
        if (manual.external_link && manual.external_link.trim() !== '') {
            const linkSection = clone.querySelector('[data-section="external-link"]');
            const link = linkSection.querySelector('a');
            link.href = manual.external_link;
            this.elements.manualContent.appendChild(linkSection);
        }
    }

    /**
     * Render test payload data in modal
     * @param {Array} testPayloads - Array of test case objects
     */
    renderTestPayload(testPayloads) {
        this.elements.testPayloadData.innerHTML = '';
        const template = document.getElementById('test-case-template');
        
        testPayloads.forEach((test, index) => {
            const testCase = template.content.cloneNode(true);
            
            testCase.querySelector('.test-case-title').textContent = `Test Case ${index + 1}`;
            
            const expectedSpan = testCase.querySelector('.test-case-expected');
            const expectedValue = test.expected_outcome;
            expectedSpan.textContent = `Expected: ${expectedValue}`;
            expectedSpan.style.background = expectedValue ? 'rgba(76, 175, 80, 0.3)' : 'rgba(244, 67, 54, 0.3)';
            expectedSpan.style.color = expectedValue ? '#4caf50' : '#f44336';
            
            testCase.querySelector('.test-case-input-data').textContent =
                JSON.stringify(test.payload.input, null, 2);
            
            if (test.payload.data) {
                const dataSection = testCase.querySelector('.test-case-data');
                dataSection.classList.remove('hidden');
                testCase.querySelector('.test-case-data-content').textContent =
                    JSON.stringify(test.payload.data, null, 2);
            }
            
            this.elements.testPayloadData.appendChild(testCase);
        });
    }

    /**
     * Update score display
     * @param {number} totalScore - Total XP score
     */
    updateScoreDisplay(totalScore) {
        this.elements.experiencePoints.textContent = `${totalScore} XP`;
    }

    /**
     * Update hint button text based on current state
     * @param {Object} quest - Current quest object
     * @param {number} hintsShown - Number of hints already shown
     * @param {string} hintButtonText - Default hint button text
     */
    updateHintButtonText(quest, hintsShown, hintButtonText) {
        if (!quest || !quest.hints) {
            this.elements.hintBtn.textContent = hintButtonText || DEFAULT_TEXT.HINT_BUTTON;
            return;
        }
        
        const totalHints = quest.hints.length;
        
        if (hintsShown < totalHints) {
            this.elements.hintBtn.textContent = `${hintButtonText || DEFAULT_TEXT.HINT_BUTTON} (${hintsShown}/${totalHints} hints shown)`;
        } else if (quest.solution) {
            this.elements.hintBtn.textContent = 'Reveal Solution';
        } else {
            this.elements.hintBtn.textContent = hintButtonText || DEFAULT_TEXT.HINT_BUTTON;
        }
    }

    /**
     * Update quest footer visibility based on button states
     */
    updateQuestFooterVisibility() {
        const footer = document.querySelector('.quest-footer');
        if (!footer) return;
        
        const buttons = footer.querySelectorAll('button');
        const hasVisibleButton = Array.from(buttons).some(button => {
            const style = window.getComputedStyle(button);
            return style.display !== 'none';
        });
        
        footer.style.display = hasVisibleButton ? 'flex' : 'none';
    }

    /**
     * Show/hide screens
     * @param {string} screen - 'start' or 'game'
     */
    showScreen(screen) {
        if (screen === 'start') {
            this.elements.gameInterface.classList.add('hidden');
            this.elements.startScreen.classList.remove('hidden');
        } else if (screen === 'game') {
            this.elements.startScreen.classList.add('hidden');
            this.elements.gameInterface.classList.remove('hidden');
        }
    }

    /**
     * Reset UI for new quest
     */
    resetQuestUI() {
        this.elements.outcomeArea.classList.add('hidden');
        this.elements.startAdventureBtn.classList.add('hidden');
        this.elements.hintsList.classList.add('hidden');
        this.elements.hintsList.innerHTML = '';
        this.elements.hintBtn.style.display = 'inline-block';
        this.elements.editorPane.classList.remove('hidden');
        this.elements.editor.disabled = false;
        this.elements.verifyBtn.disabled = false;
        this.elements.hintBtn.disabled = false;
    }

    /**
     * Set editor to read-only mode (for history mode)
     * @param {boolean} readOnly - Whether to enable read-only mode
     */
    setEditorReadOnly(readOnly) {
        this.elements.editor.disabled = readOnly;
        this.elements.verifyBtn.disabled = readOnly;
        this.elements.hintBtn.disabled = readOnly;
    }

    /**
     * Update page titles
     * @param {string} title - Adventure title
     */
    updateTitles(title) {
        document.getElementById('page-title').textContent = title;
        document.getElementById('main-title').textContent = title;
        document.getElementById('game-title').textContent = title;
    }

    /**
     * Update grimoire title
     * @param {string} title - Grimoire title
     */
    updateGrimoireTitle(title) {
        const grimoireTitle = document.getElementById('grimoire-title');
        if (grimoireTitle) {
            grimoireTitle.textContent = title;
        }
    }

    /**
     * Initialize effects state from localStorage
     */
    initEffectsState() {
        const effectsEnabled = getLocalStorage(STORAGE_KEYS.EFFECTS_ENABLED, 'false') === 'true';
        
        if (effectsEnabled) {
            document.body.classList.remove('effects-disabled');
        } else {
            document.body.classList.add('effects-disabled');
        }
        
        this.updateEffectsButton(effectsEnabled);
    }

    /**
     * Update effects button appearance
     * @param {boolean} effectsEnabled - Whether effects are enabled
     */
    updateEffectsButton(effectsEnabled) {
        if (!this.elements.effectsBtn) return;
        
        const icon = this.elements.effectsBtn.querySelector('i');
        
        if (effectsEnabled) {
            icon.className = 'fa-solid fa-wand-magic-sparkles';
            this.elements.effectsBtn.setAttribute('aria-label', 'Disable visual effects');
            this.elements.effectsBtn.setAttribute('aria-pressed', 'true');
            this.elements.effectsBtn.classList.add('effects-active');
        } else {
            icon.className = 'fa-solid fa-wand-magic';
            this.elements.effectsBtn.setAttribute('aria-label', 'Enable visual effects');
            this.elements.effectsBtn.setAttribute('aria-pressed', 'false');
            this.elements.effectsBtn.classList.remove('effects-active');
        }
    }

    /**
     * Toggle visual effects
     */
    toggleEffects() {
        const currentlyEnabled = getLocalStorage(STORAGE_KEYS.EFFECTS_ENABLED, 'false') === 'true';
        const newState = !currentlyEnabled;
        
        setLocalStorage(STORAGE_KEYS.EFFECTS_ENABLED, newState.toString());
        
        if (newState) {
            document.body.classList.remove('effects-disabled');
        } else {
            document.body.classList.add('effects-disabled');
        }
        
        this.updateEffectsButton(newState);
    }

    /**
     * Update UI based on authentication state
     * @param {boolean} isAuthenticated - Whether the user is authenticated
     * @param {boolean} authEnabled - Whether authentication is enabled in config
     */
    updateAuthUI(isAuthenticated, authEnabled) {
        if (!authEnabled) {
            this.elements.loginContainer.style.display = 'none';
            this.elements.logoutBtn.style.display = 'none';
            return;
        }

        if (isAuthenticated) {
            this.elements.logoutBtn.style.display = 'inline-block';
            this.elements.loginContainer.style.display = 'none';
            this.elements.questPackList.style.display = 'block';
        } else {
            this.elements.loginContainer.classList.remove('hidden');
            this.elements.loginContainer.style.display = 'block';
            this.elements.questPackList.style.display = 'none';
            this.elements.logoutBtn.style.display = 'none';
        }
    }

    /**
     * Update impressum footer visibility
     * @param {boolean} show - Whether to show the impressum footer
     */
    updateImpressumVisibility(show) {
        const impressumFooter = document.querySelector('.start-footer');
        if (impressumFooter && !show) {
            impressumFooter.style.display = 'none';
        }
    }
}