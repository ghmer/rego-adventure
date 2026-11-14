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

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioManager } from './audio-manager.js';
import { AUDIO, TIMING } from '../services/constants.js';

const RING_RADIUS = 20;
const RING_CIRCUMFERENCE = 2 * RING_RADIUS * Math.PI;

// Expected values of the manager's musicState property
const MusicState = {
    Unavailable: 'unavailable',
    Silent: 'silent',
    FadingIn: 'fading-in',
    Playing: 'playing',
    FadingOut: 'fading-out',
    PlayRejected: 'play-rejected'
};

/**
 * UI double holding the elements the audio manager renders: a real music
 * button with the FontAwesome icon child, a real media element, and a
 * progress ring object shaped like the SVG circle the ring code reads.
 * @returns {Object} UI manager double
 */
function createUi() {
    const musicBtn = document.createElement('button');
    musicBtn.innerHTML = '<i class="fa-solid fa-volume-xmark"></i>';

    return {
        elements: {
            musicBtn,
            bgMusic: document.createElement('audio'),
            musicProgressRing: { r: { baseVal: { value: RING_RADIUS } }, style: {} }
        }
    };
}

/**
 * AudioContext double recording the gain automation the manager schedules,
 * so the fades are observable instead of inferred from the button.
 * @returns {Object} { Constructor, gainParam }
 */
function createAudioContextStub() {
    const gainParam = {
        value: 1,
        cancelScheduledValues: vi.fn(),
        setValueAtTime: vi.fn(),
        linearRampToValueAtTime: vi.fn()
    };

    class Constructor {
        constructor() {
            this.state = 'running';
            this.currentTime = 0;
            this.destination = { name: 'destination' };
            this.createMediaElementSource = vi.fn(() => ({ connect: vi.fn() }));
            this.createGain = vi.fn(() => ({ gain: gainParam, connect: vi.fn() }));
            this.resume = vi.fn();
        }
    }

    return { Constructor, gainParam };
}

/**
 * Wire an audio manager to a fresh UI double. The media element keeps
 * happy-dom's play/pause bookkeeping unless a test supplies an
 * implementation, which receives the real play as its first argument.
 * @param {Object} [options] - { playImpl: (realPlay) => Promise<void> }
 * @returns {Object} { audio, ui, music }
 */
function createFixture(options = {}) {
    const ui = createUi();
    const music = ui.elements.bgMusic;
    const realPlay = music.play.bind(music);

    const impl = options.playImpl ? (...args) => options.playImpl(realPlay, ...args) : () => realPlay();
    music.play = vi.fn(impl);
    music.load = vi.fn();

    return { audio: new AudioManager(ui), ui, music };
}

/**
 * Let the play promise settle without advancing the fade timer.
 */
async function settle() {
    await vi.advanceTimersByTimeAsync(0);
}

/**
 * Read the music button as rendered.
 * @param {Object} ui - UI double from createFixture
 * @returns {Object} icon class, aria-pressed, disabled, aria-label, playing class
 */
function renderedButton(ui) {
    const button = ui.elements.musicBtn;
    return {
        icon: button.querySelector('i').className,
        pressed: button.getAttribute('aria-pressed'),
        disabled: button.disabled,
        label: button.getAttribute('aria-label'),
        title: button.title,
        playingClass: button.classList.contains('music-playing')
    };
}

