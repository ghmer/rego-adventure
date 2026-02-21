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

package assetgen

// Template constants for generated files

const themeCSSTemplate = `/* ============================================
   THEME.CSS - Theme-Specific Variables and Overrides
   ============================================
   
   This file contains theme-specific CSS variables and minimal overrides.
   The shared CSS files (base.css, layout.css, components.css, animations.css)
   are loaded from frontend/shared/css/ and provide the core styling.
   
   Customize this file to match your theme's visual identity.
   ============================================ */

:root {
    /* Core Colors - Warm, sophisticated palette with excellent contrast */
    --bg-color: #f8f6f3;
    --surface-light: #fffef9;
    --surface-dark: #e8e4dc;
    --text-color: #2c2416;
    --accent-color: #d97706;
    --secondary-accent: #b45309;
    --button-color: #ea580c;
    --success-color: #16a34a;
    --error-color: #dc2626;
    --info-color: #0891b2;
    --white: #ffffff;
    
    /* RGB for rgba() usage */
    --accent-rgb: 217, 119, 6;
    --success-rgb: 22, 163, 74;
    --error-rgb: 220, 38, 38;
    --text-rgb: 44, 36, 22;
    --surface-light-rgb: 255, 254, 249;
    --surface-dark-rgb: 232, 228, 220;
    
    /* Typography - System font stacks */
    --font-heading: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    --font-body: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    --font-code: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
}

/* Theme-specific background */
body {
    background-image: url('assets/bg-adventure.jpg');
    background-size: cover;
    background-attachment: fixed;
}

/* surface Background */
.surface-bg {
    box-shadow: 0 0 20px rgba(var(--accent-rgb), 0.1);
}

/* Header */
.game-header {
    background-color: rgba(var(--surface-light-rgb), 0.9);
    box-shadow: 0 0 15px rgba(var(--accent-rgb), 0.15);
    backdrop-filter: blur(5px);
    border-radius: 0;
}

/* Firefox < 103 fallback for backdrop-filter */
@supports not (backdrop-filter: blur(5px)) {
    .game-header {
        background-color: rgba(var(--surface-light-rgb), 0.98);
    }
}

.game-header h1 {
    text-shadow: 0 0 5px rgba(var(--accent-rgb), 0.5);
    text-transform: uppercase;
    letter-spacing: 2px;
}

/* Header Buttons - Circular Icon Style */
#restart-btn,
#home-btn,
#logout-btn {
    padding: 0;
    border: none;
    background: transparent;
    box-shadow: none !important;
}

#restart-btn:hover,
#home-btn:hover,
#logout-btn:hover {
    background-color: transparent;
    transform: scale(1.1);
}

#restart-btn i,
#home-btn i,
#logout-btn i {
    width: 40px;
    height: 40px;
    line-height: 36px;
    text-align: center;
    font-size: 1.2rem;
    border-radius: 50%;
    border: 2px solid var(--accent-color);
    color: var(--accent-color);
    display: block;
}

#music-btn {
    padding: 0;
    border: none;
    background: transparent;
    box-shadow: none !important;
    cursor: pointer;
    position: relative;
    display: flex;
    justify-content: center;
    align-items: center;
    width: 44px;
    height: 44px;
}

#music-btn.music-playing {
    animation: mute-pulse 2s ease-in-out infinite;
}

#music-btn:hover {
    background-color: transparent;
    transform: scale(1.1);
}

#music-btn i {
    width: 40px;
    height: 40px;
    line-height: 36px;
    text-align: center;
    font-size: 1.2rem;
    border-radius: 50%;
    border: 2px solid var(--accent-color);
    color: var(--accent-color);
    display: block;
    z-index: 1;
}

/* Effects Button */
#effects-btn {
    padding: 0;
    border: none;
    background: transparent;
    box-shadow: none !important;
    cursor: pointer;
    position: relative;
    display: flex;
    justify-content: center;
    align-items: center;
    width: 44px;
    height: 44px;
}

#effects-btn:hover {
    background-color: transparent;
    transform: scale(1.1);
}

#effects-btn i {
    width: 40px;
    height: 40px;
    line-height: 36px;
    text-align: center;
    font-size: 1.2rem;
    border-radius: 50%;
    border: 2px solid var(--accent-color);
    color: var(--accent-color);
    display: block;
    transition: all 0.3s ease;
}

/* Effects Active State */
#effects-btn.effects-active i {
    background-color: var(--accent-color);
    color: var(--white);
    box-shadow: 0 0 15px var(--accent-color);
    border-radius: 50% !important;
}

#effects-btn:hover i {
    box-shadow: 0 0 10px var(--accent-color);
}

/* Pane Header */
.pane-header h2 {
    text-transform: uppercase;
    letter-spacing: 1px;
    font-size: 1.2rem;
}

/* Quest Title and Policy Grimoire Headings */
#quest-title,
#grimoire-title {
    color: var(--accent-color);
    text-shadow: 0 0 8px rgba(var(--accent-rgb), 0.6);
    font-family: var(--font-heading);
}

/* Avatar */
.avatar {
    box-shadow: 0 0 12px rgba(var(--accent-rgb), 0.7);
}

.npc-avatar {
    box-shadow: 0 0 14px rgba(var(--accent-rgb), 0.6);
}

/* Lore Container */
.lore-container {
    position: relative;
    margin-top: 1rem;
}

.lore-container::before {
    content: "LORE";
    position: absolute;
    top: -1px;
    left: 10px;
    background: var(--bg-color);
    padding: 0 5px;
    color: var(--accent-color);
    font-size: 0.8rem;
    font-family: var(--font-heading);
    transform: translateY(-50%);
}

/* Lore Text */
.lore-text {
    font-style: normal;
    height: 200px;
    border: 1px solid rgba(var(--accent-rgb), 0.3);
    background-color: rgba(var(--text-rgb), 0.05);
}

.lore-controls {
    border-top: 1px dashed rgba(var(--accent-rgb), 0.3);
}

/* Task Box */
.task-box {
    background-color: rgba(var(--accent-rgb), 0.05);
    border: 1px solid var(--accent-color);
    border-radius: 0;
    position: relative;
    margin-top: 1rem;
}

.task-box::before {
    content: "OBJECTIVE";
    position: absolute;
    top: -1px;
    left: 10px;
    background: var(--bg-color);
    padding: 0 5px;
    color: var(--accent-color);
    font-size: 0.8rem;
    font-family: var(--font-heading);
    transform: translateY(-50%);
}

.task-box h3 {
    display: none;
}

/* Hints */
#hints-list li {
    background-color: rgba(var(--accent-rgb), 0.1);
    border-left: 2px solid var(--accent-color);
    border-radius: 0;
}

/* Outcome Area */
.outcome-area {
    border: 1px solid var(--accent-color);
    background-color: rgba(var(--text-rgb), 0.05);
}

.outcome-area.success {
    box-shadow: 0 0 12px rgba(var(--success-rgb), 0.35);
}

.outcome-area.failure {
    box-shadow: 0 0 12px rgba(var(--error-rgb), 0.35);
}

/* Test Results */
.test-result {
    font-family: var(--font-code);
}

/* Editor */
#rego-editor {
    background-color: var(--surface-light);
    color: var(--text-color);
    border-radius: 0;
    box-shadow: inset 0 0 25px rgba(var(--accent-rgb), 0.1);
}

#rego-editor:focus {
    outline: 1px solid var(--accent-color);
    box-shadow: 0 0 15px rgba(var(--accent-rgb), 0.3);
}

/* Buttons */
.action-btn {
    background-color: rgba(var(--accent-rgb), 0.1);
    border: 1px solid var(--accent-color);
    border-radius: 0;
    letter-spacing: 2px;
    color: var(--accent-color);
}

.action-btn:hover {
    background-color: var(--accent-color);
    color: var(--white);
    box-shadow: 0 0 15px var(--accent-color);
}

.action-btn.primary {
    background-color: var(--accent-color);
    color: var(--white);
    box-shadow: 0 0 10px var(--accent-color);
    border: none;
}

.action-btn.primary:hover {
    background-color: var(--secondary-accent);
    box-shadow: 0 0 20px var(--accent-color);
}

.action-btn.success {
    background-color: var(--success-color);
    color: var(--white);
    border: none;
    box-shadow: 0 0 10px var(--success-color);
}

.action-btn.danger {
    background-color: transparent;
    color: var(--error-color);
    border-color: var(--error-color);
}

.action-btn.danger:hover {
    background-color: var(--error-color);
    color: var(--white);
}

/* App Container */
.app-container {
    max-width: 1600px;
    z-index: 3;
}

/* Modal */
.modal {
    background-color: rgba(var(--text-rgb), 0.9);
    backdrop-filter: blur(5px);
}

/* Firefox < 103 fallback for backdrop-filter */
@supports not (backdrop-filter: blur(5px)) {
    .modal {
        background-color: rgba(var(--text-rgb), 0.98);
    }
}

.modal-content {
    background-color: var(--surface-dark);
    box-shadow: 0 0 30px rgba(var(--accent-rgb), 0.2);
}

.modal-content h2 {
    text-transform: uppercase;
    letter-spacing: 2px;
}

.close-btn:hover {
    text-shadow: 0 0 10px var(--error-color);
}

/* Manual Content */
.manual-content {
    background: rgba(var(--text-rgb), 0.05);
}

.manual-content code {
    background-color: rgba(var(--accent-rgb), 0.1);
    color: var(--secondary-accent);
}

.manual-content pre {
    background-color: rgba(var(--text-rgb), 0.05);
    border: 1px solid rgba(var(--accent-rgb), 0.2);
}

/* Global Scrollbar Styling */
* {
    scrollbar-width: thin;
    scrollbar-color: var(--accent-color) var(--surface-dark);
}

::-webkit-scrollbar {
    width: 8px;
}

::-webkit-scrollbar-track {
    background: var(--surface-dark);
    border-radius: 4px;
}

::-webkit-scrollbar-thumb {
    background: var(--accent-color);
    border-radius: 4px;
}

::-webkit-scrollbar-thumb:hover {
    background: var(--secondary-accent);
    opacity: 0.8;
}

/* Result Test List */
.result-test-list {
    background: rgba(var(--text-rgb), 0.05);
}

.result-test-list li {
    border-bottom: 1px dashed rgba(var(--accent-rgb), 0.3);
}

/* Score Summary */
.score-summary {
    background: rgba(var(--success-rgb), 0.1);
    border-radius: 0;
}

.score-value {
    text-shadow: 0 0 10px rgba(var(--success-rgb), 0.5);
}

.score-possible .score-value {
    text-shadow: 0 0 10px rgba(var(--accent-rgb), 0.5);
}

/* Experience Badge */
.experience-badge {
    background: linear-gradient(135deg, var(--success-color), var(--secondary-accent));
    color: var(--white);
}

/* Perfect Score */
.perfect-score-image {
    box-shadow: 0 8px 16px rgba(var(--text-rgb), 0.3);
    border-radius: 0;
}

.perfect-score-message {
    background: rgba(var(--accent-rgb), 0.05);
    border: 2px solid var(--accent-color);
    border-radius: 0;
}

.perfect-score-btn {
    border: none;
    box-shadow: 0 0 10px var(--success-color);
}

.perfect-score-btn:hover {
    background-color: var(--accent-color);
    box-shadow: 0 0 15px var(--accent-color);
}

/* Tutorial Prompt */
.tutorial-prompt-modal {
    background-color: rgba(var(--text-rgb), 0.95);
}

.tutorial-prompt-content {
    background-color: var(--surface-dark);
    border: 1px solid var(--accent-color);
    border-radius: 0;
    box-shadow: 0 0 30px rgba(var(--accent-rgb), 0.4);
}

.tutorial-prompt-content h2 {
    text-transform: uppercase;
    letter-spacing: 2px;
}

/* Tutorial Overlay */
.tutorial-overlay {
    background-color: rgba(var(--text-rgb), 0.9);
}

/* Tutorial Spotlight */
.tutorial-spotlight {
    border-radius: 0;
    box-shadow: 0 0 40px rgba(var(--accent-rgb), 0.8),
                inset 0 0 30px rgba(var(--accent-rgb), 0.3);
}

/* Tutorial Tooltip */
.tutorial-tooltip {
    background-color: var(--surface-dark);
    border-radius: 0;
    box-shadow: 0 10px 40px rgba(var(--text-rgb), 0.9),
                0 0 30px rgba(var(--accent-rgb), 0.5);
}

.tutorial-tooltip-title {
    text-transform: uppercase;
    letter-spacing: 1px;
}

.tutorial-close-btn:hover {
    text-shadow: 0 0 10px var(--error-color);
}

.tutorial-progress {
    background: rgba(var(--accent-rgb), 0.1);
    border: 1px solid rgba(var(--accent-rgb), 0.3);
    border-radius: 0;
}

/* Test Case Cards */
.test-case-card {
    background: rgba(var(--text-rgb), 0.05);
    border-radius: 0;
}

.test-case-expected {
    background: rgba(var(--accent-rgb), 0.2);
    border-radius: 0;
}

.test-case-label code {
    background: rgba(var(--accent-rgb), 0.1);
    border-radius: 0;
}

.test-case-input-data,
.test-case-data-content {
    background: rgba(var(--text-rgb), 0.05);
    border-radius: 0;
}

/* Test Payload */
.test-result .test-payload pre {
    background: rgba(var(--text-rgb), 0.05);
}

/* Check Manual Button */
#check-manual-btn,
#check-test-payload-btn {
    border-radius: 0;
}

/* Animations Override */
@keyframes spotlightPulse {
    0%, 100% {
        box-shadow: 0 0 40px rgba(var(--accent-rgb), 0.8),
                    inset 0 0 30px rgba(var(--accent-rgb), 0.3);
    }
    50% {
        box-shadow: 0 0 60px rgba(var(--accent-rgb), 1),
                    inset 0 0 50px rgba(var(--accent-rgb), 0.5);
    }
}

/* Mobile Overrides */
@media (max-width: 768px) {
    .lore-text {
        height: 150px;
    }
}
`

