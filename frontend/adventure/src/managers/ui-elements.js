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

// The element registry: every DOM hook the UI manager drives, declared by
// its selector once. Resolving with querySelector keeps the table uniform
// (getElementById entries and the few class/descendant selectors read the
// same way).

/**
 * Selector for every element the UI manager references, by registry key.
 */
export const uiElementSelectors = {
    // Quest elements
    questCounter: '#quest-counter',
    questTitle: '#quest-title',
    questLore: '#quest-lore',
    loreControls: '#lore-controls',
    lorePrevBtn: '#lore-prev-btn',
    loreNextBtn: '#lore-next-btn',
    lorePageIndicator: '#lore-page-indicator',
    questTask: '#quest-task',

    // Hints
    hintsList: '#hints-list',
    hintBtn: '#hint-btn',

    // Editor pane and its controls; the editor textarea itself is the
    // editor service's native textarea, so listeners, value reads and
    // read-only toggling work on it like on any plain textarea
    verifyBtn: '#verify-btn',
    verifyBtnLabel: '#verify-btn [data-label]',
    editorPane: '#editor-pane',
    saveIndicator: '#editor-save-indicator',

    // Navigation buttons
    startAdventureBtn: '#start-adventure',
    questFooter: '.quest-footer',
    restartBtn: '#restart-btn',
    minimizeBtn: '#minimize-btn',
    homeBtn: '#home-btn',
    questBackBtn: '#quest-back-btn',
    questForwardBtn: '#quest-forward-btn',

    // Audio controls
    musicBtn: '#music-btn',
    effectsBtn: '#effects-btn',
    musicProgressRing: '.progress-ring__circle',
    bgMusic: '#bg-music',

    // Modals
    restartModal: '#restart-modal',
    confirmRestartBtn: '#confirm-restart-btn',
    cancelRestartBtn: '#cancel-restart-btn',
    hintModal: '#hint-modal',
    hintConfirmText: '#hint-confirm-text',
    confirmHintBtn: '#confirm-hint-btn',
    cancelHintBtn: '#cancel-hint-btn',
    manualModal: '#manual-modal',
    closeManualBtn: '#close-manual-btn',
    manualContent: '#manual-content',
    checkManualBtn: '#check-manual-btn',
    testPayloadModal: '#test-payload-modal',
    closeTestPayloadBtn: '#close-test-payload-btn',
    testPayloadData: '#test-payload-data',
    checkTestPayloadBtn: '#check-test-payload-btn',
    supportModulesModal: '#support-modules-modal',
    closeSupportModulesBtn: '#close-support-modules-btn',
    supportModulesContent: '#support-modules-content',
    checkSupportModulesBtn: '#check-support-modules-btn',
    resultModal: '#result-modal',
    resultIcon: '#result-icon',
    resultTitle: '#result-title',
    resultMessage: '#result-message',
    resultTestList: '#result-test-list',
    closeResultBtn: '#close-result-btn',
    nextQuestBtn: '#next-quest-btn',
    perfectScoreModal: '#perfect-score-modal',
    perfectScoreMessage: '#perfect-score-message',
    perfectScoreImage: '#perfect-score-image',
    closePerfectScoreBtn: '#close-perfect-score-btn',
    perfectScoreBtn: '#perfect-score-btn',

    // Screens
    startScreen: '#start-screen',
    gameInterface: '#game-interface',
    questPackList: '#quest-pack-list',

    // Score
    experiencePoints: '#experience-points',
    scoreSummary: '#score-summary',
    pointsEarned: '#points-earned',
    pointsPossible: '#points-possible',

    // Auth
    loginBtn: '#login-btn',
    loginContainer: '#login-container',
    logoutBtn: '#logout-btn',
    logoutBtnStart: '#logout-btn-start',
    logoutContainerStart: '#logout-container-start'
};

/**
 * Resolve the registry into live element references.
 * @param {HTMLTextAreaElement} editorTextarea - The editor service's native
 *   textarea, the editor entry of the registry
 * @returns {Object} Element references by registry key
 */
export function initializeUiElements(editorTextarea) {
    const elements = {};
    for (const [key, selector] of Object.entries(uiElementSelectors)) {
        elements[key] = document.querySelector(selector);
    }
    elements.editor = editorTextarea;
    return elements;
}
