// Copyright (C) 2017-2023 Smart code 203358507

const React = require('react');
const { createIntroDbClient } = require('theintrodb');
const { parseReleaseInfo, getVersionKey } = require('./releaseVersion');

// v2: invalidates empty results cached by the single-provider era, which
// blocked re-fetching from the additional sources.
// v4: entries are now sanitized against the real video duration and cached
// per release version + duration bucket.
const CACHE_PREFIX = 'skip_segments_v4_';
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const PROVIDER_TIMEOUT_MS = 8000;
const FETCH_DEBOUNCE_MS = 1200;

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

// Timestamps submitted for a different cut of the episode (e.g. a version
// with a longer producer intro or extended credits) can point past the
// actual media. Drop segments that cannot fit this video instead of
// jumping over real scenes.
const sanitizeSegments = (segments, durationMs) => {
    if (!Array.isArray(segments)) {
        return [];
    }
    if (!(typeof durationMs === 'number' && isFinite(durationMs) && durationMs > 0)) {
        return segments.filter((segment) => segment.endMs === null ? segment.type === 'credits' : true);
    }

    return segments
        .filter((segment) => {
            const end = segment.endMs ?? segment.startMs;
            return segment.type === 'credits' ? segment.startMs < durationMs - 1000 : end <= durationMs * 0.98 && segment.startMs < durationMs * 0.95;
        })
        .map((segment) => ({
            ...segment,
            endMs: segment.endMs !== null && segment.endMs > durationMs ? durationMs : segment.endMs
        }));
};

const flattenSegments = (byType) => {
    const ordered = ['recap', 'intro', 'credits', 'preview'];
    const segments = [];
    ordered.forEach((type) => {
        if (Array.isArray(byType[type])) segments.push(...byType[type]);
    });
    return segments;
};

// TheIntroDB can return multiple version clusters for the same segment type
// (e.g. cuts with/without a producer logo). Keep the single cluster that
// best fits this video's duration instead of stacking several skip buttons.
const CLUSTER_MERGE_TOLERANCE_MS = 5000;
const CREDITS_END_MARGIN_MS = 15000;

const pickBestCluster = (entries, durationMs) => {
    if (!Array.isArray(entries) || entries.length <= 1) {
        return entries ?? [];
    }

    const sorted = [...entries].sort((a, b) => a.startMs - b.startMs);
    const merged = [];
    sorted.forEach((entry) => {
        const last = merged[merged.length - 1];
        if (last !== undefined && entry.startMs - last.startMs <= CLUSTER_MERGE_TOLERANCE_MS) {
            return;
        }
        merged.push(entry);
    });

    if (merged.length === 1 || !(typeof durationMs === 'number' && isFinite(durationMs) && durationMs > 0)) {
        return [merged[0]];
    }

    let best = merged[0];
    if (best.type === 'credits') {
        const limit = durationMs - CREDITS_END_MARGIN_MS;
        merged.forEach((entry) => {
            if (entry.startMs <= limit && entry.startMs > best.startMs) {
                best = entry;
            }
        });
    }

    return [best];
};

const useSkipSegments = (player, duration) => {
    // Segments are stored together with the videoId they belong to, so a
    // freshly-selected episode never inherits the previous episode's data.
    const [state, setState] = React.useState({ videoId: null, versionKey: null, segments: null });

    const videoId = React.useMemo(() => {
        return player?.selected?.streamRequest?.path?.id ?? null;
    }, [player?.selected?.streamRequest?.path?.id]);

    // Release version of the currently selected stream (e.g. "web-nf-1080p"),
    // parsed from the stream name/description. Different versions (BluRay,
    // Netflix, TV...) have different durations, so intro/recap/credits
    // timestamps are cached per version + duration bucket instead of just
    // per episode.
    const versionKey = React.useMemo(() => {
        const stream = player?.selected?.stream;
        return getVersionKey(parseReleaseInfo(stream?.name, stream?.description)) ?? 'generic';
    }, [player?.selected?.stream?.name, player?.selected?.stream?.description]);

    const cacheKey = React.useMemo(() => {
        let key = `${CACHE_PREFIX}${videoId}_${versionKey}`;
        if (typeof duration === 'number' && isFinite(duration)) {
            key += `_${Math.round(duration / 1000)}`;
        }
        return key;
    }, [videoId, versionKey, duration]);

    const parsed = React.useMemo(() => {
        return videoId ? parseVideoId(videoId) : null;
    }, [videoId]);

    React.useEffect(() => {
        if (!parsed) {
            setState({ videoId, versionKey, segments: null });
            return;
        }

        const cached = getCached(cacheKey);
        if (cached !== null) {
            setState({ videoId, versionKey, segments: cached });
            return;
        }

        let cancelled = false;

        const fetchSegments = async () => {
            const providers = [fromTheIntroDb, fromSkipDb, fromIntroDbApp];
            let settled = await Promise.allSettled(providers.map((fetcher) => fetcher(parsed, duration)));

            if (cancelled) return;

            let fulfilled = settled
                .filter((outcome) => outcome.status === 'fulfilled')
                .map((outcome) => outcome.value);

            // No duration-matched data: try again without the duration hint so
            // providers can still return their default episode entry.
            const hasAnySegment = fulfilled.some((result) =>
                SEGMENT_TYPES.some((type) => Array.isArray(result[type]) && result[type].length > 0)
            );
            if (!hasAnySegment && typeof duration === 'number' && isFinite(duration)) {
                settled = await Promise.allSettled([fromTheIntroDb(parsed, null), fromSkipDb(parsed, null), fromIntroDbApp(parsed)]);
                if (cancelled) return;
                fulfilled = settled
                    .filter((outcome) => outcome.status === 'fulfilled')
                    .map((outcome) => outcome.value);
            }

            if (fulfilled.length === 0) {
                // All providers unreachable (likely offline): don't poison
                // the cache with an empty result.
                setState({ videoId, versionKey, segments: [] });
                return;
            }

            const byType = mergeProviderResults(fulfilled);
            SEGMENT_TYPES.forEach((type) => {
                byType[type] = pickBestCluster(byType[type], duration);
            });
            const flattened = sanitizeSegments(flattenSegments(byType), duration);
            setCached(cacheKey, flattened);
            setState({ videoId, versionKey, segments: flattened });
        };

        // Give the freshly selected stream a moment to report its own
        // duration before querying the providers with it.
        const debounceTimer = setTimeout(fetchSegments, FETCH_DEBOUNCE_MS);

        return () => {
            cancelled = true;
            clearTimeout(debounceTimer);
        };
    }, [parsed, duration, videoId, versionKey, cacheKey]);

    return state.videoId === videoId && state.versionKey === versionKey ? state.segments : null;
};

module.exports = useSkipSegments;
