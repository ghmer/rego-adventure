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
 * Handles background music playback and controls
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
    }

    /**
     * Setup music for a pack
     * @param {string} packId - Pack identifier
     */
    setupMusic(packId) {
        this.ui.elements.bgMusic.src = `/quests/${packId}/assets/bg-music.m4a`;
        this.ui.elements.bgMusic.volume = AUDIO.DEFAULT_VOLUME;
        this.isMusicPlaying = false;
        this.ui.elements.bgMusic.pause();
        this.updateMusicButton();
        this.setupMusicLoop();
        this.initMusicProgress();
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
     * Setup music loop with delay
     */
    setupMusicLoop() {
        this.ui.elements.bgMusic.removeEventListener('ended', this.handleMusicEnded.bind(this));
        this.ui.elements.bgMusic.removeEventListener('timeupdate', this.updateMusicProgress.bind(this));
        
        this.ui.elements.bgMusic.addEventListener('ended', this.handleMusicEnded.bind(this));
        this.ui.elements.bgMusic.addEventListener('timeupdate', this.updateMusicProgress.bind(this));
    }

    /**
     * Handle music ended event
     */
    handleMusicEnded() {
        // Ensure ring is full when song ends
        if (this.ui.elements.musicProgressRing) {
            this.ui.elements.musicProgressRing.style.strokeDashoffset = 0;
        }

        if (this.isMusicPlaying) {
            const originalVolume = this.ui.elements.bgMusic.volume;
            
            // Fade out to eliminate click sound
            this.fadeVolume(AUDIO.FADE_TARGET_VOLUME, TIMING.FADE_DURATION).then(() => {
                // Wait before replaying
                setTimeout(() => {
                    if (this.isMusicPlaying) {
                        // Reset ring before playing
                        if (this.ui.elements.musicProgressRing && this.musicRingCircumference) {
                            this.ui.elements.musicProgressRing.style.strokeDashoffset = this.musicRingCircumference;
                        }
                        
                        // Reset position while volume is at 0
                        this.ui.elements.bgMusic.currentTime = 0;
                        this.ui.elements.bgMusic.play().then(() => {
                            // Fade in after playback starts
                            this.fadeVolume(originalVolume, TIMING.FADE_DURATION);
                        }).catch(e => {
                            console.error("Audio replay failed:", e);
                            this.isMusicPlaying = false;
                            this.updateMusicButton();
                        });
                    }
                }, TIMING.MUSIC_LOOP_DELAY);
            });
        }
    }

    /**
     * Smoothly fade audio volume using requestAnimationFrame for smooth animation
     * @param {number} targetVolume - Target volume (0-1)
     * @param {number} duration - Fade duration in ms
     * @returns {Promise} Resolves when fade is complete (when progress reaches 1)
     */
    fadeVolume(targetVolume, duration) {
        return new Promise((resolve) => {
            const startVolume = this.ui.elements.bgMusic.volume;
            const volumeChange = targetVolume - startVolume;
            const startTime = performance.now();
            
            const updateVolume = () => {
                const elapsed = performance.now() - startTime;
                const progress = Math.min(elapsed / duration, 1);
                
                this.ui.elements.bgMusic.volume = startVolume + (volumeChange * progress);
                
                if (progress < 1) {
                    requestAnimationFrame(updateVolume);
                } else {
                    resolve();
                }
            };
            
            requestAnimationFrame(updateVolume);
        });
    }

    /**
     * Toggle music playback
     */
    toggleMusic() {
        this.isMusicPlaying = !this.isMusicPlaying;
        if (this.isMusicPlaying) {
            this.ui.elements.bgMusic.play().catch(e => {
                console.error("Audio play failed:", e);
                this.isMusicPlaying = false;
            });
        } else {
            this.ui.elements.bgMusic.pause();
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