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
 * Audio Manager
 * Handles background music playback and controls.
 *
 * Music plays once per toggle: when the track ends, the button returns
 * to its off state and the user can start it again. Volume is handled
 * through a Web Audio GainNode for click-free ramps; the AudioContext
 * is created lazily on the first user-initiated play (autoplay policy).
 */

import { AUDIO, TIMING } from '../services/constants.js';

/**
 * Manages audio playback and music controls
 */
export class AudioManager {
    constructor(uiManager) {
        this.ui = uiManager;
        this.isMusicPlaying = false;
        this.musicRingCircumference = 0;
        this.audioCtx = null;
        this.gainNode = null;

        // Store bound functions once to avoid memory leaks from repeated .bind() calls
        this.boundHandleMusicEnded = this.handleMusicEnded.bind(this);
        this.boundUpdateMusicProgress = this.updateMusicProgress.bind(this);
    }

    /**
     * Setup music for a pack
     * @param {string} packId - Pack identifier
     */
    setupMusic(packId) {
        this.ui.elements.bgMusic.src = `/quests/${packId}/assets/bg-music.m4a`;
        // The element feeds the gain node; loudness is controlled there
        this.ui.elements.bgMusic.volume = 1;
        this.isMusicPlaying = false;
        this.ui.elements.bgMusic.pause();
        this.updateMusicButton();
        this.setupMusicListeners();
        this.initMusicProgress();
        this.setGain(AUDIO.DEFAULT_VOLUME);
    }

    /**
     * Create the AudioContext graph lazily on the first user-initiated
     * play. createMediaElementSource can only be called once per element,
     * and the context must be created/resumed inside a user gesture.
     * @returns {boolean} True when the gain node is available
     */
    ensureAudioGraph() {
        if (this.gainNode) {
            if (this.audioCtx.state === 'suspended') {
                this.audioCtx.resume();
            }
            return true;
        }

        try {
            this.audioCtx = new AudioContext();
            const source = this.audioCtx.createMediaElementSource(this.ui.elements.bgMusic);
            this.gainNode = this.audioCtx.createGain();
            this.gainNode.gain.value = AUDIO.DEFAULT_VOLUME;
            source.connect(this.gainNode);
            this.gainNode.connect(this.audioCtx.destination);
            return true;
        } catch (e) {
            // No Web Audio support: fall back to plain element playback
            console.warn('Web Audio unavailable, using element volume:', e);
            this.audioCtx = null;
            this.gainNode = null;
            this.ui.elements.bgMusic.volume = AUDIO.DEFAULT_VOLUME;
            return false;
        }
    }

    /**
     * Set the gain node value immediately
     * @param {number} value - Gain value (0-1); no-op without a graph
     */
    setGain(value) {
        if (this.gainNode) {
            this.gainNode.gain.value = value;
        }
    }

    /**
     * Ramp the gain node to a target value, replacing any scheduled ramp
     * @param {number} targetValue - Target gain (0-1); no-op without a graph
     * @param {number} duration - Ramp duration in ms
     * @returns {Promise} Resolves when the ramp is scheduled
     */
    rampGain(targetValue, duration) {
        if (!this.gainNode) return Promise.resolve();

        const gain = this.gainNode.gain;
        const startTime = this.audioCtx.currentTime;

        gain.cancelScheduledValues(startTime);
        gain.setValueAtTime(gain.value, startTime);
        gain.linearRampToValueAtTime(targetValue, startTime + duration / 1000);
        return Promise.resolve();
    }

    /**
     * Initialize music progress ring
     */
    initMusicProgress() {
        if (!this.ui.elements.musicProgressRing) return;

        const radius = this.ui.elements.musicProgressRing.r.baseVal.value;
        const circumference = radius * 2 * Math.PI;

        this.ui.elements.musicProgressRing.style.strokeDasharray = `${circumference} ${circumference}`;
        this.ui.elements.musicProgressRing.style.strokeDashoffset = circumference;

        this.musicRingCircumference = circumference;
    }

    /**
     * Update music progress ring
     */
    updateMusicProgress() {
        if (!this.ui.elements.musicProgressRing || !this.musicRingCircumference) return;

        const duration = this.ui.elements.bgMusic.duration;
        const currentTime = this.ui.elements.bgMusic.currentTime;

        if (duration > 0) {
            const progress = currentTime / duration;
            const offset = this.musicRingCircumference - (progress * this.musicRingCircumference);
            this.ui.elements.musicProgressRing.style.strokeDashoffset = offset;
        }
    }

    /**
     * Setup music event listeners
     */
    setupMusicListeners() {
        this.ui.elements.bgMusic.removeEventListener('ended', this.boundHandleMusicEnded);
        this.ui.elements.bgMusic.removeEventListener('timeupdate', this.boundUpdateMusicProgress);

        this.ui.elements.bgMusic.addEventListener('ended', this.boundHandleMusicEnded);
        this.ui.elements.bgMusic.addEventListener('timeupdate', this.boundUpdateMusicProgress);
    }

    /**
     * Handle music ended event: the track plays once per toggle, so the
     * ring returns to its initial state and the button to its off state
     */
    handleMusicEnded() {
        // Reset ring to its initial (empty) state
        this.initMusicProgress();

        if (this.isMusicPlaying) {
            this.isMusicPlaying = false;
            this.updateMusicButton();
        }
    }

    /**
     * Toggle music playback (pause/resume keeps the current position)
     */
    toggleMusic() {
        this.isMusicPlaying = !this.isMusicPlaying;
        if (this.isMusicPlaying) {
            // AudioContext creation/resume must happen inside a user gesture
            this.ensureAudioGraph();
            this.setGain(0);
            this.ui.elements.bgMusic.play().then(() => {
                // Short ramp in to avoid the playback start/resume click
                this.rampGain(AUDIO.DEFAULT_VOLUME, TIMING.FADE_DURATION);
            }).catch(e => {
                console.error("Audio play failed:", e);
                this.isMusicPlaying = false;
            });
        } else {
            this.ui.elements.bgMusic.pause();
            this.setGain(AUDIO.DEFAULT_VOLUME);
        }
        this.updateMusicButton();
    }

    /**
     * Stop music playback
     */
    stopMusic() {
        this.ui.elements.bgMusic.pause();
        this.ui.elements.bgMusic.currentTime = 0;
        this.isMusicPlaying = false;
        this.updateMusicButton();
    }

    /**
     * Update music button appearance
     */
    updateMusicButton() {
        const icon = this.ui.elements.musicBtn.querySelector('i');
        if (this.isMusicPlaying) {
            icon.className = 'fa-solid fa-volume-high';
            this.ui.elements.musicBtn.setAttribute('aria-label', 'Mute background music');
            this.ui.elements.musicBtn.setAttribute('aria-pressed', 'true');
            this.ui.elements.musicBtn.classList.add('music-playing');
        } else {
            icon.className = 'fa-solid fa-volume-xmark';
            this.ui.elements.musicBtn.setAttribute('aria-label', 'Unmute background music');
            this.ui.elements.musicBtn.setAttribute('aria-pressed', 'false');
            this.ui.elements.musicBtn.classList.remove('music-playing');
        }
    }
}
