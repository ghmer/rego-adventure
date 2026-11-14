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
import { AssetService } from '../services/asset-service.js';

/**
 * Background music states. One value carries the whole machine; the
 * control is rendered from it and from nothing else. pauseTimer is an
 * implementation detail of the fading states, not a state of its own.
 *
 * | State         | Meaning                                                 | Control |
 * | ------------- | ------------------------------------------------------- | ------- |
 * | unavailable   | the pack has no playable track (load or decode failed)  | off, disabled |
 * | silent        | a track is available, nothing is playing                | off |
 * | fading-in     | play() was called, gain is ramping up                   | on |
 * | playing       | play() resolved, gain reached its target                | on |
 * | fading-out    | gain is ramping to 0, the element still runs            | off |
 * | play-rejected | play() rejected; cleared by the next toggle             | off |
 */
const MusicState = {
    Unavailable: 'unavailable',
    Silent: 'silent',
    FadingIn: 'fading-in',
    Playing: 'playing',
    FadingOut: 'fading-out',
    PlayRejected: 'play-rejected'
};

/**
 * Manages audio playback and music controls
 */
export class AudioManager {
    /**
     * @param {UIManager} uiManager - UI manager holding the audio element
     *   and the music control
     */
    constructor(uiManager) {
        this.ui = uiManager;
        this.musicState = MusicState.Silent;

        // Set when the Web Audio graph could not be created: element volume
        // carries the level and every gain call degrades to a no-op. Kept as
        // a flag so the degraded path is observable instead of silent.
        this.audioGraphFallback = false;

        this.musicRingCircumference = 0;
        this.audioCtx = null;
        this.gainNode = null;
        this.pauseTimer = null;

        // Sequence token of the track setup in flight or current; compared
        // by the async setup before it writes, so a superseded pack entry
        // or a return home cannot re-arm music afterwards.
        this.trackSeq = null;

        // Store bound functions once to avoid memory leaks from repeated .bind() calls
        this.boundHandleMusicEnded = this.handleMusicEnded.bind(this);
        this.boundUpdateMusicProgress = this.updateMusicProgress.bind(this);
        this.boundHandleTrackError = this.handleTrackError.bind(this);
    }

    /**
     * Setup music for a pack: resolve that pack's track for element use
     * (a blob URL when pack media is token-protected, the plain path
     * otherwise), point the element at it, reset playback and re-arm
     * loading. The element preloads metadata, which is what makes a
     * missing or undecodable track visible before the player clicks: the
     * load attempt fires an error event on the element, and listeners are
     * attached first so that event cannot be missed. A track that cannot
     * be resolved leaves the control unavailable; the sequence token
     * aborts a superseded setup before it writes.
     * @param {string} packId - Pack identifier
     * @param {number} seq - Load sequence token from loadPack
     */
    async setupMusic(packId, seq) {
        this.clearPauseTimer();

        const music = this.ui.elements.bgMusic;
        // The element feeds the gain node; loudness is controlled there
        music.volume = 1;
        music.pause();
        music.currentTime = 0;

        this.setupMusicListeners();
        this.initMusicProgress();
        this.setGain(AUDIO.DEFAULT_VOLUME);
        this.trackSeq = seq;

        let source;
        try {
            source = await AssetService.mediaURL(`/quests/${packId}/assets/bg-music.m4a`);
        } catch {
            console.warn('Background music unavailable for this pack: the track failed to resolve');
            if (seq === this.trackSeq) this.transitionTo(MusicState.Unavailable);
            return;
        }
        if (seq !== this.trackSeq) return;

        music.src = source;
        this.transitionTo(MusicState.Silent);

        // Changing src does not restart the loading algorithm on its own
        music.load();
    }