const customCSSTemplate = `/* 
   ============================================
   CUSTOM.CSS - Theme-Specific Custom Effects
   ============================================
   
   Add theme-specific visual effects here:
   - Scanlines, rain effects, textures
   - Unique decorations and overlays
   - Special animations
   - Theme-specific pseudo-elements
      
   This file is intentionally minimal - add effects as needed
   for your specific theme.
   ============================================ 
*/

/* Example: Scanline effect (commented out by default)
body::before {
    content: " ";
    display: block;
    position: absolute;
    top: 0;
    left: 0;
    bottom: 0;
    right: 0;
    background: linear-gradient(
        rgba(var(--text-rgb), 0) 50%,
        rgba(var(--text-rgb), 0.25) 50%
    ),
    linear-gradient(
        90deg,
        rgba(var(--accent-rgb), 0.06),
        rgba(255, 0, 0, 0.02),
        rgba(0, 255, 0, 0.06)
    );
    z-index: 2;
    background-size: 100% 2px, 3px 100%;
    pointer-events: none;
}
*/

/* Disable button glow pulse when effects are disabled
body.effects-disabled .action-btn,
body.effects-disabled {
    animation: none;
}
*/

/* Respect reduced motion preference
@media (prefers-reduced-motion: reduce) {
    .action-btn {
        animation: none;
    }
}
*/

/* Example: Advanced effect with @supports query
@supports (backdrop-filter: blur(10px)) {
    .glass-effect {
        backdrop-filter: blur(10px);
        background-color: rgba(var(--surface-light-rgb), 0.1);
    }
}

Fallback for browsers without backdrop-filter support
@supports not (backdrop-filter: blur(10px)) {
    .glass-effect {
        background-color: rgba(var(--surface-light-rgb), 0.9);
    }
}
*/
`

