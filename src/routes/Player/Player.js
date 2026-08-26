// Copyright (C) 2017-2023 Smart code 203358507

const React = require('react');
const ReactDOM = require('react-dom');
const { useParams, useNavigate } = require('react-router');
const { useSearchParams } = require('react-router-dom');
const classnames = require('classnames');
const debounce = require('lodash.debounce');
const langs = require('langs');
const { useTranslation } = require('react-i18next');
const { default: useRouteFocused } = require('stremio/common/useRouteFocused');
const { useCore } = require('stremio/core');
const { useServices, useGamepad } = require('stremio/services');
const { useContentGamepadNavigation } = require('stremio/services/GamepadNavigation');
const { useSettings, useProfile, useFullscreen, useBinaryState, useToast, useStreamingServer, withCoreSuspender, usePlatform, onShortcut, getKeyboardShortcutKey, getKeyboardShortcutKeys, useDiscord, EMPTY_DISCORD_TIMESTAMPS, getPlaybackDiscordActivity } = require('stremio/common');
const { default: toPath } = require('stremio-router/toPath');
const { HorizontalNavBar, Transition, ContextMenu } = require('stremio/components');
const { default: Buffering } = require('./Buffering');
const VolumeChangeIndicator = require('./VolumeChangeIndicator');
const Error = require('./Error');
const ControlBar = require('./ControlBar');
const NextVideoPopup = require('./NextVideoPopup');
const RelatedOverlay = require('./RelatedOverlay');
const SkipIntroButton = require('./SkipIntroButton');
const StatisticsMenu = require('./StatisticsMenu');
const OptionsMenu = require('./OptionsMenu');
const NextEpisodeButton = require('./NextEpisodeButton');
const { readAutoNextEpisode, writeAutoNextEpisode } = require('./autoNextEpisodeSetting');
const { readPlayerSettings, writePlayerSettings, defaultSubtitleFont, subtitleFontStack } = require('./playerSettingsStorage');

