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
 * Grimoire Autosave
 * Owns the editor's pending write: the debounce timer, the write itself and
 * the indicator that reports its outcome.
 */

import { SaveStatus, TIMING } from '../services/constants.js';

/**
 * The save state of the policy editor. The debounce keeps storage writes off
 * every keystroke, and the indicator is rendered from the outcome of a real
 * write, so its colour cannot claim a save that storage refused or never made.
 */
export class GrimoireAutosave {
    constructor(state, uiManager) {
        this.state = state;
        this.ui = uiManager;
        // Pending debounced write (0 when none is armed)
        this.timeout = 0;
    }

    /**
     * The player typed: report the pending write and re-arm the debounce.
     */
    markDirty() {
        clearTimeout(this.timeout);
        this.ui.renderSaveStatus(SaveStatus.DIRTY);

        this.timeout = setTimeout(() => {
            this.flush();
        }, TIMING.GRIMOIRE_AUTOSAVE_DELAY);
    }

    /**
     * Write now - blur, navigation, verify, page hide, Ctrl/Cmd+S - and report
     * what the write did.
     * @returns {boolean} true when storage accepted the content
     */
    flush() {
        clearTimeout(this.timeout);

        const outcome = this.state.saveGrimoire(
            this.state.currentQuestId, this.ui.elements.editor.value
        );
        this.ui.renderSaveStatus(outcome);

        return outcome === SaveStatus.SAVED;
    }

    /**
     * Drop a pending write. A screen that replaces the editor content owes
     * storage nothing of what was there before, and an armed timer would write
     * the new content under the wrong quest.
     */
    cancel() {
        clearTimeout(this.timeout);
        this.timeout = 0;
    }
}