const readmeTemplate = `# %s Quest Pack

This is a custom quest pack for the Rego Adventure game.

## Files Overview

- **quests.json** - Contains all quest definitions, lore, tasks, hints, and test cases
- **theme.css** - Theme-specific CSS variables and minimal overrides
- **custom.css** - Theme-specific visual effects (scanlines, rain, etc.)
- **bg-music.m4a** - Background music (currently a placeholder - replace with your audio)
- **assets/** - Directory containing all visual assets

## CSS Architecture

This theme uses a modular CSS structure:

### Shared CSS (loaded automatically from frontend/shared/css/)
- **base.css** - Reset, typography, global styles
- **layout.css** - Layout structure, containers, responsive design
- **components.css** - UI components (buttons, modals, cards, etc.)
- **animations.css** - Keyframe animations and transitions

### Theme-Specific CSS (in this directory)
- **theme.css** - CSS variables (colors, fonts) and minimal theme overrides
- **custom.css** - Special effects unique to your theme

## Assets

All assets are currently placeholder images. Replace them with theme-appropriate artwork:

- **bg-adventure.jpg** (1920x1080) - Main background image
- **hero-avatar.png** (128x128) - Player character avatar
- **npc-questgiver.png** (128x128) - Quest giver NPC avatar
- **icon-success.png** (128x128) - Success/completion icon
- **icon-failure.png** (128x128) - Failure/error icon
- **perfect_score.png** (512x512) - Perfect score celebration image

## Customization Guide

### 1. Update Quest Content (quests.json)

The quest pack follows a progressive learning structure. Each quest should teach a specific Rego concept.

For each quest, customize:
- %%description_lore%% - Narrative flavor text (array of strings)
- %%description_task%% - Clear task instruction
- %%manual%% - Reference documentation with data model and Rego snippets
- %%hints%% - Progressive hints to guide the player
- %%solution%% - The correct Rego policy
- %%tests%% - Test cases with payloads and expected outcomes

### 2. Customize Theme Colors and Fonts (theme.css)

Update CSS variables in the %%:root%% section of theme.css:

**Colors:**
- %%--bg-color%% - Main background color
- %%--surface-light%% / %%--surface-dark%% - Panel backgrounds
- %%--text-color%% - Primary text color
- %%--accent-color%% - Theme accent (buttons, borders, highlights)
- %%--success-color%% / %%--error-color%% - Feedback colors
- %%--accent-rgb%% - RGB values for rgba() usage (e.g., "126, 87, 194")

**Typography:**
- %%--font-heading%% - Headings and titles
- %%--font-body%% - Body text
- %%--font-code%% - Code editor and monospace text

**Background Image:**
Set the background image in the body selector:
%%css
body {
    background-image: url('assets/bg-adventure.jpg');
}
%%

**Optional Overrides:**
Add theme-specific overrides at the bottom of theme.css to customize specific components.

### 3. Add Theme-Specific Effects (custom.css)

Use custom.css for unique visual effects:

### 4. Add Background Music

Replace %%bg-music.m4a%% with your theme's background music. Recommended:
- Format: M4A
- Duration: 2-5 minutes (will loop)
- Style: Atmospheric, non-intrusive

### 5. Replace Visual Assets

Create or source images matching your theme:
- Use consistent art style across all assets
- Ensure proper dimensions (see Assets section above)
- Optimize file sizes for web delivery
- Consider accessibility (sufficient contrast)

## Testing Your Quest Pack

1. Start the Rego Adventure application
2. Select your quest pack from the start screen
3. Play through each quest to verify:
   - Lore text displays correctly
   - Tasks are clear and achievable
   - Hints provide appropriate guidance
   - Test cases validate solutions properly
   - Styling matches your theme vision
   - Custom effects render correctly

## CSS Best Practices

- **Don't modify shared CSS files** - They're used by all themes
- **Use CSS variables** - Define colors/fonts in :root for easy updates
- **Keep theme.css minimal** - Only override what's necessary
- **Use custom.css for effects** - Keep decorative effects separate
- **Test responsiveness** - Verify your theme works on mobile devices

## Need Help?

Refer to the main project documentation or examine existing quest packs for detailed examples.
`
