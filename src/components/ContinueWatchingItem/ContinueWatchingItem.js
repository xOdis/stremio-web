// Copyright (C) 2017-2023 Smart code 203358507

const React = require('react');
const PropTypes = require('prop-types');
const { useCore } = require('stremio/core');
const LibItem = require('stremio/components/LibItem');

const EPISODE_ID_PATTERN = /^(tt\d+):(\d+):(\d+)$/;
const FETCH_TIMEOUT_MS = 8000;

// imdbId -> Promise<Video[] | null>, shared across all cards.
const seriesVideosCache = new Map();

const fetchSeriesVideos = (imdbId) => {
    let promise = seriesVideosCache.get(imdbId);
    if (!promise) {
        const controller = typeof AbortController === 'function' ? new AbortController() : null;
        const timer = controller !== null ? setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS) : null;
        promise = fetch(`https://v3-cinemeta.strem.io/meta/series/${imdbId}.json`, controller !== null ? { signal: controller.signal } : undefined)
            .then((response) => {
                if (!response.ok) throw new Error('HTTP ' + response.status);
                return response.json();
            })
            .then((data) => Array.isArray(data?.meta?.videos) ? data.meta.videos : null)
            .catch(() => null)
            .finally(() => {
                if (timer !== null) clearTimeout(timer);
            });
        seriesVideosCache.set(imdbId, promise);
    }
    return promise;
};

// Series items carry a video id like "tt1234567:2:5"; movies are just "tt...".
// Falls back to scanning the player deep link when state is unavailable.
const parseEpisodeInfo = ({ state, deepLinks }) => {
    const videoId = state?.video_id;
    if (typeof videoId === 'string') {
        const match = videoId.match(EPISODE_ID_PATTERN);
        if (match !== null) {
            return { imdbId: match[1], season: parseInt(match[2], 10), episode: parseInt(match[3], 10) };
        }
        return null;
    }

    const playerLink = deepLinks?.player;
    if (typeof playerLink === 'string') {
        try {
            const match = decodeURIComponent(playerLink).match(/(tt\d+):(\d+):(\d+)/);
            if (match !== null) {
                return { imdbId: match[1], season: parseInt(match[2], 10), episode: parseInt(match[3], 10) };
            }
        } catch (_e) {
            // malformed deep link, ignore
        }
    }

    return null;
};

const ContinueWatchingItem = ({ _id, notifications, ...props }) => {
    const core = useCore();

    const episodeInfo = React.useMemo(() => {
        return parseEpisodeInfo({ state: props.state, deepLinks: props.deepLinks });
    }, [props.state?.video_id, props.deepLinks?.player]);

    const [episodeTitle, setEpisodeTitle] = React.useState(null);

    React.useEffect(() => {
        setEpisodeTitle(null);
        if (episodeInfo === null) {
            return;
        }

        let cancelled = false;
        fetchSeriesVideos(episodeInfo.imdbId).then((videos) => {
            if (cancelled || !Array.isArray(videos)) {
                return;
            }
            const video = videos.find((candidate) =>
                parseInt(candidate.season, 10) === episodeInfo.season &&
                parseInt(candidate.episode, 10) === episodeInfo.episode
            );
            if (!cancelled && video) {
                setEpisodeTitle(video.name || video.title || null);
            }
        });

        return () => {
            cancelled = true;
        };
    }, [episodeInfo?.imdbId, episodeInfo?.season, episodeInfo?.episode]);

    const subtitleBadge = React.useMemo(() => {
        return episodeInfo !== null ? `S${episodeInfo.season}:E${episodeInfo.episode}` : null;
    }, [episodeInfo]);

    const onDismissClick = React.useCallback((event) => {
        event.preventDefault();
        if (typeof _id === 'string') {
            core.transport.dispatch({
                action: 'Ctx',
                args: {
                    action: 'RewindLibraryItem',
                    args: _id
                }
            });
            core.transport.dispatch({
                action: 'Ctx',
                args: {
                    action: 'DismissNotificationItem',
                    args: _id
                }
            });
        }
    }, [_id]);

    return (
        <LibItem
            {...props}
            _id={_id}
            posterChangeCursor={true}
            notifications={notifications}
            subtitleLabel={subtitleBadge}
            subtitleTitle={episodeTitle}
            onDismissClick={onDismissClick}
        />
    );
};

ContinueWatchingItem.propTypes = {
    _id: PropTypes.string,
    notifications: PropTypes.object,
    state: PropTypes.shape({
        video_id: PropTypes.string
    }),
    deepLinks: PropTypes.shape({
        metaDetailsVideos: PropTypes.string,
        metaDetailsStreams: PropTypes.string,
        player: PropTypes.string
    }),
};

module.exports = ContinueWatchingItem;