// Resolves the on-disk fonts folder (served by the local server) so mpv's
// libass can load bundled/drop-in fonts that are not installed in Windows.
let fontsDirPromise = null;
const fetchFontsDir = () => {
    if (fontsDirPromise === null) {
        fontsDirPromise = fetch('/fonts-dir')
            .then((response) => response.ok ? response.json() : null)
            .then((data) => typeof data?.path === 'string' && data.path.length > 0 ? data.path : null)
            .catch(() => null);
    }
    return fontsDirPromise;
};
const sendSubtitleFontToShell = (shell, font) => {
    const primaryFont = String(font ?? '').replace(/['"\\]/g, '').trim();
    if (primaryFont.length === 0) {
        return;
    }
    fetchFontsDir().then((fontsDir) => {
        if (fontsDir !== null) {
            shell.send('mpv-set-prop', 'sub-fonts-dir', fontsDir);
        }
        shell.send('mpv-set-prop', 'sub-font', primaryFont);
    });
};
const { default: CastDevicesMenu } = require('./CastDevicesMenu');
const SubtitlesMenu = require('./SubtitlesMenu');
const { default: AudioMenu } = require('./AudioMenu');
const SpeedMenu = require('./SpeedMenu');
const { default: SideDrawerButton } = require('./SideDrawerButton');
const { default: SideDrawer } = require('./SideDrawer');
const usePlayer = require('./usePlayer');
const useSkipSegments = require('./useSkipSegments');
const { buildStreamsUrl, pickBestStream } = require('./bingeFallback');
const { default: usePlayOnDevice } = require('./usePlayOnDevice');
const { default: useKeyboardSeek } = require('./useKeyboardSeek');
const useStatistics = require('./useStatistics');
const useVideo = require('./useVideo');
const { default: useSubtitles } = require('./useSubtitles');
const styles = require('./styles');
const Video = require('./Video');
const { default: Indicator } = require('./Indicator/Indicator');
const { default: useMediaSession } = require('./useMediaSession');

const findTrackByLang = (tracks, lang) => tracks.find((track) => track.lang === lang || langs.where('1', track.lang)?.[2] === lang);
const findTrackById = (tracks, id) => tracks.find((track) => track.id === id);

const GAMEPAD_HANDLER_ID = 'player';

const CAST_DEVICES_REFRESH_INTERVAL = 5000;

const Player = () => {
    const { stream, streamTransportUrl, metaTransportUrl, type, id, videoId } = useParams();
    const urlParams = React.useMemo(() => ({
        stream,
        streamTransportUrl,
        metaTransportUrl,
        type,
        id,
        videoId
    }), [stream, streamTransportUrl, metaTransportUrl, type, id, videoId]);
    const [queryParams] = useSearchParams();
    const navigate = useNavigate();
    const { t } = useTranslation();
    const services = useServices();
    const core = useCore();
    const gamepad = useGamepad();
    const forceTranscoding = React.useMemo(() => {
        return queryParams.has('forceTranscoding');
    }, [queryParams]);
    const profile = useProfile();
    const [player, videoParamsChanged, streamStateChanged, subtitlePreferenceChanged, timeChanged, seek, pausedChanged, ended, nextVideo] = usePlayer(urlParams);
    const [settings] = useSettings();
    const streamingServer = useStreamingServer();
    const statistics = useStatistics(player, streamingServer);
    const video = useVideo();
    const skipSegments = useSkipSegments(player, video.state.duration);
    const [autoNextEnabled, setAutoNextEnabled] = React.useState(readAutoNextEpisode);
    const onToggleAutoNext = React.useCallback(() => {
        setAutoNextEnabled((prev) => {
            const next = !prev;
            writeAutoNextEpisode(next);
            return next;
        });
    }, []);
    const routeFocused = useRouteFocused();
    const platform = usePlatform();
    const toast = useToast();
    const discord = useDiscord();
    const discordTimestamps = React.useRef(EMPTY_DISCORD_TIMESTAMPS);

    const [seeking, setSeeking] = React.useState(false);

    const [casting, setCasting] = React.useState(() => {
        return services.chromecast.active && services.chromecast.transport.getCastState() === cast.framework.CastState.CONNECTED;
    });
    const playbackDevices = React.useMemo(() => streamingServer.playbackDevices !== null && streamingServer.playbackDevices.type === 'Ready' ? streamingServer.playbackDevices.content : [], [streamingServer]);

    const playerRef = React.useRef(null);
    const bufferingRef = React.useRef();
    const errorRef = React.useRef();

    const [immersed, setImmersed] = React.useState(true);
    const setImmersedDebounced = React.useCallback(debounce(setImmersed, 3000), []);
    const [fullscreen, , , toggleFullscreen, , setVideoElement] = useFullscreen();

    React.useEffect(() => {
        const el = video.containerRef.current?.querySelector('video');
        setVideoElement(el || null);
        return () => setVideoElement(null);
    }, [video.state.manifest]);

    const [optionsMenuOpen, , closeOptionsMenu, toggleOptionsMenu] = useBinaryState(false);
    const [subtitlesMenuOpen, , closeSubtitlesMenu, toggleSubtitlesMenu] = useBinaryState(false);
    const [audioMenuOpen, , closeAudioMenu, toggleAudioMenu] = useBinaryState(false);
    const [speedMenuOpen, , closeSpeedMenu, toggleSpeedMenu] = useBinaryState(false);
    const [statisticsMenuOpen, openStatisticsMenu, closeStatisticsMenu, toggleStatisticsMenu] = useBinaryState(false);
    const [castDevicesMenuOpen, , closeCastDevicesMenu, toggleCastDevicesMenu] = useBinaryState(false);
    const [nextVideoPopupOpen, openNextVideoPopup, closeNextVideoPopup] = useBinaryState(false);
    const [sideDrawerOpen, , closeSideDrawer, toggleSideDrawer] = useBinaryState(false);

    const menusOpen = React.useMemo(() => {
        return optionsMenuOpen || subtitlesMenuOpen || audioMenuOpen || speedMenuOpen || statisticsMenuOpen || castDevicesMenuOpen || sideDrawerOpen || nextVideoPopupOpen || relatedOverlayOpen;
    }, [optionsMenuOpen, subtitlesMenuOpen, audioMenuOpen, speedMenuOpen, statisticsMenuOpen, castDevicesMenuOpen, sideDrawerOpen, nextVideoPopupOpen, relatedOverlayOpen]);

    const closeMenus = React.useCallback(() => {
        closeOptionsMenu();
        closeSubtitlesMenu();
        closeAudioMenu();
        closeSpeedMenu();
        closeStatisticsMenu();
        closeCastDevicesMenu();
        closeSideDrawer();
    }, []);

    const castDevices = React.useMemo(() => {
        return playbackDevices
            .filter(({ type }) => type === 'chromecast' || type === 'tv')
            .sort((a, b) => a.type === b.type ? 0 : a.type === 'chromecast' ? -1 : 1);
    }, [playbackDevices]);
    const [castDevicesSearching, setCastDevicesSearching] = React.useState(false);
    const castDevicesLoading = platform.shell.active && (castDevicesSearching || (streamingServer.playbackDevices !== null && streamingServer.playbackDevices.type === 'Loading'));
    const { streamingUrl: castStreamingUrl, playOnDevice } = usePlayOnDevice(player.selected?.stream ?? null);
    const shellCastSupported = platform.shell.active && castStreamingUrl !== null;
    const refreshCastDevices = React.useCallback(() => {
        if (platform.shell.active) {
            core.transport.dispatch({
                action: 'StreamingServer',
                args: {
                    action: 'RefreshPlaybackDevices',
                }
            });
        }
    }, [platform.shell.active]);
    const onCastDeviceSelected = React.useCallback((deviceId) => {
        playOnDevice(deviceId, video.state.time);
        closeCastDevicesMenu();
    }, [playOnDevice, video.state.time]);
    React.useEffect(() => {
        if (castDevicesMenuOpen && platform.shell.active) {
            setCastDevicesSearching(true);
            refreshCastDevices();
            const interval = setInterval(refreshCastDevices, CAST_DEVICES_REFRESH_INTERVAL);
            const timeout = setTimeout(() => setCastDevicesSearching(false), CAST_DEVICES_REFRESH_INTERVAL);
            return () => {
                clearInterval(interval);
                clearTimeout(timeout);
                setCastDevicesSearching(false);
            };
        }
    }, [castDevicesMenuOpen, refreshCastDevices]);

    const {
        streamSubtitles,
        allSubtitleTracks,
        extraSubtitleTracks,
        selectedExtraSubtitleTrackId,
        subtitlesMenuProps,
    } = useSubtitles({
        player,
        video,
        settings,
        streamStateChanged,
        subtitlePreferenceChanged,
        menusOpen,
        closeMenus,
        closeSubtitlesMenu,
        toggleSubtitlesMenu,
    });

    const nextVideoPopupDismissed = React.useRef(false);
    const defaultAudioTrackSelected = React.useRef(false);
    const playingOnExternalDevice = React.useRef(false);
    const [error, setError] = React.useState(null);

    const VIDEO_SCALES = ['contain', 'cover', 'fill'];
    const VIDEO_SCALE_LABELS = { contain: t('PLAYER_SCALE_FIT'), cover: t('PLAYER_SCALE_CROP'), fill: t('PLAYER_SCALE_STRETCH') };

    const playbackSpeed = React.useRef(video.state.playbackSpeed || 1);
    const pressTimer = React.useRef(null);
    const longPress = React.useRef(false);
    const detailsHold = React.useRef(null);
    const controlBarRef = React.useRef(null);

    const HOLD_DELAY = 400;

    // Continues to the next episode. Fast path: the core engine already
    // produced a player link (provider carried over via bingeGroup match).
    // Fallback: when that link is missing, query the same addon for the next
    // episode and auto-play the stream most similar to the current one —
    // instead of dropping the user on the streams list.
    const navigateToNextEpisode = React.useCallback(async (bingeWatching, ended) => {
        const nextVideoItem = player.nextVideo;
        const deepLinks = nextVideoItem !== null && nextVideoItem !== undefined ? nextVideoItem.deepLinks : null;

        if (ended && !bingeWatching) {
            navigate(-1);
            return;
        }

        if (deepLinks && typeof deepLinks.player === 'string') {
            navigate(toPath(deepLinks.player), { replace: true });
            return;
        }

        const selected = player.selected;
        const streamRequest = selected?.streamRequest ?? null;
        if (nextVideoItem && streamRequest) {
            try {
                const streamsUrl = buildStreamsUrl(streamRequest, nextVideoItem.id);
                if (streamsUrl !== null) {
                    const controller = typeof AbortController === 'function' ? new AbortController() : null;
                    const timeout = controller !== null ? setTimeout(() => controller.abort(), 8000) : null;
                    try {
                        const response = await fetch(streamsUrl, controller !== null ? { signal: controller.signal } : undefined);
                        if (!response.ok) throw new Error('HTTP ' + response.status);
                        const data = await response.json();
                        const chosen = pickBestStream(Array.isArray(data?.streams) ? data.streams : [], selected.stream);
                        if (chosen !== null) {
                            const encoded = await core.transport.encodeStream({
                                name: chosen.name,
                                description: chosen.description,
                                infoHash: chosen.infoHash,
                                fileIdx: chosen.fileIdx,
                                url: chosen.url,
                                externalUrl: chosen.externalUrl,
                                ytId: chosen.ytId
                            });
                            const videoId = streamRequest.path.id;
                            const metaId = videoId.split(':')[0];
                            navigate(
                                `/player/${encodeURIComponent(encoded)}/${encodeURIComponent(streamRequest.base)}/${encodeURIComponent(selected.metaRequest.base)}/${encodeURIComponent(streamRequest.path.type)}/${encodeURIComponent(metaId)}/${encodeURIComponent(videoId)}`,
                                { replace: true }
                            );
                            return;
                        }
                    } finally {
                        if (timeout !== null) clearTimeout(timeout);
                    }
                }
            } catch (_e) {
                // network/encoding failure: fall through to the links list
            }
        }

        if (deepLinks && typeof deepLinks.metaDetailsStreams === 'string') {
            navigate(toPath(deepLinks.metaDetailsStreams), { replace: true });
        }
    }, [player.nextVideo, player.selected, core, navigate]);

    const onEnded = React.useCallback(() => {
        ended();
        if (player.nextVideo !== null) {
            nextVideo();

            navigateToNextEpisode(profile.settings.bingeWatching, true);
        } else if (isSeriesFinale) {
            setRelatedOverlayOpen(true);
        } else {
            navigate(-1);
        }
    }, [player.nextVideo, isSeriesFinale, navigateToNextEpisode, ended, nextVideo, navigate]);

    const onError = React.useCallback((error) => {
        console.error('Player', error);
        if (error.critical) {
            setError(error);
        } else {
            toast.show({
                type: 'error',
                title: t('ERROR'),
                message: error.message,
                timeout: 3000
            });
        }
    }, []);

    const onPlayRequested = React.useCallback(() => {
        playingOnExternalDevice.current = false;
        video.setPaused(false);
        setSeeking(false);
    }, []);

    const onPlayRequestedDebounced = React.useCallback(debounce(onPlayRequested, 200), []);

    const onPauseRequested = React.useCallback(() => {
        video.setPaused(true);
    }, []);

    const onPauseRequestedDebounced = React.useCallback(debounce(onPauseRequested, 200), []);
    const onMuteRequested = React.useCallback(() => {
        video.setMuted(true);
    }, []);

    const onUnmuteRequested = React.useCallback(() => {
        video.setMuted(false);
    }, []);

    const onVolumeChangeRequested = React.useCallback((volume) => {
        video.setVolume(volume);
    }, []);

    const commitSeek = React.useCallback((time) => {
        video.setTime(time);
        seek(time, video.state.duration, video.state.manifest?.name);
    }, [video.state.duration, video.state.manifest]);

    const onSkipSegment = React.useCallback((segment) => {
        if (!segment || typeof segment.endMs !== 'number' || !isFinite(segment.endMs)) {
            return;
        }
        let target = segment.endMs;
        // Never jump across the start of a following segment: if the recap
        // data overlaps the intro, skipping the recap must land at the intro
        // start (its own button takes over), not silently skip both.
        if (Array.isArray(skipSegments)) {
            skipSegments.forEach((other) => {
                if (other === segment || other.type === segment.type) return;
                if (typeof other.startMs !== 'number' || !isFinite(other.startMs)) return;
                if (other.startMs > segment.startMs && other.startMs < target) {
                    target = other.startMs;
                }
            });
        }
        commitSeek(target);
    }, [skipSegments, commitSeek]);

    const {
        time: keyboardSeekTime,
        seekBy: seekByKeyboard,
        seekTo: onSeekRequested,
        cancel: cancelKeyboardSeek,
        flush: flushKeyboardSeek,
        release: releaseKeyboardSeek,
    } = useKeyboardSeek({
        time: video.state.time,
        duration: video.state.duration,
        onSeek: commitSeek,
        setSeeking,
    });
    const onKeyboardSeekRequested = React.useCallback((offset) => {
        setImmersedDebounced.cancel();
        setImmersed(false);
        seekByKeyboard(offset);
    }, [seekByKeyboard]);
    const overlayHidden = React.useMemo(() => {
        return keyboardSeekTime === null && immersed && !casting && video.state.paused !== null && !video.state.paused && !menusOpen;
    }, [keyboardSeekTime, immersed, casting, video.state.paused, menusOpen]);

    // Skip UI is only meaningful once the stream for the current selection
    // is actually Ready — before that, playback state belongs to the
    // previous episode.
    const skipUiAllowed = React.useMemo(() => {
        return player.stream !== null && player.stream.type === 'Ready';
    }, [player.stream]);

    // Playback time is only usable when it is a real finite number — during
    // loads it can be null OR NaN, and NaN silently poisons comparisons.
    const playbackTime = React.useMemo(() => {
        return typeof video.state.time === 'number' && isFinite(video.state.time) ? video.state.time : null;
    }, [video.state.time]);
    const playbackDuration = React.useMemo(() => {
        return typeof video.state.duration === 'number' && isFinite(video.state.duration) ? video.state.duration : null;
    }, [video.state.duration]);

    const activeSkipSegments = React.useMemo(() => {
        if (!skipUiAllowed) return [];
        if (!Array.isArray(skipSegments) || skipSegments.length === 0 || playbackTime === null) return [];
        return skipSegments.filter((segment) =>
            playbackTime >= segment.startMs && (segment.endMs === null || playbackTime < segment.endMs)
        );
    }, [skipUiAllowed, skipSegments, playbackTime]);

    const NEXT_EPISODE_COUNTDOWN_MS = 10000;
    const creditsSegment = React.useMemo(() => {
        return Array.isArray(skipSegments) ?
            skipSegments.find((segment) => segment.type === 'credits' && typeof segment.startMs === 'number' && isFinite(segment.startMs)) ?? null
            :
            null;
    }, [skipSegments]);

    const [nextEpisodeDismissed, setNextEpisodeDismissed] = React.useState(false);
    const autoNextFiredRef = React.useRef(false);
    const videoKey = player?.selected?.streamRequest?.path?.id ?? null;
    // Reset per-episode UI state only when a NEW video actually starts.
    // At the very end of playback the core may unload the stream (videoKey
    // becomes null) — that must NOT close the related overlay.
    const previousVideoKeyRef = React.useRef(videoKey);
    React.useEffect(() => {
        if (videoKey === null || videoKey === previousVideoKeyRef.current) {
            return;
        }
        previousVideoKeyRef.current = videoKey;
        setNextEpisodeDismissed(false);
        autoNextFiredRef.current = false;
        relatedDismissedRef.current = false;
        playbackStartedRef.current = false;
    }, [videoKey]);

    // Series finale: the selected video is the last entry of the series'
    // video list (fallback: no next video from the core). The related
    // overlay is offered (never forced) through a cancellable countdown
    // and a "Related work" pill.
    const isSeriesFinale = React.useMemo(() => {
        const metaContent = player.metaItem !== null && player.metaItem.type === 'Ready' ? player.metaItem.content : null;
        if (metaContent === null || metaContent.type !== 'series' || typeof metaContent.id !== 'string') {
            return false;
        }
        const selectedVideoId = player.selected?.streamRequest?.path?.id ?? null;
        if (typeof selectedVideoId === 'string' && Array.isArray(metaContent.videos) && metaContent.videos.length > 0) {
            const lastVideo = metaContent.videos[metaContent.videos.length - 1];
            return typeof lastVideo?.id === 'string' ? selectedVideoId === lastVideo.id : player.nextVideo === null;
        }
        return player.nextVideo === null;
    }, [player.nextVideo, player.metaItem, player.selected]);
    const [relatedOverlayOpen, setRelatedOverlayOpen] = React.useState(false);
    const relatedDismissedRef = React.useRef(false);
    const onRelatedCancel = React.useCallback(() => {
        relatedDismissedRef.current = true;
        setRelatedOverlayOpen(false);
    }, []);
    const onRelatedShowNow = React.useCallback(() => {
        setRelatedOverlayOpen(true);
    }, []);

    // Countdown runs through the first 10s of the outro. Cancelling stops
    // the countdown and disables the automatic jump for this episode — but
    // the Next Episode button itself stays visible and clickable.
    const nextEpisodeCountdown = React.useMemo(() => {
        if (!skipUiAllowed || !autoNextEnabled || creditsSegment === null || nextEpisodeDismissed || playbackTime === null) return null;
        if (isSeriesFinale) return null;
        const elapsed = playbackTime - creditsSegment.startMs;
        if (elapsed < 0 || elapsed >= NEXT_EPISODE_COUNTDOWN_MS) return null;
        const secondsLeft = Math.ceil((NEXT_EPISODE_COUNTDOWN_MS - elapsed) / 1000);
        return isFinite(secondsLeft) ? Math.max(1, secondsLeft) : null;
    }, [skipUiAllowed, autoNextEnabled, creditsSegment, nextEpisodeDismissed, playbackTime, isSeriesFinale]);

    // Auto-next: when enabled and not cancelled, jump to the end of media
    // once the 10s countdown finishes. Fires once per video. Skipped on a
    // series finale — outro watchers are not dragged to the related offer.
    React.useEffect(() => {
        if (!skipUiAllowed || !autoNextEnabled || creditsSegment === null || nextEpisodeDismissed || autoNextFiredRef.current) return;
        if (isSeriesFinale) return;
        if (playbackTime === null || playbackDuration === null) return;
        if (playbackTime >= creditsSegment.startMs + NEXT_EPISODE_COUNTDOWN_MS) {
            autoNextFiredRef.current = true;
            commitSeek(playbackDuration);
        }
    }, [skipUiAllowed, autoNextEnabled, creditsSegment, nextEpisodeDismissed, playbackTime, playbackDuration, isSeriesFinale]);

    // Manual pill shown during the outro whenever the countdown is not
    // active — including after cancelling auto-next for this episode, so
    // the button remains visible and functional. On a finale the Related
    // work pill takes over instead.
    const showManualNextEpisode = React.useMemo(() => {
        if (!skipUiAllowed || creditsSegment === null || playbackTime === null || playbackDuration === null) return false;
        if (isSeriesFinale) return false;
        return nextEpisodeCountdown === null && playbackTime >= creditsSegment.startMs;
    }, [skipUiAllowed, creditsSegment, playbackTime, playbackDuration, nextEpisodeCountdown, isSeriesFinale]);

    // On a finale the Related work pill appears at the same moment the
    // Next Episode pill normally would: when the credits segment starts
    // (or, without segment data, in the last 3 minutes).
    const showRelatedPill = React.useMemo(() => {
        if (!isSeriesFinale || relatedOverlayOpen || playbackDuration === null || playbackTime === null) {
            return false;
        }
        if (creditsSegment !== null && playbackTime >= creditsSegment.startMs) {
            return true;
        }
        return playbackDuration - playbackTime <= 180;
    }, [isSeriesFinale, relatedOverlayOpen, playbackTime, playbackDuration, creditsSegment]);

    const nextEpisodeElement = showRelatedPill ?
        (
            <NextEpisodeButton
                secondsLeft={null}
                totalSeconds={NEXT_EPISODE_COUNTDOWN_MS / 1000}
                label={t('PLAYER_RELATED_WORK', 'Related work')}
                onClick={onRelatedShowNow}
            />
        )
        :
        (nextEpisodeCountdown !== null || showManualNextEpisode) && playbackDuration !== null ?
            (
                <NextEpisodeButton
                    secondsLeft={nextEpisodeCountdown}
                    totalSeconds={NEXT_EPISODE_COUNTDOWN_MS / 1000}
                    onClick={() => commitSeek(playbackDuration)}
                    onCancel={() => setNextEpisodeDismissed(true)}
                />
            )
            :
            null;

    const skipItems = React.useMemo(() => {
        return activeSkipSegments
            .filter((segment) => segment.type !== 'credits')
            .map((segment) => ({
                key: `${segment.type}:${segment.startMs}`,
                label: segment.type === 'recap' ?
                    t('PLAYER_SKIP_RECAP', 'Skip Recap')
                    :
                    segment.type === 'preview' ?
                        t('PLAYER_SKIP_PREVIEW', 'Skip Preview')
                        :
                        t('PLAYER_SKIP_INTRO', 'Skip Intro'),
                onClick: () => onSkipSegment(segment),
            }));
    }, [activeSkipSegments, onSkipSegment, t]);

    React.useEffect(() => {
        if (!video.state.manifest?.props.includes('subtitlesOffsetMinimum')) {
            return;
        }

        const videoContainerElement = video.containerRef.current;
        const controlBarElement = controlBarRef.current;
        if (!videoContainerElement || !controlBarElement) {
            return;
        }

        const updateSubtitlesOffsetMinimum = () => {
            const videoHeight = videoContainerElement.getBoundingClientRect().height;
            const controlBarHeight = overlayHidden ? 0 : controlBarElement.getBoundingClientRect().height;
            const offsetMinimum = videoHeight > 0 ? Math.ceil(controlBarHeight / videoHeight * 100) : 0;
            video.setSubtitlesOffsetMinimum(offsetMinimum);
        };

        updateSubtitlesOffsetMinimum();

        if (typeof ResizeObserver === 'undefined') {
            window.addEventListener('resize', updateSubtitlesOffsetMinimum);
            return () => window.removeEventListener('resize', updateSubtitlesOffsetMinimum);
        }

        const resizeObserver = new ResizeObserver(updateSubtitlesOffsetMinimum);
        resizeObserver.observe(videoContainerElement);
        resizeObserver.observe(controlBarElement);
        return () => resizeObserver.disconnect();
    }, [overlayHidden, video.state.manifest, video.setSubtitlesOffsetMinimum]);

    const onPlaybackSpeedChanged = React.useCallback((rate, skipUpdate) => {
        video.setPlaybackSpeed(rate);

        if (skipUpdate) return;

        playbackSpeed.current = rate;

    }, []);

    const onVideoScaleChanged = React.useCallback(() => {
        const currentScale = video.state.videoScale || 'contain';
        const currentIndex = VIDEO_SCALES.indexOf(currentScale);
        const nextScale = VIDEO_SCALES[(currentIndex + 1) % VIDEO_SCALES.length];
        video.setVideoScale(nextScale);
    }, [video.state.videoScale]);

    // Persisted player settings: restored once per video as soon as each
    // engine prop reports a real value; saved (debounced) on every change.
    const restoredSettingsRef = React.useRef({});
    // Second restore pass at playback start: mpv only accepts properties
    // reliably once the file is loaded — earlier commands can be dropped
    // (volume) or overwritten later (subtitle styling on
    // implementationChanged), so everything saved is re-applied here.
    const playbackStartedForKeyRef = React.useRef(null);
    const playbackStartedRef = React.useRef(false);
    React.useEffect(() => {
        restoredSettingsRef.current = {};
    }, [videoKey]);
    React.useEffect(() => {
        const restored = restoredSettingsRef.current;
        const tryRestore = (key, currentValue, apply) => {
            if (restored[key] || currentValue === null || currentValue === undefined) {
                return;
            }
            restored[key] = true;
            const saved = readPlayerSettings();
            if (saved[key] !== undefined) {
                apply(saved[key]);
            }
        };
        tryRestore('volume', video.state.volume, (value) => video.setVolume(value));
        tryRestore('muted', video.state.muted, (value) => video.setMuted(value));
        tryRestore('playbackSpeed', video.state.playbackSpeed, (value) => video.setPlaybackSpeed(value));
        tryRestore('videoScale', video.state.videoScale, (value) => video.setVideoScale(value));
        tryRestore('subtitlesSize', video.state.subtitlesSize, (value) => video.setSubtitlesSize(value));
        tryRestore('subtitlesOffset', video.state.subtitlesOffset, (value) => video.setSubtitlesOffset(value));
        tryRestore('subtitlesTextColor', video.state.subtitlesTextColor, (value) => video.setSubtitlesTextColor(value));
        tryRestore('subtitlesBackgroundColor', video.state.subtitlesBackgroundColor, (value) => video.setSubtitlesBackgroundColor(value));
        tryRestore('subtitlesOutlineColor', video.state.subtitlesOutlineColor, (value) => video.setSubtitlesOutlineColor(value));
    }, [video.state]);

    React.useEffect(() => {
        if (typeof video.state.time !== 'number' || !isFinite(video.state.time)) {
            return;
        }
        if (playbackStartedForKeyRef.current === videoKey) {
            return;
        }
        playbackStartedForKeyRef.current = videoKey;

        const saved = readPlayerSettings();
        if (saved.volume !== undefined) video.setVolume(saved.volume);
        if (saved.muted !== undefined) video.setMuted(saved.muted);
        if (saved.playbackSpeed !== undefined) video.setPlaybackSpeed(saved.playbackSpeed);
        if (saved.videoScale !== undefined) video.setVideoScale(saved.videoScale);
        if (saved.subtitlesSize !== undefined) video.setSubtitlesSize(saved.subtitlesSize);
        if (saved.subtitlesOffset !== undefined) video.setSubtitlesOffset(saved.subtitlesOffset);
        if (saved.subtitlesTextColor !== undefined) video.setSubtitlesTextColor(saved.subtitlesTextColor);
        if (saved.subtitlesBackgroundColor !== undefined) video.setSubtitlesBackgroundColor(saved.subtitlesBackgroundColor);
        if (saved.subtitlesOutlineColor !== undefined) video.setSubtitlesOutlineColor(saved.subtitlesOutlineColor);
        if (platform.shell.active) {
            sendSubtitleFontToShell(platform.shell, subtitlesFont);
        }
    }, [video.state.time, videoKey, subtitlesFont, platform.shell.active]);

    React.useEffect(() => {
        if (!playbackStartedRef.current && typeof video.state.time === 'number' && isFinite(video.state.time)) {
            playbackStartedRef.current = true;
        }
    }, [video.state.time]);

    React.useEffect(() => {
        // Never persist before playback started: engine defaults reported
        // early (e.g. volume 50) would overwrite the saved values.
        if (typeof video.state.time !== 'number' || !isFinite(video.state.time)) {
        if (!playbackStartedRef.current) {
            return;
        }
        const timer = setTimeout(() => {
            const partial = {};
            if (video.state.volume !== null) partial.volume = video.state.volume;
            if (video.state.muted !== null) partial.muted = video.state.muted;
            if (video.state.playbackSpeed !== null) partial.playbackSpeed = video.state.playbackSpeed;
            if (video.state.videoScale !== null && video.state.videoScale !== undefined) partial.videoScale = video.state.videoScale;
            if (video.state.subtitlesSize !== null) partial.subtitlesSize = video.state.subtitlesSize;
            if (video.state.subtitlesOffset !== null) partial.subtitlesOffset = video.state.subtitlesOffset;
            if (video.state.subtitlesTextColor !== null) partial.subtitlesTextColor = video.state.subtitlesTextColor;
            if (video.state.subtitlesBackgroundColor !== null) partial.subtitlesBackgroundColor = video.state.subtitlesBackgroundColor;
            if (video.state.subtitlesOutlineColor !== null) partial.subtitlesOutlineColor = video.state.subtitlesOutlineColor;
            writePlayerSettings(partial);
        }, 300);
        return () => clearTimeout(timer);
    }, [
        video.state.time,
        video.state.volume,
        video.state.muted,
        video.state.playbackSpeed,
        video.state.videoScale,
        video.state.subtitlesSize,
        video.state.subtitlesOffset,
        video.state.subtitlesTextColor,
        video.state.subtitlesBackgroundColor,
        video.state.subtitlesOutlineColor
    ]);

    // Subtitle font: applied to native cues (::cue rule injected into the
    // video container) and to DOM-rendered cue layers (which inherit
    // font-family — their inline styles never touch it).
    const [subtitlesFont, setSubtitlesFont] = React.useState(() => {
        const saved = readPlayerSettings();
        return saved.subtitlesFontFamily ?? defaultSubtitleFont(profile.settings?.interfaceLanguage);
    });
    const onSubtitlesFontChanged = React.useCallback((font) => {
        setSubtitlesFont(font);
        writePlayerSettings({ subtitlesFontFamily: font });
    }, []);
    React.useEffect(() => {
        // Desktop shell: video (and subtitles) render natively via mpv, so
        // the font must go through the shell IPC as an mpv property. The
        // DOM/::cue injection below only affects the browser video path.
        if (platform.shell.active) {
            sendSubtitleFontToShell(platform.shell, subtitlesFont);
        }
        const container = video.containerRef.current;
        if (container === null) {
            return;
        }
        const fontStack = subtitleFontStack(subtitlesFont);
        let styleElement = container.querySelector('style[data-subtitle-font]');
        if (styleElement === null) {
            styleElement = document.createElement('style');
            styleElement.setAttribute('data-subtitle-font', '');
            container.appendChild(styleElement);
        }
        styleElement.textContent = `video::cue { font-family: ${fontStack} !important; }`;
        const applyFontFamily = (node) => {
            node.style.fontFamily = fontStack;
        };
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                mutation.addedNodes.forEach((node) => {
                    if (node.nodeType === Node.ELEMENT_NODE && node.tagName !== 'VIDEO' && !(node instanceof HTMLStyleElement)) {
                        applyFontFamily(node);
                    }
                });
            });
        });
        observer.observe(container, { childList: true });
        Array.from(container.children).forEach((child) => {
            if (child.tagName !== 'VIDEO' && child.tagName !== 'STYLE') {
                applyFontFamily(child);
            }
        });
        return () => observer.disconnect();
    }, [subtitlesFont, video.state.manifest, video.containerRef, platform.shell.active]);

    const onAudioTrackSelected = React.useCallback((id) => {
        video.setAudioTrack(id);
        streamStateChanged({
            audioTrack: {
                id,
            },
        });
    }, [streamStateChanged]);

    const onDismissNextVideoPopup = React.useCallback(() => {
        closeNextVideoPopup();
        nextVideoPopupDismissed.current = true;
    }, []);

    const onNextVideoRequested = React.useCallback(() => {
        if (player.nextVideo !== null) {
            cancelKeyboardSeek();
            nextVideo();

            navigateToNextEpisode(profile.settings.bingeWatching, false);
        }
    }, [player.nextVideo, navigateToNextEpisode, profile.settings, cancelKeyboardSeek]);

    const onVideoClick = React.useCallback(() => {
        if (video.state.paused !== null && !longPress.current) {
            if (video.state.paused) {
                onPlayRequestedDebounced();
            } else {
                onPauseRequestedDebounced();
            }
        }
    }, [video.state.paused, longPress.current]);

    const onVideoDoubleClick = React.useCallback(() => {
        onPlayRequestedDebounced.cancel();
        onPauseRequestedDebounced.cancel();
        toggleFullscreen();
    }, [toggleFullscreen]);

    const onContainerMouseDown = React.useCallback((event) => {
        if (!event.nativeEvent.optionsMenuClosePrevented) {
            closeOptionsMenu();
        }
        if (!event.nativeEvent.subtitlesMenuClosePrevented) {
            closeSubtitlesMenu();
        }
        if (!event.nativeEvent.audioMenuClosePrevented) {
            closeAudioMenu();
        }
        if (!event.nativeEvent.speedMenuClosePrevented) {
            closeSpeedMenu();
        }
        if (!event.nativeEvent.statisticsMenuClosePrevented) {
            closeStatisticsMenu();
        }
        if (!event.nativeEvent.castDevicesMenuClosePrevented) {
            closeCastDevicesMenu();
        }

        closeSideDrawer();
    }, []);

    const onContainerMouseMove = React.useCallback((event) => {
        setImmersed(false);
        if (!event.nativeEvent.immersePrevented) {
            setImmersedDebounced(true);
        } else {
            setImmersedDebounced.cancel();
        }
    }, []);

    const onContainerMouseLeave = React.useCallback(() => {
        setImmersedDebounced.cancel();
        setImmersed(true);
    }, []);

    const onBarMouseMove = React.useCallback((event) => {
        event.nativeEvent.immersePrevented = true;
    }, []);

    const onPlayPause = React.useCallback(() => {
        if (!menusOpen && !nextVideoPopupOpen && video.state.paused !== null) {
            if (video.state.paused) {
                onPlayRequested();
                setSeeking(false);
            } else {
                onPauseRequested();
            }
        }
    }, [menusOpen, nextVideoPopupOpen, video.state.paused]);

    const onSeekPrev = React.useCallback((event) => {
        if (!menusOpen && !nextVideoPopupOpen && video.state.time !== null) {
            const seekDuration = event?.shiftKey ? settings.seekShortTimeDuration : settings.seekTimeDuration;
            const seekTime = video.state.time - seekDuration;
            setSeeking(true);
            onSeekRequested(Math.max(seekTime, 0));
        }
    }, [menusOpen, nextVideoPopupOpen, video.state.time]);

    const onSeekNext = React.useCallback((event) => {
        if (!menusOpen && !nextVideoPopupOpen && video.state.time !== null) {
            const seekDuration = event?.shiftKey ? settings.seekShortTimeDuration : settings.seekTimeDuration;
            setSeeking(true);
            onSeekRequested(video.state.time + seekDuration);
        }
    }, [menusOpen, nextVideoPopupOpen, video.state.time]);

    const onVolumeUp = React.useCallback(() => {
        if (!menusOpen && !nextVideoPopupOpen && video.state.volume !== null) {
            onVolumeChangeRequested(Math.min(video.state.volume + 5, 200));
        }
    }, [menusOpen, nextVideoPopupOpen, video.state.volume]);

    const onVolumeDown = React.useCallback(() => {
        if (!menusOpen && !nextVideoPopupOpen && video.state.volume !== null) {
            onVolumeChangeRequested(Math.max(video.state.volume - 5, 0));
        }
    }, [menusOpen, nextVideoPopupOpen, video.state.volume]);

    const onGamepadSeekAndVol = React.useCallback((axis) => {
        switch(axis) {
            case 'left': {
                onSeekPrev();
                break;
            }
            case 'right': {
                onSeekNext();
                break;
            }
            case 'up': {
                onVolumeUp();
                break;
            }
            case 'down': {
                onVolumeDown();
                break;
            }
        }
    }, [onSeekPrev, onSeekNext, onVolumeUp, onVolumeDown]);

    useContentGamepadNavigation(playerRef, GAMEPAD_HANDLER_ID);

    React.useEffect(() => {
        gamepad?.on('buttonX', GAMEPAD_HANDLER_ID, onPlayPause);
        gamepad?.on('analogRight', GAMEPAD_HANDLER_ID, onGamepadSeekAndVol);

        return () => {
            gamepad?.off('buttonX', GAMEPAD_HANDLER_ID);
            gamepad?.off('analogRight', GAMEPAD_HANDLER_ID);
        };
    }, [onPlayPause, onGamepadSeekAndVol]);

    React.useEffect(() => {
        setError(null);
        cancelKeyboardSeek();
        video.unload();

        if (player.selected && player.stream?.type === 'Ready' && streamingServer.settings?.type !== 'Loading') {
            video.load({
                stream: {
                    ...player.stream.content,
                    subtitles: streamSubtitles
                },
                autoplay: true,
                time: player.libraryItem !== null &&
                    player.selected.streamRequest !== null &&
                    player.selected.streamRequest.path !== null &&
                    player.libraryItem.state.video_id === player.selected.streamRequest.path.id ?
                    player.libraryItem.state.timeOffset
                    :
                    0,
                forceTranscoding: forceTranscoding || casting,
                maxAudioChannels: settings.surroundSound ? 32 : 2,
                hardwareDecoding: settings.hardwareDecoding,
                assSubtitlesStyling: settings.assSubtitlesStyling,
                gpuVideoProcessing: settings.gpuVideoProcessing && platform.shell.capabilities.gpuVideoProcessing,
                videoMode: settings.videoMode,
                platform: platform.name,
                streamingServerURL: streamingServer.baseUrl ?
                    casting ?
                        streamingServer.baseUrl
                        :
                        streamingServer.selected.transportUrl
                    :
                    null,
                seriesInfo: player.seriesInfo,
            }, {
                chromecastTransport: services.chromecast.active ? services.chromecast.transport : null,
                shellTransport: platform.shell.active ? platform.shell : null,
            });
        }
    }, [streamingServer.baseUrl, player.selected, player.stream, streamSubtitles, forceTranscoding, casting, cancelKeyboardSeek]);

    React.useEffect(() => {
        !seeking && timeChanged(video.state.time, video.state.duration, video.state.manifest?.name);
    }, [video.state.time, video.state.duration, video.state.manifest, seeking]);

    React.useEffect(() => {
        if (playingOnExternalDevice.current && video.state.paused === false) {
            onPauseRequested();
        } else if (video.state.paused !== null) {
            pausedChanged(video.state.paused);
        }
    }, [video.state.paused]);

    React.useEffect(() => {
        videoParamsChanged(video.state.videoParams);
    }, [video.state.videoParams]);

    React.useEffect(() => {
        if (player.nextVideo !== null && !nextVideoPopupDismissed.current) {
            if (video.state.time !== null && video.state.duration !== null && video.state.time < video.state.duration && (video.state.duration - video.state.time) <= settings.nextVideoNotificationDuration) {
                openNextVideoPopup();
            } else {
                closeNextVideoPopup();
            }
        }
    }, [player.nextVideo, video.state.time, video.state.duration]);

    // Auto audio track selection
    React.useEffect(() => {
        if (!defaultAudioTrackSelected.current) {
            const savedTrackId = player.streamState?.audioTrack?.id;
            const savedTrack = savedTrackId ? findTrackById(video.state.audioTracks, savedTrackId) : null;
            const audioTrack = savedTrack ?? findTrackByLang(video.state.audioTracks, settings.audioLanguage);

            if (audioTrack && audioTrack.id) {
                video.setAudioTrack(audioTrack.id);
                defaultAudioTrackSelected.current = true;
            }
        }
    }, [video.state.audioTracks, player.streamState]);

    React.useEffect(() => {
        defaultAudioTrackSelected.current = false;
        nextVideoPopupDismissed.current = false;
        playingOnExternalDevice.current = false;
    }, [video.state.stream]);

    React.useEffect(() => {
        if (!Array.isArray(video.state.audioTracks) || video.state.audioTracks.length === 0) {
            closeAudioMenu();
        }
    }, [video.state.audioTracks]);

    React.useEffect(() => {
        if (video.state.playbackSpeed === null) {
            closeSpeedMenu();
        }
    }, [video.state.playbackSpeed]);

    React.useEffect(() => {
        const toastFilter = (item) => item?.dataset?.type === 'CoreEvent';
        toast.addFilter(toastFilter);
        const onCastStateChange = () => {
            setCasting(services.chromecast.active && services.chromecast.transport.getCastState() === cast.framework.CastState.CONNECTED);
        };
        const onChromecastServiceStateChange = () => {
            onCastStateChange();
            if (services.chromecast.active) {
                services.chromecast.transport.on(
                    cast.framework.CastContextEventType.CAST_STATE_CHANGED,
                    onCastStateChange
                );
            }
        };
        const onCoreEvent = (name) => {
            if (name === 'PlayingOnDevice') {
                playingOnExternalDevice.current = true;
                onPauseRequested();
            }
        };
        services.chromecast.on('stateChanged', onChromecastServiceStateChange);
        core.on('event', onCoreEvent);
        onChromecastServiceStateChange();
        return () => {
            toast.removeFilter(toastFilter);
            services.chromecast.off('stateChanged', onChromecastServiceStateChange);
            core.off('event', onCoreEvent);
            if (services.chromecast.active) {
                services.chromecast.transport.off(
                    cast.framework.CastContextEventType.CAST_STATE_CHANGED,
                    onCastStateChange
                );
            }
        };
    }, []);

    React.useEffect(() => {
        if (settings.pauseOnMinimize && (platform.shell.state.windowClosed || platform.shell.state.windowHidden)) {
            onPauseRequested();
        }
    }, [settings.pauseOnMinimize, platform.shell.state.windowClosed, platform.shell.state.windowHidden]);

    React.useEffect(() => {
        if (video.state.stream === null || typeof player?.title !== 'string') {
            discordTimestamps.current = EMPTY_DISCORD_TIMESTAMPS;
            discord.setActivity(null);
            return;
        }

        const metaItem = player.metaItem?.type === 'Ready' ? player.metaItem.content : null;
        const { activity, timestamps } = getPlaybackDiscordActivity({
            title: player.title,
            image: metaItem?.poster || metaItem?.background || null,
            paused: video.state.paused,
            time: video.state.time,
            duration: video.state.duration,
            timestamps: discordTimestamps.current,
        });

        discordTimestamps.current = timestamps;
        discord.setActivity(activity);
    }, [discord.setActivity, player?.title, player.metaItem, video.state.duration, video.state.paused, video.state.stream, video.state.time]);

    React.useEffect(() => {
        return () => {
            discord.setActivity(null);
        };
    }, [discord.setActivity]);

    useMediaSession(video.state, player, fullscreen, onPlayRequested, onPauseRequested, onNextVideoRequested);

    React.useEffect(() => {
        const onMediaKey = (action) => {
            switch (action) {
                case 'play-pause':
                    if (video.state.paused !== null) {
                        video.state.paused ? onPlayRequested() : onPauseRequested();
                    }
                    break;
                case 'play':
                    onPlayRequested();
                    break;
                case 'pause':
                    onPauseRequested();
                    break;
                case 'next-track':
                    if (player.nextVideo !== null) {
                        video.setTime(0);
                        onNextVideoRequested();
                    }
                    break;
            }
        };
        platform.shell.on('media-key', onMediaKey);
        return () => platform.shell.off('media-key', onMediaKey);
    }, [video.state.paused, player.nextVideo, onPlayRequested, onPauseRequested, onNextVideoRequested]);

    onShortcut('seekForward', (combo) => {
        const seekDuration = combo === 1 ? settings.seekShortTimeDuration : settings.seekTimeDuration;
        onKeyboardSeekRequested(seekDuration);
    }, [settings.seekShortTimeDuration, settings.seekTimeDuration, onKeyboardSeekRequested], !menusOpen);

    onShortcut('seekBackward', (combo) => {
        const seekDuration = combo === 1 ? settings.seekShortTimeDuration : settings.seekTimeDuration;
        onKeyboardSeekRequested(-seekDuration);
    }, [settings.seekShortTimeDuration, settings.seekTimeDuration, onKeyboardSeekRequested], !menusOpen);

    onShortcut('mute', () => {
        video.state.muted === true ? onUnmuteRequested() : onMuteRequested();
    }, [video.state.muted], !menusOpen);

    onShortcut('volume', (combo) => {
        if (video.state.volume !== null) {
            const volume = combo === 0 ? Math.min(video.state.volume + 5, 200) : Math.max(video.state.volume - 5, 0);
            onVolumeChangeRequested(volume);
        }
    }, [video.state.volume], !menusOpen);

    onShortcut('audioMenu', () => {
        closeMenus();
        if (video.state?.audioTracks?.length > 0) {
            toggleAudioMenu();
        }
    }, [video.state.audioTracks, toggleAudioMenu]);

    onShortcut('infoMenu', () => {
        closeMenus();
        if (player.metaItem?.type === 'Ready') {
            toggleSideDrawer();
        }
    }, [player.metaItem, toggleSideDrawer]);

    onShortcut('speedMenu', () => {
        closeMenus();
        if (video.state.playbackSpeed !== null) {
            toggleSpeedMenu();
        }
    }, [video.state.playbackSpeed, toggleSpeedMenu]);

    onShortcut('speed', (combo) => {
        if (video.state.playbackSpeed !== null) {
            const speed = combo === 0 ? Math.max(video.state.playbackSpeed - 0.25, 0.25) : Math.min(video.state.playbackSpeed + 0.25, 2);
            onPlaybackSpeedChanged(speed);
        }
    }, [video.state.playbackSpeed, onPlaybackSpeedChanged], !menusOpen);

    const selectedStream = player.selected?.stream;
    const statisticsMenuAvailable = streamingServer?.statistics?.type !== 'Err'
        && typeof selectedStream?.infoHash === 'string'
        && typeof selectedStream?.fileIdx === 'number';

    const finishDetailsHold = React.useCallback(() => {
        const hold = detailsHold.current;
        if (hold === null) return null;

        detailsHold.current = null;
        if (hold.phase === 'pending') {
            clearTimeout(hold.timer);
        } else {
            closeStatisticsMenu();
        }
        return hold.phase;
    }, [closeStatisticsMenu]);

    const releaseDetailsHold = React.useCallback(() => {
        if (finishDetailsHold() !== 'pending') return;

        closeMenus();
        if (statisticsMenuAvailable) {
            toggleStatisticsMenu();
        }
    }, [finishDetailsHold, closeMenus, statisticsMenuAvailable, toggleStatisticsMenu]);

    onShortcut('statisticsMenu', () => {
        if (detailsHold.current !== null || pressTimer.current !== null) return;

        const hold = { phase: 'pending', timer: null };
        hold.timer = setTimeout(() => {
            hold.phase = 'held';
            hold.timer = null;
            if (statisticsMenuAvailable) {
                closeMenus();
                openStatisticsMenu();
            }
        }, HOLD_DELAY);
        detailsHold.current = hold;
    }, [statisticsMenuAvailable, closeMenus, openStatisticsMenu], routeFocused);

    onShortcut('playNext', () => {
        closeMenus();
        if (player.nextVideo !== null) {
            nextVideo();
            navigateToNextEpisode(false, false);
        }
    }, [player.nextVideo, navigateToNextEpisode]);

    onShortcut('exit', () => {
        closeMenus();
        // When escExitFullscreen is enabled, FullscreenProvider handles the first
        // Escape press by leaving fullscreen. Only skip navigating back in that case,
        // otherwise Escape would never exit the player in windowed mode.
        if (settings.escExitFullscreen && fullscreen) {
            return;
        }
        navigate(-1);
    }, [settings.escExitFullscreen, fullscreen]);

    React.useLayoutEffect(() => {
        if (!routeFocused) {
            finishDetailsHold();
        }

        if (menusOpen) {
            clearTimeout(pressTimer.current);
            pressTimer.current = null;
            longPress.current = false;
        }

        const onKeyDown = (e) => {
            const keyboardKey = getKeyboardShortcutKey(e);
            if (keyboardKey !== 'Space' || e.repeat) return;
            if (menusOpen || detailsHold.current !== null || e.ctrlKey || e.metaKey || e.altKey) return;

            longPress.current = false;

            pressTimer.current = setTimeout(() => {
                longPress.current = true;
                onPlaybackSpeedChanged(2, true);
            }, HOLD_DELAY);
        };

        const onKeyUp = (e) => {
            const keyboardKeys = getKeyboardShortcutKeys(e);

            if (keyboardKeys.includes('KeyD') || keyboardKeys.includes('D')) {
                releaseDetailsHold();
                return;
            }

            if (!keyboardKeys.includes('Space') && !keyboardKeys.includes('ArrowRight') && !keyboardKeys.includes('ArrowLeft')) return;
            if (e.ctrlKey || e.metaKey || e.altKey) return;

            if (keyboardKeys.includes('ArrowRight') || keyboardKeys.includes('ArrowLeft')) {
                releaseKeyboardSeek();
                setImmersed(false);
                setImmersedDebounced(true);
                return;
            }
            if (keyboardKeys.includes('Space')) {
                clearTimeout(pressTimer.current);
                pressTimer.current = null;
                if (longPress.current) {
                    onPlaybackSpeedChanged(playbackSpeed.current);
                } else if (!menusOpen && video.state.paused !== null) {
                    if (video.state.paused) {
                        onPlayRequested();
                        setSeeking(false);
                    } else {
                        onPauseRequested();
                    }
                }
                longPress.current = false;
            }
        };

        const onWheel = ({ deltaY }) => {
            if (menusOpen || video.state.volume === null) return;

            if (deltaY > 0) {
                onVolumeChangeRequested(Math.max(video.state.volume - 5, 0));
            } else {
                if (video.state.volume < 100) {
                    onVolumeChangeRequested(Math.min(video.state.volume + 5, 100));
                }
            }
        };

        const onMouseDownHold = (e) => {
            if (e.button !== 0) return; // left mouse button only
            if (menusOpen || detailsHold.current !== null) return;
            if (controlBarRef.current && controlBarRef.current.contains(e.target)) return;

            longPress.current = false;

            pressTimer.current = setTimeout(() => {
                longPress.current = true;
                onPlaybackSpeedChanged(2, true);
            }, HOLD_DELAY);
        };

        const onMouseUp = (e) => {
            if (e.button !== 0) return;

            clearTimeout(pressTimer.current);
            pressTimer.current = null;

            if (longPress.current) {
                onPlaybackSpeedChanged(playbackSpeed.current);
            }
        };

        const onBlur = () => {
            clearTimeout(pressTimer.current);
            pressTimer.current = null;
            if (longPress.current) {
                onPlaybackSpeedChanged(playbackSpeed.current);
                longPress.current = false;
            }
            finishDetailsHold();
            flushKeyboardSeek();
            setImmersed(false);
            setImmersedDebounced(true);
        };

        if (routeFocused) {
            window.addEventListener('keyup', onKeyUp);
            window.addEventListener('keydown', onKeyDown);
            window.addEventListener('wheel', onWheel);
            window.addEventListener('mousedown', onMouseDownHold);
            window.addEventListener('mouseup', onMouseUp);
            window.addEventListener('blur', onBlur);
        } else {
            cancelKeyboardSeek();
        }
        return () => {
            window.removeEventListener('keyup', onKeyUp);
            window.removeEventListener('keydown', onKeyDown);
            window.removeEventListener('wheel', onWheel);
            window.removeEventListener('mousedown', onMouseDownHold);
            window.removeEventListener('mouseup', onMouseUp);
            window.removeEventListener('blur', onBlur);
        };
    }, [routeFocused, menusOpen, video.state.volume, video.state.paused, finishDetailsHold, releaseDetailsHold, cancelKeyboardSeek, flushKeyboardSeek, releaseKeyboardSeek]);

    React.useEffect(() => {
        video.events.on('error', onError);
        video.events.on('ended', onEnded);

        return () => {
            video.events.off('error', onError);
            video.events.off('ended', onEnded);
        };
    }, [onEnded]);

    React.useLayoutEffect(() => {
        return () => {
            clearTimeout(detailsHold.current?.timer);
            setImmersedDebounced.cancel();
            onPlayRequestedDebounced.cancel();
            onPauseRequestedDebounced.cancel();
        };
    }, []);

    return (
        <div ref={playerRef} className={classnames(styles['player-container'], { [styles['overlayHidden']]: overlayHidden })}
            onMouseDown={onContainerMouseDown}
            onMouseMove={onContainerMouseMove}
            onMouseOver={onContainerMouseMove}
            onMouseLeave={onContainerMouseLeave}>
            <Video
                ref={video.containerRef}
                className={styles['layer']}
                onClick={onVideoClick}
                onDoubleClick={onVideoDoubleClick}
            />
            {
                !video.state.loaded ?
                    <div className={classnames(styles['layer'], styles['background-layer'])}>
                        <img className={styles['image']} src={player?.metaItem?.content?.background} />
                    </div>
                    :
                    null
            }
            {
                (video.state.buffering || !video.state.loaded) && !error ?
                    <Buffering
                        ref={bufferingRef}
                        className={classnames(styles['layer'], styles['buffering-layer'])}
                        logo={player?.metaItem?.content?.logo}
                        progress={statistics.progress}
                    />
                    :
                    null
            }
            {
                error !== null ?
                    <Error
                        ref={errorRef}
                        className={classnames(styles['layer'], styles['error-layer'])}
                        stream={video.state.stream}
                        {...error}
                    />
                    :
                    null
            }
            {
                menusOpen ?
                    <div className={styles['layer']} />
                    :
                    null
            }
            {
                video.state.volume !== null && overlayHidden ?
                    <VolumeChangeIndicator
                        muted={video.state.muted}
                        volume={video.state.volume}
                    />
                    :
                    null
            }
            <ContextMenu on={[video.containerRef, bufferingRef, errorRef]} autoClose>
                <OptionsMenu
                    className={classnames(styles['layer'], styles['menu-layer'])}
                    stream={player?.selected?.stream}
                    playbackDevices={playbackDevices}
                    extraSubtitlesTracks={extraSubtitleTracks}
                    selectedExtraSubtitlesTrackId={selectedExtraSubtitleTrackId}
                    autoNextEnabled={autoNextEnabled}
                    onToggleAutoNext={onToggleAutoNext}
                />
            </ContextMenu>
            <HorizontalNavBar
                className={classnames(styles['layer'], styles['nav-bar-layer'])}
                title={player.title !== null ? player.title : ''}
                backButton={true}
                fullscreenButton={true}
                hdrInfo={video.state.hdrInfo}
                onMouseMove={onBarMouseMove}
                onMouseOver={onBarMouseMove}
            />
            {
                player.metaItem?.type === 'Ready' ?
                    <SideDrawerButton
                        className={classnames(styles['layer'], styles['side-drawer-button-layer'])}
                        onClick={toggleSideDrawer}
                    />
                    :
                    null
            }
            <ControlBar
                ref={controlBarRef}
                className={classnames(styles['layer'], styles['control-bar-layer'])}
                paused={video.state.paused}
                time={keyboardSeekTime ?? video.state.time}
                duration={video.state.duration}
                buffered={video.state.buffered}
                skipSegments={skipSegments}
                volume={video.state.volume}
                muted={video.state.muted}
                playbackSpeed={video.state.playbackSpeed}
                subtitlesTracks={allSubtitleTracks}
                audioTracks={video.state.audioTracks}
                metaItem={player.metaItem}
                nextVideo={player.nextVideo}
                stream={player.selected !== null ? player.selected.stream : null}
                statistics={statistics}
                onPlayRequested={onPlayRequested}
                onPauseRequested={onPauseRequested}
                onNextVideoRequested={onNextVideoRequested}
                onMuteRequested={onMuteRequested}
                onUnmuteRequested={onUnmuteRequested}
                onVolumeChangeRequested={onVolumeChangeRequested}
                onSeekRequested={onSeekRequested}
                onToggleOptionsMenu={toggleOptionsMenu}
                shellCastSupported={shellCastSupported}
                onToggleCastDevicesMenu={toggleCastDevicesMenu}
                onToggleSubtitlesMenu={toggleSubtitlesMenu}
                onToggleAudioMenu={toggleAudioMenu}
                onToggleSpeedMenu={toggleSpeedMenu}
                videoScale={video.state.videoScale}
                videoScaleLabel={VIDEO_SCALE_LABELS[video.state.videoScale || 'contain']}
                onVideoScaleChanged={onVideoScaleChanged}
                onToggleStatisticsMenu={toggleStatisticsMenu}
                onToggleSideDrawer={toggleSideDrawer}
                onMouseMove={onBarMouseMove}
                onMouseOver={onBarMouseMove}
                onTouchEnd={onContainerMouseLeave}
            />
            <Indicator
                className={classnames(styles['layer'], styles['indicator-layer'])}
                videoState={video.state}
                disabled={subtitlesMenuOpen}
            />
            {
                (skipSegments !== null && skipSegments.length > 0) || nextEpisodeElement !== null ?
                    <SkipIntroButton
                        className={classnames(styles['layer'], styles['skip-intro-layer'])}
                        items={skipItems}
                        prepend={nextEpisodeElement}
                    />
                    :
                    null
            }
            {
                nextVideoPopupOpen ?
                    <NextVideoPopup
                        className={classnames(styles['layer'], styles['menu-layer'])}
                        metaItem={player.metaItem !== null && player.metaItem.type === 'Ready' ? player.metaItem.content : null}
                        nextVideo={player.nextVideo}
                        onDismiss={onDismissNextVideoPopup}
                        onNextVideoRequested={onNextVideoRequested}
                    />
                    :
                    null
            }
            {
                relatedOverlayOpen && player.metaItem !== null && player.metaItem.type === 'Ready' ?
                    ReactDOM.createPortal(
                        <RelatedOverlay
                            metaItem={player.metaItem.content}
                            onClose={onRelatedCancel}
                        />,
                        document.body
                    )
                    :
                    null
            }
            <Transition when={statisticsMenuOpen} name={'fade'}>
                <StatisticsMenu
                    className={classnames(styles['layer'], styles['menu-layer'])}
                    {...statistics}
                />
            </Transition>
            <Transition when={castDevicesMenuOpen} name={'fade'}>
                <CastDevicesMenu
                    className={classnames(styles['layer'], styles['menu-layer'])}
                    devices={castDevices}
                    loading={castDevicesLoading}
                    onDeviceSelected={onCastDeviceSelected}
                />
            </Transition>
            <Transition when={sideDrawerOpen} name={'slide-left'}>
                <SideDrawer
                    className={classnames(styles['layer'], styles['side-drawer-layer'])}
                    metaItem={player.metaItem?.content}
                    seriesInfo={player.seriesInfo}
                    closeSideDrawer={closeSideDrawer}
                    selected={player.selected?.streamRequest?.path?.id}
                />
            </Transition>
            <Transition when={subtitlesMenuOpen} name={'fade'}>
                <SubtitlesMenu
                    className={classnames(styles['layer'], styles['menu-layer'])}
                    {...subtitlesMenuProps}
                    subtitlesFontFamily={subtitlesFont}
                    onSubtitlesFontChanged={onSubtitlesFontChanged}
                />
            </Transition>
            <Transition when={audioMenuOpen} name={'fade'}>
                <AudioMenu
                    className={classnames(styles['layer'], styles['menu-layer'])}
                    audioTracks={video.state.audioTracks}
                    selectedAudioTrackId={video.state.selectedAudioTrackId}
                    onAudioTrackSelected={onAudioTrackSelected}
                />
            </Transition>
            <Transition when={speedMenuOpen} name={'fade'}>
                <SpeedMenu
                    className={classnames(styles['layer'], styles['menu-layer'])}
                    playbackSpeed={video.state.playbackSpeed}
                    onPlaybackSpeedChanged={onPlaybackSpeedChanged}
                />
            </Transition>
            <Transition when={optionsMenuOpen} name={'fade'}>
                <OptionsMenu
                    className={classnames(styles['layer'], styles['menu-layer'])}
                    stream={player.selected?.stream}
                    playbackDevices={playbackDevices}
                    extraSubtitlesTracks={extraSubtitleTracks}
                    selectedExtraSubtitlesTrackId={selectedExtraSubtitleTrackId}
                    autoNextEnabled={autoNextEnabled}
                    onToggleAutoNext={onToggleAutoNext}
                />
            </Transition>
        </div>
    );
};

const PlayerFallback = () => (
    <div className={classnames(styles['player-container'])} />
);

module.exports = withCoreSuspender(Player, PlayerFallback);