describe('AudioManager', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    describe('pack setup', () => {
        it('points the element at the pack track and probes it', async () => {
            const { audio, music } = createFixture();

            await audio.setupMusic('packA', 1);

            expect(music.getAttribute('src')).toBe('/quests/packA/assets/bg-music.m4a');
            expect(music.load).toHaveBeenCalledTimes(1);
            expect(audio.musicState).toBe(MusicState.Silent);
            expect(renderedButton(audio.ui).disabled).toBe(false);
        });

        it('re-arms the control when the next pack does have a track', async () => {
            const { audio, ui, music } = createFixture();
            await audio.setupMusic('packA', 1);
            music.dispatchEvent(new Event('error'));
            expect(renderedButton(ui).disabled).toBe(true);

            await audio.setupMusic('packB', 1);

            expect(audio.musicState).toBe(MusicState.Silent);
            expect(renderedButton(ui).disabled).toBe(false);
            expect(music.getAttribute('src')).toBe('/quests/packB/assets/bg-music.m4a');
        });
    });

    describe('toggle', () => {
        it('reports playing only once play has resolved', async () => {
            const { audio, ui } = createFixture();
            await audio.setupMusic('packA', 1);

            audio.toggleMusic();
            expect(audio.musicState).toBe(MusicState.FadingIn);

            await settle();
            expect(audio.musicState).toBe(MusicState.Playing);

            const rendered = renderedButton(ui);
            expect(rendered.icon).toBe('fa-solid fa-volume-high');
            expect(rendered.pressed).toBe('true');
            expect(rendered.playingClass).toBe(true);
            expect(rendered.disabled).toBe(false);
        });

        it('fades out before pausing, then renders silent', async () => {
            const { audio, ui, music } = createFixture();
            await audio.setupMusic('packA', 1);
            audio.toggleMusic();
            await settle();

            audio.toggleMusic();

            expect(audio.musicState).toBe(MusicState.FadingOut);
            expect(music.paused).toBe(false);
            expect(renderedButton(ui).icon).toBe('fa-solid fa-volume-xmark');

            vi.advanceTimersByTime(TIMING.FADE_DURATION);

            expect(audio.musicState).toBe(MusicState.Silent);
            expect(music.paused).toBe(true);
            expect(renderedButton(ui).pressed).toBe('false');
        });

        it('resumes when toggled again during the fade-out', async () => {
            const { audio, music } = createFixture();
            await audio.setupMusic('packA', 1);
            audio.toggleMusic();
            await settle();

            audio.toggleMusic();
            expect(audio.musicState).toBe(MusicState.FadingOut);

            audio.toggleMusic();
            expect(audio.musicState).toBe(MusicState.FadingIn);

            await settle();
            expect(audio.musicState).toBe(MusicState.Playing);
            expect(music.paused).toBe(false);
        });
    });

    describe('rejected play', () => {
        it('renders the control off without waiting for another click', async () => {
            const { audio, ui } = createFixture({
                playImpl: async () => { throw new Error('NotSupportedError: nothing to decode'); }
            });
            await audio.setupMusic('packA', 1);

            audio.toggleMusic();
            await settle();

            expect(audio.musicState).toBe(MusicState.PlayRejected);
            const rendered = renderedButton(ui);
            expect(rendered.icon).toBe('fa-solid fa-volume-xmark');
            expect(rendered.pressed).toBe('false');
            expect(rendered.playingClass).toBe(false);
            expect(rendered.disabled).toBe(false);
            expect(console.error).toHaveBeenCalled();
        });

        it('is cleared by the next toggle, which tries playback again', async () => {
            let failing = true;
            const { audio, ui } = createFixture({
                playImpl: async (realPlay) => {
                    if (failing) {
                        throw new Error('NotSupportedError');
                    }
                    await realPlay();
                }
            });
            await audio.setupMusic('packA', 1);

            audio.toggleMusic();
            await settle();
            expect(audio.musicState).toBe(MusicState.PlayRejected);

            failing = false;
            audio.toggleMusic();
            await settle();

            expect(audio.musicState).toBe(MusicState.Playing);
            expect(renderedButton(ui).icon).toBe('fa-solid fa-volume-high');
        });

        it('does not re-enable a control the track error already disabled', async () => {
            const { audio, ui, music } = createFixture({
                playImpl: async () => { throw new Error('NotSupportedError'); }
            });
            await audio.setupMusic('packA', 1);

            audio.toggleMusic();
            music.dispatchEvent(new Event('error'));
            await settle();

            expect(audio.musicState).toBe(MusicState.Unavailable);
            expect(renderedButton(ui).disabled).toBe(true);
        });
    });

    describe('track availability', () => {
        it('disables the control when the track fails to load', async () => {
            const { audio, ui, music } = createFixture();

            await audio.setupMusic('packA', 1);
            music.dispatchEvent(new Event('error'));

            expect(audio.musicState).toBe(MusicState.Unavailable);
            const rendered = renderedButton(ui);
            expect(rendered.disabled).toBe(true);
            expect(rendered.icon).toBe('fa-solid fa-volume-xmark');
            expect(rendered.label).toBe('Background music is not available for this pack');
            expect(rendered.title).toBe('This pack has no background music');
            expect(console.warn).toHaveBeenCalledTimes(1);
        });

        it('disables the control from the setup probe alone, before any click', async () => {
            const { audio, ui, music } = createFixture();
            music.load = vi.fn(() => music.dispatchEvent(new Event('error')));

            await audio.setupMusic('emptyPack', 1);

            expect(audio.musicState).toBe(MusicState.Unavailable);
            expect(renderedButton(ui).disabled).toBe(true);
        });

        it('ignores toggle attempts while no track is available', async () => {
            const { audio, music } = createFixture();
            await audio.setupMusic('packA', 1);
            music.dispatchEvent(new Event('error'));

            audio.toggleMusic();

            expect(music.play).not.toHaveBeenCalled();
            expect(audio.musicState).toBe(MusicState.Unavailable);
        });

        it('keeps the control disabled when the player leaves a pack without music', async () => {
            const { audio, ui, music } = createFixture();
            await audio.setupMusic('packA', 1);
            music.dispatchEvent(new Event('error'));

            audio.stopMusic();
            vi.advanceTimersByTime(TIMING.FADE_DURATION);

            expect(audio.musicState).toBe(MusicState.Unavailable);
            expect(renderedButton(ui).disabled).toBe(true);
        });
    });

    describe('track end', () => {
        it('rewinds the element and returns to silent, so ended and paused-at-end are equal', async () => {
            const { audio, ui, music } = createFixture();
            await audio.setupMusic('packA', 1);
            audio.toggleMusic();
            await settle();

            music.currentTime = 42;
            music.dispatchEvent(new Event('ended'));

            expect(music.currentTime).toBe(0);
            expect(audio.musicState).toBe(MusicState.Silent);
            expect(renderedButton(ui).icon).toBe('fa-solid fa-volume-xmark');
            expect(Number(audio.ui.elements.musicProgressRing.style.strokeDashoffset))
                .toBeCloseTo(RING_CIRCUMFERENCE);
        });
    });

    describe('stop on leaving the pack', () => {
        it('fades, pauses and rewinds', async () => {
            const { audio, music } = createFixture();
            await audio.setupMusic('packA', 1);
            audio.toggleMusic();
            await settle();
            music.currentTime = 30;

            audio.stopMusic();
            vi.advanceTimersByTime(TIMING.FADE_DURATION);

            expect(music.paused).toBe(true);
            expect(music.currentTime).toBe(0);
            expect(audio.musicState).toBe(MusicState.Silent);
        });

        it('leaves an already silent player silent', async () => {
            const { audio, music } = createFixture();
            await audio.setupMusic('packA', 1);

            audio.stopMusic();
            vi.advanceTimersByTime(TIMING.FADE_DURATION);

            expect(audio.musicState).toBe(MusicState.Silent);
            expect(music.paused).toBe(true);
            expect(music.currentTime).toBe(0);
        });
    });

    describe('Web Audio graph', () => {
        it('records the element-volume fallback and still plays', async () => {
            vi.stubGlobal('AudioContext', undefined);
            const { audio, ui } = createFixture();
            await audio.setupMusic('packA', 1);

            audio.toggleMusic();
            await settle();

            expect(audio.musicState).toBe(MusicState.Playing);
            expect(audio.audioGraphFallback).toBe(true);
            expect(audio.gainNode).toBeNull();
            expect(ui.elements.bgMusic.volume).toBe(AUDIO.DEFAULT_VOLUME);
        });

        it('ramps the gain node up on play and down on fade-out', async () => {
            const { Constructor, gainParam } = createAudioContextStub();
            vi.stubGlobal('AudioContext', Constructor);
            const { audio } = createFixture();
            await audio.setupMusic('packA', 1);

            audio.toggleMusic();
            await settle();
            expect(gainParam.linearRampToValueAtTime).toHaveBeenLastCalledWith(
                AUDIO.DEFAULT_VOLUME,
                TIMING.FADE_DURATION / 1000
            );
            expect(audio.audioGraphFallback).toBe(false);

            audio.toggleMusic();
            expect(gainParam.linearRampToValueAtTime).toHaveBeenLastCalledWith(
                0,
                TIMING.FADE_DURATION / 1000
            );
        });
    });
});
