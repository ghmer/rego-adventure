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
 * Application Constants
 * Centralized configuration values used throughout the application
 */

/**
 * Scoring system constants
 */
export const SCORING = {
    POINTS_PER_QUEST: 10,
    POINTS_PER_HINT: 2,
    MAX_HINT_PENALTY: 6,
    SOLUTION_PENALTY: 3
};

/**
 * Timing and animation constants (in milliseconds)
 */
export const TIMING = {
    MUSIC_LOOP_DELAY: 10000,        // 10 seconds between music loops
    FADE_DURATION: 250,              // Audio fade in/out duration
    TUTORIAL_FOCUS_DELAY: 100,       // Delay before focusing tutorial elements
    TUTORIAL_SHOW_DELAY: 250,        // Delay before showing tutorial after quest load
    CONFETTI_DURATION: 3000,         // Confetti animation duration
    CONFETTI_INTERVAL: 250           // Confetti particle spawn interval
};

/**
 * UI spacing and layout constants (in pixels)
 */
export const UI = {
    SPOTLIGHT_PADDING: 10,            // Padding around tutorial spotlight
    TOOLTIP_SPACING: 20,             // Spacing between tooltip and element
    TOOLTIP_MIN_MARGIN: 20           // Minimum margin from viewport edge
};

/**
 * Audio settings
 */
export const AUDIO = {
    DEFAULT_VOLUME: 0.5,             // Default background music volume (0-1)
    FADE_TARGET_VOLUME: 0            // Target volume when fading out
};

/**
 * API configuration
 */
export const API = {
    BASE_URL: '/api'
};

/**
 * Default UI text fallbacks
 */
export const DEFAULT_TEXT = {
    GRIMOIRE_TITLE: 'Policy Grimoire',
    HINT_BUTTON: 'Ask Advisor',
    VERIFY_BUTTON: 'Apply Policy',
    MESSAGE_SUCCESS: 'Quest Complete!',
    MESSAGE_FAILURE: 'Quest Failed',
    PERFECT_SCORE_MESSAGE: 'You have achieved perfection!',
    PERFECT_SCORE_BUTTON: 'A Secret Awaits...',
    ADVENTURE_TITLE: 'Rego Adventure',
    NEXT_QUEST: 'Next Quest',
    BEGIN_ADVENTURE: 'Begin Adventure',
    PROLOGUE_LABEL: 'Prologue',
    PROLOGUE_TITLE: 'Adventure Begins',
    PROLOGUE_OBJECTIVE: 'Read the lore to begin your journey.',
    EPILOGUE_LABEL: 'Epilogue',
    EPILOGUE_TITLE: 'Adventure Complete!',
    EPILOGUE_OBJECTIVE: 'Congratulations on completing the adventure!'
};

/**
 * Default Rego code template
 */
export const DEFAULT_REGO_CODE = 'package play\nimport rego.v1\n\ndefault allow := false';

/**
 * Confetti animation settings
 */
export const CONFETTI = {
    START_VELOCITY: 30,
    SPREAD: 360,
    TICKS: 60,
    Z_INDEX: 2000,
    ORIGIN_MIN_X: 0.1,
    ORIGIN_MAX_X_LEFT: 0.3,
    ORIGIN_MIN_X_RIGHT: 0.7,
    ORIGIN_MAX_X_RIGHT: 0.9,
    ORIGIN_Y_OFFSET: -0.2
};