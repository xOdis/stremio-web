// Copyright (C) 2017-2023 Smart code 203358507

const React = require('react');
const { createIntroDbClient } = require('theintrodb');

// v2: invalidates empty results cached by the single-provider era, which
// blocked re-fetching from the additional sources.
const CACHE_PREFIX = 'skip_segments_v3_';
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const PROVIDER_TIMEOUT_MS = 8000;

const SEGMENT_TYPES = ['intro', 'recap', 'credits', 'preview'];

const client = createIntroDbClient();

const parseVideoId = (videoId) => {
    if (typeof videoId !== 'string' || !videoId.startsWith('tt')) {
        return null;
    }

    const parts = videoId.split(':');
    const imdbId = parts[0];

    if (parts.length >= 3) {
        const season = parseInt(parts[1], 10);
        const episode = parseInt(parts[2], 10);
        if (!isNaN(season) && !isNaN(episode)) {
            return { imdbId, season, episode };
        }
    }

    return { imdbId, season: null, episode: null };
};

const getCached = (key) => {
    try {
        const raw = localStorage.getItem(key);
        if (!raw) return null;
        const data = JSON.parse(raw);
        if (Date.now() - data.fetchedAt > CACHE_TTL_MS) {
            localStorage.removeItem(key);
            return null;
        }
        return data.segments;
    } catch (_e) {
        return null;
    }
};

const setCached = (key, segments) => {
    try {
        localStorage.setItem(key, JSON.stringify({ segments, fetchedAt: Date.now() }));
    } catch (_e) {
        // storage full or unavailable
    }
};

const fetchJson = async (url) => {
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controller !== null ? setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS) : null;
    try {
        const resp = await fetch(url, controller !== null ? { signal: controller.signal } : undefined);
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        return await resp.json();
    } finally {
        if (timer !== null) clearTimeout(timer);
    }
};

// Every provider normalizes to: { [segmentType]: [{ type, startMs, endMs }] }

const fromTheIntroDb = async (parsed, duration) => {
    const params = { imdbId: parsed.imdbId };
    if (parsed.season !== null) params.season = parsed.season;
    if (parsed.episode !== null) params.episode = parsed.episode;
    if (typeof duration === 'number' && isFinite(duration)) params.durationMs = Math.round(duration);

    const media = await client.getMedia(params);

    const result = {};
    SEGMENT_TYPES.forEach((type) => {
        result[type] = (Array.isArray(media?.[type]) ? media[type] : [])
            .map((entry) => ({
                startMs: typeof entry?.startMs === 'number' ? entry.startMs : 0,
                endMs: typeof entry?.endMs === 'number' ? entry.endMs : null,
            }))
            // Only credits may extend to end-of-media (null end); a recap or
            // intro without an end would make "skip" jump to the video end.
            .filter((segment) => segment.endMs === null ? type === 'credits' : segment.endMs > segment.startMs)
            .map((segment) => ({ ...segment, type }));
    });
    return result;
};

const fromSkipDb = async (parsed, duration) => {
    const query = new URLSearchParams({ imdb_id: parsed.imdbId });
    if (parsed.season !== null) query.set('season', String(parsed.season));
    if (parsed.episode !== null) query.set('episode', String(parsed.episode));
    if (typeof duration === 'number' && isFinite(duration)) query.set('duration', String(Math.round(duration / 1000)));

    // SkipDB maps "outro" to what we call credits.
    const data = await fetchJson('https://skipdb.tv/api/segments?' + query.toString());
    const provided = data && typeof data.segments === 'object' && data.segments !== null ? data.segments : {};

    const mapType = { intro: 'intro', recap: 'recap', outro: 'credits', preview: 'preview' };
    const result = {};
    Object.keys(mapType).forEach((rawType) => {
        const type = mapType[rawType];
        const entry = provided[rawType];
        if (!entry || typeof entry !== 'object') {
            result[type] = [];
            return;
        }
        const startMs = typeof entry.start_ms === 'number' ? entry.start_ms : 0;
        const endMs = typeof entry.end_ms === 'number' ? entry.end_ms : null;
        if (endMs !== null && endMs <= startMs) {
            result[type] = [];
            return;
        }
        // Only credits may extend to end-of-media (null end).
        if (endMs === null && type !== 'credits') {
            result[type] = [];
            return;
        }
        result[type] = [{ type, startMs, endMs }];
    });
    return result;
};

