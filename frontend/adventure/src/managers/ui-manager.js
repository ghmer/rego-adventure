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

import { getLocalStorage, setLocalStorage, STORAGE_KEYS } from '../services/storage-service.js';
import { nextReveal } from '../services/reveal-service.js';
import { DEFAULT_TEXT, SaveStatus } from '../services/constants.js';
import { show, hide, setHidden, isHidden } from '../services/visibility.js';
import { parseMarkdown } from '../services/markdown.js';
import { initializeUiElements } from './ui-elements.js';
import * as uiRender from './ui-render.js';

/**
 * Manages all DOM elements and UI rendering
 */
export class UIManager {
    /**
     * @param {EditorService} editorService - Editor service owning the Yace
     *   instance. Required: the editor element is always the service's native
     *   textarea, which is what the typing gates and value reads act on.
     */
    constructor(editorService) {
        this.editorService = editorService;
        this.elements = initializeUiElements(editorService.textarea);
        // Interface minimize state, rendered by renderInterfaceMinimized
        this.interfaceMinimized = false;
    }
    /**
     * Render pack list on start screen
     * @param {Array} packs - Array of pack objects
     * @param {Function} onPackClick - Callback when pack is clicked
     */
    renderPackList(packs, onPackClick) {
        uiRender.renderPackList(this.elements, packs, onPackClick);
    }

    /**
     * Render manual content in modal
     * @param {Object} manual - Manual object with data_model, rego_snippet, external_link
     */
    renderManual(manual) {
        uiRender.renderManual(this.elements, manual);
    }

    /**
     * Render test payload data in modal
     * @param {Array} testPayloads - Array of test case objects
     */
    renderTestPayload(testPayloads) {
        uiRender.renderTestPayload(this.elements, testPayloads);
    }

