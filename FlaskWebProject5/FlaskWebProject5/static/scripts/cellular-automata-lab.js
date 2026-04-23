(function () {
    "use strict";

    var SCALE_LIBRARY = {
        cMinor: { label: "C Minor Pentatonic", rootMidi: 48, intervals: [0, 3, 5, 7, 10] },
        dDorian: { label: "D Dorian", rootMidi: 50, intervals: [0, 2, 3, 5, 7, 9, 10] },
        aAeolian: { label: "A Natural Minor", rootMidi: 45, intervals: [0, 2, 3, 5, 7, 8, 10] },
        gMixolydian: { label: "G Mixolydian", rootMidi: 43, intervals: [0, 2, 4, 5, 7, 9, 10] }
    };

    var CELL_COLORS = ["#09131f", "#ffd166", "#29c7ac"];
    var VOICE_COUNT = 6;
    var PREVIEW_INTERVAL_MS = 180;
    var START_PADDING_SECONDS = 0.08;
    var MEME_SOUND_URLS = Array.isArray(window.MEME_SOUND_URLS) ? window.MEME_SOUND_URLS : [];

    var state = {
        frames: [],
        frameActivity: [],
        sequence: [],
        generatedSettings: null,
        previewTimer: null,
        playbackTimerIds: [],
        activeNodes: [],
        currentFrame: 0,
        isPlaying: false,
        audioContext: null
    };

    var refs = {
        gridSize: document.getElementById("grid-size"),
        gridSizeValue: document.getElementById("grid-size-value"),
        steps: document.getElementById("steps"),
        stepsValue: document.getElementById("steps-value"),
        density: document.getElementById("density"),
        densityValue: document.getElementById("density-value"),
        tempo: document.getElementById("tempo"),
        tempoValue: document.getElementById("tempo-value"),
        scale: document.getElementById("scale"),
        humorMode: document.getElementById("humor-mode"),
        playButton: document.getElementById("play-button"),
        stopButton: document.getElementById("stop-button"),
        statusText: document.getElementById("status-text"),
        automataCanvas: document.getElementById("automata-canvas"),
        timelineCanvas: document.getElementById("timeline-canvas"),
        captionText: document.getElementById("caption-text")
    };

    function clamp(value, min, max) {
        return Math.min(Math.max(value, min), max);
    }

    function toNumber(value) {
        return Number(value);
    }

    function updateControlLabels() {
        refs.gridSizeValue.textContent = refs.gridSize.value + " x " + refs.gridSize.value;
        refs.stepsValue.textContent = refs.steps.value;
        refs.densityValue.textContent = Math.round(toNumber(refs.density.value) * 100) + "%";
        refs.tempoValue.textContent = refs.tempo.value + " BPM";
    }

    function readSettings() {
        return {
            gridSize: parseInt(refs.gridSize.value, 10),
            steps: parseInt(refs.steps.value, 10),
            density: toNumber(refs.density.value),
            tempo: parseInt(refs.tempo.value, 10),
            scaleKey: refs.scale.value,
            humorMode: refs.humorMode.checked
        };
    }

    function createSeedGrid(gridSize, density) {
        var grid = [];
        var x;
        var y;

        for (y = 0; y < gridSize; y += 1) {
            var row = [];
            for (x = 0; x < gridSize; x += 1) {
                row.push(Math.random() < density ? 1 : 0);
            }
            grid.push(row);
        }

        return grid;
    }

    function cloneGrid(grid) {
        return grid.map(function (row) {
            return row.slice();
        });
    }

    function countFiringNeighbors(grid, x, y) {
        var gridSize = grid.length;
        var count = 0;
        var dx;
        var dy;

        for (dy = -1; dy <= 1; dy += 1) {
            for (dx = -1; dx <= 1; dx += 1) {
                if (dx === 0 && dy === 0) {
                    continue;
                }

                var wrappedY = (y + dy + gridSize) % gridSize;
                var wrappedX = (x + dx + gridSize) % gridSize;

                if (grid[wrappedY][wrappedX] === 1) {
                    count += 1;
                }
            }
        }

        return count;
    }

    function stepAutomaton(grid) {
        var gridSize = grid.length;
        var nextGrid = [];
        var x;
        var y;

        for (y = 0; y < gridSize; y += 1) {
            var nextRow = [];
            for (x = 0; x < gridSize; x += 1) {
                var cell = grid[y][x];
                var nextState = 0;

                if (cell === 0) {
                    nextState = countFiringNeighbors(grid, x, y) === 2 ? 1 : 0;
                } else if (cell === 1) {
                    nextState = 2;
                } else {
                    nextState = 0;
                }

                nextRow.push(nextState);
            }
            nextGrid.push(nextRow);
        }

        return nextGrid;
    }

    function buildFrames(settings) {
        var frames = [];
        var current = createSeedGrid(settings.gridSize, settings.density);
        var index;

        for (index = 0; index < settings.steps; index += 1) {
            frames.push(cloneGrid(current));
            current = stepAutomaton(current);
        }

        return frames;
    }

    function buildPitchPool(scaleConfig) {
        var pool = [];
        var octave;

        for (octave = 0; octave < 4; octave += 1) {
            scaleConfig.intervals.forEach(function (interval) {
                pool.push(scaleConfig.rootMidi + interval + (octave * 12));
            });
        }

        return pool;
    }

    function midiToFrequency(midiNote) {
        return 440 * Math.pow(2, (midiNote - 69) / 12);
    }

    function mapFramesToSequence(frames, scaleKey, tempo) {
        var scaleConfig = SCALE_LIBRARY[scaleKey];
        var pitchPool = buildPitchPool(scaleConfig);
        var beatDuration = 60 / tempo;
        var laneEvents = [];
        var laneWidth = frames[0].length / VOICE_COUNT;
        var frameActivity = [];

        frames.forEach(function (frame, frameIndex) {
            var firingCount = 0;

            for (var lane = 0; lane < VOICE_COUNT; lane += 1) {
                var startColumn = Math.floor(lane * laneWidth);
                var endColumn = lane === VOICE_COUNT - 1 ? frame[0].length : Math.floor((lane + 1) * laneWidth);
                var hits = 0;
                var totalRow = 0;

                frame.forEach(function (row, rowIndex) {
                    for (var column = startColumn; column < endColumn; column += 1) {
                        if (row[column] === 1) {
                            hits += 1;
                            totalRow += rowIndex;
                        }
                    }
                });

                firingCount += hits;

                if (hits === 0) {
                    continue;
                }

                var averageRow = totalRow / hits;
                var density = hits / Math.max((endColumn - startColumn) * frame.length, 1);
                var pitchIndex = Math.round(((frame.length - 1 - averageRow) / Math.max(frame.length - 1, 1)) * (pitchPool.length - 1));
                pitchIndex = clamp(pitchIndex + (lane % 2), 0, pitchPool.length - 1);

                laneEvents.push({
                    frameIndex: frameIndex,
                    startTime: frameIndex * beatDuration,
                    duration: beatDuration * 0.92,
                    frequency: midiToFrequency(pitchPool[pitchIndex]),
                    gain: clamp(0.07 + (density * 1.8), 0.08, 0.23),
                    pan: clamp(-0.85 + (lane / Math.max(VOICE_COUNT - 1, 1)) * 1.7, -0.85, 0.85),
                    lane: lane
                });
            }

            if (firingCount > 0 && firingCount < frame.length) {
                var bassPool = [scaleConfig.rootMidi - 12, scaleConfig.rootMidi - 5, scaleConfig.rootMidi];
                laneEvents.push({
                    frameIndex: frameIndex,
                    startTime: frameIndex * beatDuration,
                    duration: beatDuration * 0.75,
                    frequency: midiToFrequency(bassPool[frameIndex % bassPool.length]),
                    gain: clamp(0.05 + (firingCount / (frame.length * frame.length)) * 0.6, 0.05, 0.18),
                    pan: 0,
                    lane: VOICE_COUNT
                });
            }

            frameActivity.push(firingCount);
        });

        return {
            sequence: laneEvents,
            frameActivity: frameActivity,
            scaleLabel: scaleConfig.label
        };
    }

    function ensureAudioContext() {
        if (!window.AudioContext && !window.webkitAudioContext) {
            refs.statusText.textContent = "This browser does not support the Web Audio API, so playback is unavailable.";
            return null;
        }

        if (!state.audioContext) {
            var AudioContextType = window.AudioContext || window.webkitAudioContext;
            state.audioContext = new AudioContextType();
        }

        return state.audioContext;
    }

    function settingsMatchCurrentControls() {
        var settings = readSettings();

        if (!state.generatedSettings) {
            return false;
        }

        return state.generatedSettings.gridSize === settings.gridSize &&
            state.generatedSettings.steps === settings.steps &&
            state.generatedSettings.density === settings.density &&
            state.generatedSettings.tempo === settings.tempo &&
            state.generatedSettings.scaleKey === settings.scaleKey &&
            state.generatedSettings.humorMode === settings.humorMode;
    }

    function buildCaptionText() {
        var totalFrames = Math.max(state.frames.length, 1);
        var activeCells = state.frameActivity[state.currentFrame] || 0;
        var baseCaption = "Generation " + (state.currentFrame + 1) + " of " + totalFrames + ". Active cells: " + activeCells + ".";

        if (!refs.humorMode.checked) {
            return baseCaption;
        }

        if (!MEME_SOUND_URLS.length) {
            return baseCaption + " Humor mode is on, but no meme clips were found.";
        }

        return baseCaption + " Humor mode will trigger " + MEME_SOUND_URLS.length + " meme clip" +
            (MEME_SOUND_URLS.length === 1 ? "" : "s") + ".";
    }

    function refreshCaption() {
        refs.captionText.textContent = buildCaptionText();
    }

    function markSettingsChanged() {
        refs.statusText.textContent = "Settings changed. Click Play again to regenerate the automaton and hear the update.";
    }

    function stopPreviewLoop() {
        if (state.previewTimer) {
            clearInterval(state.previewTimer);
            state.previewTimer = null;
        }
    }

    function startPreviewLoop() {
        stopPreviewLoop();

        if (!state.frames.length || state.isPlaying) {
            return;
        }

        state.previewTimer = window.setInterval(function () {
            var nextFrame = (state.currentFrame + 1) % state.frames.length;
            setFrame(nextFrame);
        }, PREVIEW_INTERVAL_MS);
    }

    function renderFrame() {
        var canvas = refs.automataCanvas;
        var context = canvas.getContext("2d");
        var frame = state.frames[state.currentFrame];

        if (!frame) {
            context.clearRect(0, 0, canvas.width, canvas.height);
            return;
        }

        var gridSize = frame.length;
        var cellSize = canvas.width / gridSize;
        var x;
        var y;

        context.clearRect(0, 0, canvas.width, canvas.height);
        context.fillStyle = "#09131f";
        context.fillRect(0, 0, canvas.width, canvas.height);

        for (y = 0; y < gridSize; y += 1) {
            for (x = 0; x < gridSize; x += 1) {
                context.fillStyle = CELL_COLORS[frame[y][x]];
                context.fillRect(x * cellSize, y * cellSize, cellSize - 1, cellSize - 1);
            }
        }
    }

    function renderTimeline() {
        var canvas = refs.timelineCanvas;
        var context = canvas.getContext("2d");
        var values = state.frameActivity;
        var width = canvas.width;
        var height = canvas.height;
        var maxValue = Math.max.apply(null, values.concat([1]));

        context.clearRect(0, 0, width, height);
        context.fillStyle = "#08131f";
        context.fillRect(0, 0, width, height);

        values.forEach(function (value, index) {
            var barWidth = width / Math.max(values.length, 1);
            var x = index * barWidth;
            var barHeight = (value / maxValue) * (height - 28);

            context.fillStyle = index === state.currentFrame ? "#ffd166" : "rgba(123, 223, 242, 0.65)";
            context.fillRect(x + 2, height - barHeight - 10, Math.max(barWidth - 4, 2), barHeight);
        });

        context.strokeStyle = "rgba(255, 255, 255, 0.15)";
        context.lineWidth = 2;
        context.strokeRect(1, 1, width - 2, height - 2);
    }

    function setFrame(index) {
        state.currentFrame = clamp(index, 0, Math.max(state.frames.length - 1, 0));
        renderFrame();
        renderTimeline();
        refreshCaption();
    }

    function clearPlaybackTimers() {
        state.playbackTimerIds.forEach(function (timerId) {
            clearTimeout(timerId);
        });

        state.playbackTimerIds = [];
    }

    function stopPlayback() {
        state.isPlaying = false;
        clearPlaybackTimers();

        state.activeNodes.forEach(function (entry) {
            if (entry && typeof entry.stop === "function") {
                entry.stop();
            }
        });

        state.activeNodes = [];
        startPreviewLoop();
    }

    function scheduleFramePreview(beatDuration) {
        var totalFrames = state.frames.length;

        for (var frameIndex = 0; frameIndex < totalFrames; frameIndex += 1) {
            state.playbackTimerIds.push(window.setTimeout((function (capturedFrameIndex) {
                return function () {
                    setFrame(capturedFrameIndex);
                };
            }(frameIndex)), (START_PADDING_SECONDS + frameIndex * beatDuration) * 1000));
        }

        state.playbackTimerIds.push(window.setTimeout(function () {
            state.isPlaying = false;
            state.activeNodes = [];
            startPreviewLoop();
        }, (START_PADDING_SECONDS + totalFrames * beatDuration + 0.3) * 1000));
    }

    function scheduleSynthPlayback(sequence, beatDuration) {
        var audioContext = ensureAudioContext();

        if (!audioContext) {
            return false;
        }

        if (audioContext.state === "suspended") {
            audioContext.resume();
        }

        var startAt = audioContext.currentTime + START_PADDING_SECONDS;

        state.isPlaying = true;
        stopPreviewLoop();
        clearPlaybackTimers();

        sequence.forEach(function (event) {
            var oscillator = audioContext.createOscillator();
            var gainNode = audioContext.createGain();
            var filterNode = audioContext.createBiquadFilter();
            var destination = filterNode;

            oscillator.type = event.lane % 2 === 0 ? "triangle" : "sine";
            oscillator.frequency.setValueAtTime(event.frequency, startAt + event.startTime);

            filterNode.type = "lowpass";
            filterNode.frequency.value = 1800;

            if (audioContext.createStereoPanner) {
                var pannerNode = audioContext.createStereoPanner();
                pannerNode.pan.value = event.pan;
                filterNode.connect(pannerNode);
                pannerNode.connect(audioContext.destination);
            } else {
                filterNode.connect(audioContext.destination);
            }

            gainNode.gain.setValueAtTime(0.0001, startAt + event.startTime);
            gainNode.gain.linearRampToValueAtTime(event.gain, startAt + event.startTime + 0.03);
            gainNode.gain.exponentialRampToValueAtTime(0.0001, startAt + event.startTime + event.duration);

            oscillator.connect(gainNode);
            gainNode.connect(destination);

            oscillator.start(startAt + event.startTime);
            oscillator.stop(startAt + event.startTime + event.duration + 0.05);

            state.activeNodes.push({
                stop: function () {
                    try {
                        oscillator.stop();
                    } catch (error) {
                        // Oscillator may already be stopped.
                    }
                }
            });
        });

        scheduleFramePreview(beatDuration);
        return true;
    }

    function playRandomMemeClip(activity, peakActivity) {
        var url = MEME_SOUND_URLS[Math.floor(Math.random() * MEME_SOUND_URLS.length)];
        var clip = new Audio(url);
        var activityShare = activity / Math.max(peakActivity, 1);

        clip.preload = "auto";
        clip.volume = clamp(0.25 + activityShare * 0.6, 0.2, 1);
        clip.playbackRate = clamp(0.85 + activityShare * 0.35, 0.75, 1.35);

        state.activeNodes.push({
            stop: function () {
                try {
                    clip.pause();
                    clip.currentTime = 0;
                } catch (error) {
                    // Audio element may already be finished.
                }
            }
        });

        var playPromise = clip.play();

        if (playPromise && typeof playPromise.catch === "function") {
            playPromise.catch(function () {
                refs.statusText.textContent = "A meme clip was blocked by the browser. Click Play once more to retry.";
            });
        }
    }

    function scheduleHumorPlayback(beatDuration) {
        if (!MEME_SOUND_URLS.length) {
            refs.statusText.textContent = "Humor mode is on, but the meme folder does not contain any supported clips yet.";
            return false;
        }

        var peakActivity = Math.max.apply(null, state.frameActivity.concat([1]));
        var averageActivity = state.frameActivity.reduce(function (total, value) {
            return total + value;
        }, 0) / Math.max(state.frameActivity.length, 1);

        state.isPlaying = true;
        stopPreviewLoop();
        clearPlaybackTimers();

        state.frameActivity.forEach(function (activity, frameIndex) {
            var shouldTrigger = activity > 0 && (frameIndex % 3 === 0 || activity >= averageActivity);

            if (!shouldTrigger) {
                return;
            }

            state.playbackTimerIds.push(window.setTimeout(function () {
                playRandomMemeClip(activity, peakActivity);
            }, (START_PADDING_SECONDS + frameIndex * beatDuration) * 1000));
        });

        scheduleFramePreview(beatDuration);
        return true;
    }

    function generateComposition() {
        var settings = readSettings();
        var mapped;

        stopPlayback();
        state.frames = buildFrames(settings);
        mapped = mapFramesToSequence(state.frames, settings.scaleKey, settings.tempo);
        state.sequence = mapped.sequence;
        state.frameActivity = mapped.frameActivity;
        state.generatedSettings = settings;
        setFrame(0);

        if (settings.humorMode) {
            refs.statusText.textContent = "Generated " + state.frames.length + " generations. Humor mode is ready with " +
                MEME_SOUND_URLS.length + " meme clip" + (MEME_SOUND_URLS.length === 1 ? "" : "s") + ".";
        } else {
            refs.statusText.textContent = "Generated " + state.frames.length + " generations and scheduled " + state.sequence.length +
                " notes using the " + mapped.scaleLabel + " palette.";
        }

        startPreviewLoop();
    }

    function playComposition() {
        var beatDuration = 60 / parseInt(refs.tempo.value, 10);
        var played = false;

        if (!state.sequence.length || !settingsMatchCurrentControls()) {
            generateComposition();
        }

        stopPlayback();

        if (refs.humorMode.checked) {
            played = scheduleHumorPlayback(beatDuration);
            if (played) {
                refs.statusText.textContent = "Playing the automaton with random meme clips from the meme folder.";
            }
            return;
        }

        played = scheduleSynthPlayback(state.sequence, beatDuration);
        if (played) {
            refs.statusText.textContent = "Playing the current cellular automata composition.";
        }
    }

    function updateHumorModeText() {
        refreshCaption();
        markSettingsChanged();
    }

    function bindEvents() {
        [refs.gridSize, refs.steps, refs.density, refs.tempo].forEach(function (input) {
            input.addEventListener("input", function () {
                updateControlLabels();
                markSettingsChanged();
            });
        });

        refs.scale.addEventListener("change", markSettingsChanged);
        refs.humorMode.addEventListener("change", updateHumorModeText);
        refs.playButton.addEventListener("click", playComposition);
        refs.stopButton.addEventListener("click", function () {
            refs.statusText.textContent = "Playback stopped. The automaton preview is still available on the canvas.";
            stopPlayback();
        });

        window.addEventListener("beforeunload", stopPlayback);
    }

    updateControlLabels();
    bindEvents();
    generateComposition();
}());