const fromIntroDbApp = async (parsed) => {
    const query = new URLSearchParams({ imdb_id: parsed.imdbId });
    if (parsed.season !== null) query.set('season', String(parsed.season));
    if (parsed.episode !== null) query.set('episode', String(parsed.episode));

    // api.introdb.app only allows its own origin, so it goes through our
    // same-origin proxy (see http_server.js).
    const data = await fetchJson('/proxy/introdb/segments?' + query.toString());

    const mapType = { intro: 'intro', recap: 'recap', outro: 'credits' };
    const result = { preview: [] };
    Object.keys(mapType).forEach((rawType) => {
        const type = mapType[rawType];
        const entry = data && typeof data === 'object' ? data[rawType] : null;
        if (!entry || typeof entry !== 'object') {
            result[type] = [];
            return;
        }
        const startMs = typeof entry.start_ms === 'number' ? entry.start_ms : 0;
        const endMs = typeof entry.end_ms === 'number' ? entry.end_ms : null;
        if (endMs !== null && endMs <= startMs) {
            result[type] = [];
            return;
        }
        // Only credits may extend to end-of-media (null end).
        if (endMs === null && type !== 'credits') {
            result[type] = [];
            return;
        }
        result[type] = [{ type, startMs, endMs }];
    });
    return result;
};

// First provider that has a given segment type wins.
const mergeProviderResults = (results) => {
    const byType = {};
    SEGMENT_TYPES.forEach((type) => {
        for (const result of results) {
            if (Array.isArray(result[type]) && result[type].length > 0) {
                byType[type] = result[type];
                break;
            }
        }
    });
    return byType;
};

const flattenSegments = (byType) => {
    const ordered = ['recap', 'intro', 'credits', 'preview'];
    const segments = [];
    ordered.forEach((type) => {
        if (Array.isArray(byType[type])) segments.push(...byType[type]);
    });
    return segments;
};

const useSkipSegments = (player, duration) => {
    // Segments are stored together with the videoId they belong to, so a
    // freshly-selected episode never inherits the previous episode's data.
    const [state, setState] = React.useState({ videoId: null, segments: null });

    const videoId = React.useMemo(() => {
        return player?.selected?.streamRequest?.path?.id ?? null;
    }, [player?.selected?.streamRequest?.path?.id]);

    const parsed = React.useMemo(() => {
        return videoId ? parseVideoId(videoId) : null;
    }, [videoId]);

    React.useEffect(() => {
        if (!parsed) {
            setState({ videoId, segments: null });
            return;
        }

        const cacheKey = CACHE_PREFIX + videoId;
        const cached = getCached(cacheKey);
        if (cached !== null) {
            setState({ videoId, segments: cached });
            return;
        }

        let cancelled = false;

        const fetchSegments = async () => {
            const providers = [fromTheIntroDb, fromSkipDb, fromIntroDbApp];
            const settled = await Promise.allSettled(providers.map((fetcher) => fetcher(parsed, duration)));

            if (cancelled) return;

            const fulfilled = settled
                .filter((outcome) => outcome.status === 'fulfilled')
                .map((outcome) => outcome.value);

            if (fulfilled.length === 0) {
                // All providers unreachable (likely offline): don't poison
                // the cache with an empty result.
                setState({ videoId, segments: [] });
                return;
            }

            const flattened = flattenSegments(mergeProviderResults(fulfilled));
            setCached(cacheKey, flattened);
            setState({ videoId, segments: flattened });
        };

        fetchSegments();

        return () => {
            cancelled = true;
        };
    }, [parsed, duration, videoId]);

    return state.videoId !== null && state.videoId === videoId ? state.segments : null;
};

module.exports = useSkipSegments;