    /**
     * Render support modules in the modal
     * @param {Array<string>} modules - Rego module sources
     */
    renderSupportModules(modules) {
        uiRender.renderSupportModules(this.elements, modules);
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
                show(this.elements.loreControls);
                this.elements.questLore.innerHTML = parseMarkdown(lore[currentLoreIndex]);
                this.elements.lorePageIndicator.textContent = `${currentLoreIndex + 1}/${lore.length}`;
                
                this.elements.lorePrevBtn.disabled = currentLoreIndex === 0;
                this.elements.loreNextBtn.disabled = currentLoreIndex === lore.length - 1;
            } else {
                hide(this.elements.loreControls);
                this.elements.questLore.innerHTML = parseMarkdown(lore[0]);
            }
        } else {
            hide(this.elements.loreControls);
            this.elements.questLore.innerHTML = parseMarkdown(lore);
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
        this.updateSupportModulesButton(quest);
    }

    /**
     * Enable the support modules button only when the current quest
     * ships support modules. The button itself stays visible at all
     * times so the toolbar layout never jumps between quests.
     * @param {Object|null} quest - Quest object (has_support_modules derived
     * by the backend)
     */
    updateSupportModulesButton(quest) {
        const button = this.elements.checkSupportModulesBtn;
        if (!button) return;

        const hasModules = quest?.has_support_modules === true;
        button.disabled = !hasModules;
        button.title = hasModules
            ? 'View the support modules attached to this quest'
            : 'No support modules for this quest';
        button.setAttribute('aria-disabled', String(!hasModules));
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
     * @param {Object} quest - Current quest object (hints_count and
     * has_solution derived by the backend)
     * @param {number} hintsShown - Number of hints already shown
     * @param {string} hintButtonText - Default hint button text
     */
    updateHintButtonText(quest, hintsShown, hintButtonText) {
        // The label is a rendering of the shared reveal progression
        // (reveal-service), never a second copy of its logic.
        const reveal = nextReveal(quest, hintsShown, false);

        if (reveal?.kind === 'hint') {
            this.elements.hintBtn.textContent = `${hintButtonText || DEFAULT_TEXT.HINT_BUTTON} (${hintsShown}/${quest.hints_count ?? 0} hints shown)`;
        } else if (reveal?.kind === 'solution') {
            this.elements.hintBtn.textContent = 'Reveal Solution';
        } else {
            this.elements.hintBtn.textContent = hintButtonText || DEFAULT_TEXT.HINT_BUTTON;
        }
    }

    /**
     * Recompute the quest footer. It is shown exactly while one of the two
     * buttons it holds is offered, so this reads their visibility instead of
     * deciding it: the prologue offers the adventure button
     * (renderQuestButtonVisibility) and the epilogue of a pack finished
     * without reveals offers the perfect-score button
     * (renderPerfectScoreButton). The quest render pipeline calls it after
     * every screen; nothing else writes the footer's own visibility.
     */
    renderQuestFooter() {
        const footer = this.elements.questFooter;
        if (!footer) return;

        const buttons = footer.querySelectorAll('button');
        const hasVisibleButton = Array.from(buttons).some(button =>
            !isHidden(button)
        );

        setHidden(footer, !hasVisibleButton);
    }

    /**
     * Render the adventure offer of the prologue screen. This is the only
     * writer of the button's visibility: the prologue offers it and every
     * other screen withdraws it.
     * @param {boolean} visible - Whether this screen offers the adventure
     * @param {string} [label] - Button text, applied when visible
     */
    renderQuestButtonVisibility(visible, label) {
        const startAdventureBtn = this.elements.startAdventureBtn;
        if (!startAdventureBtn) return;

        if (visible && label !== undefined) {
            startAdventureBtn.textContent = label;
        }
        setHidden(startAdventureBtn, !visible);
    }

    /**
     * Render the perfect-score button. This is the only writer of its
     * visibility: a screen offers it when the pack is finished with a perfect
     * score, every other screen renders it hidden.
     * @param {boolean} visible - Whether the screen on offer is this one
     * @param {string} [label] - Button text, applied when visible
     */
    renderPerfectScoreButton(visible, label) {
        const perfectScoreBtn = this.elements.perfectScoreBtn;
        if (!perfectScoreBtn) return;

        if (visible && label !== undefined) {
            perfectScoreBtn.textContent = label;
        }
        setHidden(perfectScoreBtn, !visible);
    }

    /**
     * Render the interface minimize state. The layout class, the button icon
     * and its pressed state are one state written together, and a visit change
     * returns it to normal (resetInterfaceMinimized).
     * @param {boolean} minimized - Whether the interface is minimized
     */
    renderInterfaceMinimized(minimized) {
        this.interfaceMinimized = minimized;

        const button = this.elements.minimizeBtn;
        if (!this.elements.gameInterface || !button) return;

        this.elements.gameInterface.classList.toggle('minimized', minimized);

        const icon = button.querySelector('i');
        if (minimized) {
            icon?.classList.replace('fa-minus', 'fa-expand');
            button.setAttribute('aria-label', 'Restore interface');
            button.setAttribute('aria-pressed', 'true');
            button.title = 'Restore the interface';
        } else {
            icon?.classList.replace('fa-expand', 'fa-minus');
            button.setAttribute('aria-label', 'Minimize interface');
            button.setAttribute('aria-pressed', 'false');
            button.title = 'Minimize the interface to reveal the background';
        }
    }

    /**
     * Minimize the interface, or return it to normal.
     */
    toggleInterfaceMinimized() {
        this.renderInterfaceMinimized(!this.interfaceMinimized);
    }

    /**
     * Return the interface to normal. Entering a pack, leaving it and
     * restarting its progress all start a view that is not minimized.
     */
    resetInterfaceMinimized() {
        if (!this.interfaceMinimized) return;

        this.renderInterfaceMinimized(false);
    }

    /**
     * Show/hide screens
     * @param {string} screen - 'start' or 'game'
     */
    showScreen(screen) {
        if (screen === 'start') {
            hide(this.elements.gameInterface);
            show(this.elements.startScreen);
        } else if (screen === 'game') {
            hide(this.elements.startScreen);
            show(this.elements.gameInterface);
        }
    }

    /**
     * Render the editor save indicator. This is the only writer of its state
     * class, and the class it paints describes a real write: SAVED reached
     * storage, DIRTY has a write pending, FAILED was refused by storage, and
     * IDLE means this screen has no grimoire to write.
     * @param {string} status - A SaveStatus value
     */
    renderSaveStatus(status) {
        const indicator = this.elements.saveIndicator;
        if (!indicator) return;

        const classes = {
            saved: 'saved',
            dirty: 'dirty',
            failed: 'error',
            idle: 'idle'
        };
        const messages = {
            saved: 'All changes saved',
            dirty: 'Unsaved changes',
            failed: 'Saving failed',
            idle: 'No policy to save here'
        };

        const state = classes[status] ? status : SaveStatus.IDLE;

        for (const cssClass of Object.values(classes)) {
            indicator.classList.remove(cssClass);
        }
        indicator.classList.add(classes[state]);

        const label = `Editor save status: ${messages[state]}`;
        indicator.title = label;
        indicator.setAttribute('aria-label', label);
    }

    /**
     * Reset UI for new quest
     */
    resetQuestUI() {
        hide(this.elements.hintsList);
        this.elements.hintsList.innerHTML = '';
        show(this.elements.hintBtn);
    }

    /**
     * Render the interaction gate. This is the only place the editor, the
     * verify button, the hint button and the editor pane are enabled or
     * disabled; the values come from GameState.getInteractionGate.
     * @param {Object} gate - {editorReadOnly, verifyEnabled, hintEnabled, editorVisible}
     */
    renderInteractionGate(gate) {
        this.elements.editor.readOnly = gate.editorReadOnly;
        this.elements.verifyBtn.disabled = !gate.verifyEnabled;
        this.elements.hintBtn.disabled = !gate.hintEnabled;
        setHidden(this.elements.editorPane, !gate.editorVisible);
    }

    /**
     * Replace the editor content. Programmatic writes must go through the
     * editor service so Yace re-renders the highlighted layer; assigning
     * textarea.value directly would leave the highlight layer stale.
     * @param {string} value - New editor content
     */
    setEditorValue(value) {
        this.editorService.setValue(value);
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
        this.applyEffectsState(this.isEffectsEnabled());
    }

    /**
     * Whether visual effects are enabled
     * @returns {boolean} True if effects are enabled
     */
    isEffectsEnabled() {
        return getLocalStorage(STORAGE_KEYS.EFFECTS_ENABLED, 'false') === 'true';
    }

    /**
     * Apply the effects state to the document and the toggle button
     * @param {boolean} effectsEnabled - Whether effects are enabled
     */
    applyEffectsState(effectsEnabled) {
        document.body.classList.toggle('effects-disabled', !effectsEnabled);
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
        const newState = !this.isEffectsEnabled();

        setLocalStorage(STORAGE_KEYS.EFFECTS_ENABLED, newState.toString());
        this.applyEffectsState(newState);
    }

    /**
     * Update UI based on authentication state
     * @param {boolean} isAuthenticated - Whether the user is authenticated
     * @param {boolean} authEnabled - Whether authentication is enabled in config
     */
    updateAuthUI(isAuthenticated, authEnabled) {
        const el = this.elements;
        if (!authEnabled) {
            hide(el.loginContainer);
            hide(el.logoutBtn);
            hide(el.logoutContainerStart);
            return;
        }

        setHidden(el.loginContainer, isAuthenticated);
        setHidden(el.questPackList, !isAuthenticated);
        setHidden(el.logoutBtn, !isAuthenticated);
        setHidden(el.logoutContainerStart, !isAuthenticated);
    }

    /**
     * Update impressum footer visibility
     * @param {boolean} visible - Whether to show the impressum footer
     */
    updateImpressumVisibility(visible) {
        setHidden(document.querySelector('.start-footer'), !visible);
    }
}