    /**
     * End the current track's lifetime. A pack transition that is not
     * followed by a new setupMusic (returning home) cancels an in-flight
     * setup so it cannot re-arm music afterwards.
     */
    invalidateTrack() {
        this.trackSeq = null;
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
            this.audioGraphFallback = false;
            return true;
        } catch (e) {
            // No Web Audio support: fall back to plain element playback
            console.warn('Web Audio unavailable, using element volume:', e);
            this.audioCtx = null;
            this.gainNode = null;
            this.audioGraphFallback = true;
            this.ui.elements.bgMusic.volume = AUDIO.DEFAULT_VOLUME;
            return false;
        }
    }

    /**
     * Cancel scheduled automation and set the gain value immediately
     * @param {number} value - Gain value (0-1); no-op without a graph
     */
    setGain(value) {
        if (this.gainNode) {
            const now = this.audioCtx.currentTime;
            this.gainNode.gain.cancelScheduledValues(now);
            this.gainNode.gain.setValueAtTime(value, now);
        }
    }

    /**
     * Ramp the gain node to a target value, replacing any scheduled ramp.
     * Scheduling is synchronous; the ramp itself plays out on the context
     * timeline. No-op without a graph.
     * @param {number} targetValue - Target gain (0-1)
     * @param {number} duration - Ramp duration in ms
     */
    rampGain(targetValue, duration) {
        if (!this.gainNode) return;

        const gain = this.gainNode.gain;
        const startTime = this.audioCtx.currentTime;

        gain.cancelScheduledValues(startTime);
        gain.setValueAtTime(gain.value, startTime);
        gain.linearRampToValueAtTime(targetValue, startTime + duration / 1000);
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
        const music = this.ui.elements.bgMusic;
        music.removeEventListener('ended', this.boundHandleMusicEnded);
        music.removeEventListener('timeupdate', this.boundUpdateMusicProgress);
        music.removeEventListener('error', this.boundHandleTrackError);

        music.addEventListener('ended', this.boundHandleMusicEnded);
        music.addEventListener('timeupdate', this.boundUpdateMusicProgress);
        music.addEventListener('error', this.boundHandleTrackError);
    }

    /**
     * Handle music ended event: the track plays once per toggle, so the
     * ring returns to its initial state and the button to its off state.
     * Rewinding the element makes the end of a track and a pause at the end
     * of a track the same position, so resuming starts from the beginning
     * either way.
     */
    handleMusicEnded() {
        this.clearPauseTimer();
        this.ui.elements.bgMusic.currentTime = 0;
        this.initMusicProgress();

        if (this.musicState !== MusicState.Silent && this.musicState !== MusicState.Unavailable) {
            this.transitionTo(MusicState.Silent);
        }
    }

    /**
     * Handle a track that will not play: a missing asset or a file the
     * decoder refuses (older packs carry a 0-byte placeholder). The pack has
     * no music to offer, so the control says so instead of offering a button
     * that does nothing.
     */
    handleTrackError() {
        console.warn('Background music unavailable for this pack: the track failed to load');
        this.transitionTo(MusicState.Unavailable);
    }

    /**
     * Toggle music playback (pause/resume keeps the current position).
     * Pausing fades to silence first; stopping the element at full gain
     * would cut the waveform mid-flight and is heard as a sharp knack.
     */
    toggleMusic() {
        if (this.musicState === MusicState.Unavailable) return;

        if (this.musicState === MusicState.Playing || this.musicState === MusicState.FadingIn) {
            this.fadeOut(false);
        } else {
            this.fadeIn();
        }
    }

    /**
     * Start or resume playback, ramping the gain in.
     */
    fadeIn() {
        this.clearPauseTimer();
        const music = this.ui.elements.bgMusic;

        // AudioContext creation/resume must happen inside a user gesture
        this.ensureAudioGraph();
        // Dropping the gain to 0 is only safe while nothing plays; resuming
        // mid-fade-out must re-anchor on the live param
        if (music.paused) {
            this.setGain(0);
        }

        this.transitionTo(MusicState.FadingIn);

        music.play().then(() => {
            // A toggle while play() was pending owns the element now: the
            // fade-out path already armed the pause, so ramping here would
            // fight it.
            if (this.musicState !== MusicState.FadingIn) return;
            // Short ramp in to avoid the playback start/resume click
            this.rampGain(AUDIO.DEFAULT_VOLUME, TIMING.FADE_DURATION);
            this.transitionTo(MusicState.Playing);
        }).catch(e => {
            // The only truthful rendering of a rejected play is an off
            // control, re-rendered here rather than left from the attempt.
            console.error('Audio play failed:', e);
            if (this.musicState !== MusicState.FadingIn) return;
            this.transitionTo(MusicState.PlayRejected);
        });
    }

    /**
     * Ramp the gain to silence, then pause the element.
     * @param {boolean} rewind - Whether to return the element to its start
     */
    fadeOut(rewind) {
        this.clearPauseTimer();
        this.transitionTo(MusicState.FadingOut);
        this.rampGain(0, TIMING.FADE_DURATION);

        this.pauseTimer = setTimeout(() => {
            this.pauseTimer = null;
            if (this.musicState !== MusicState.FadingOut) return;

            const music = this.ui.elements.bgMusic;
            music.pause();
            if (rewind) {
                music.currentTime = 0;
            }
            this.transitionTo(MusicState.Silent);
        }, TIMING.FADE_DURATION);
    }

    /**
     * Stop music playback with a fade-out, then rewind. A pack without a
     * track has nothing to stop, and going through the fade would land it in
     * the silent state with an enabled control: leaving unavailable intact is
     * what keeps the control honest after the player goes home.
     */
    stopMusic() {
        if (this.musicState === MusicState.Unavailable) return;
        this.fadeOut(true);
    }

    /**
     * Discard an armed fade-out pause
     */
    clearPauseTimer() {
        clearTimeout(this.pauseTimer);
        this.pauseTimer = null;
    }

    /**
     * The only writer of musicState transitions: move the machine and
     * repaint the control from the new state.
     * @param {string} state - Target MusicState
     */
    transitionTo(state) {
        this.musicState = state;
        this.renderMusicButton();
    }

    /**
     * Render the music control from musicState: the single place the button
     * icon, pressed state, label and availability are decided.
     */
    renderMusicButton() {
        const button = this.ui.elements.musicBtn;
        const icon = button.querySelector('i');
        const playing = this.musicState === MusicState.Playing || this.musicState === MusicState.FadingIn;
        const available = this.musicState !== MusicState.Unavailable;

        icon.className = playing ? 'fa-solid fa-volume-high' : 'fa-solid fa-volume-xmark';
        button.disabled = !available;
        button.classList.toggle('music-playing', playing);
        button.setAttribute('aria-pressed', playing ? 'true' : 'false');

        if (!available) {
            button.setAttribute('aria-label', 'Background music is not available for this pack');
            button.title = 'This pack has no background music';
        } else if (playing) {
            button.setAttribute('aria-label', 'Mute background music');
            button.title = 'Toggle background music on/off';
        } else {
            button.setAttribute('aria-label', 'Unmute background music');
            button.title = 'Toggle background music on/off';
        }
    }
}
