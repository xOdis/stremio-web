// Copyright (C) 2017-2026 Smart code 203358507

const React = require('react');
const { CINEMETA_BASE, fetchCinemetaMeta, parseImdbRating } = require('stremio/common/ratings');

const FETCH_TIMEOUT_MS = 8000;
const MAX_GENRES = 3;
const MAX_ITEMS_PER_SECTION = 24;
const FALLBACK_GENRES = ['Action', 'Drama', 'Comedy'];

const fetchJson = async (url) => {
    const aborter = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = aborter !== null ? setTimeout(() => aborter.abort(), FETCH_TIMEOUT_MS) : null;
    try {
        const response = await fetch(url, aborter !== null ? { signal: aborter.signal } : undefined);
        if (!response.ok) throw new Error('HTTP ' + response.status);
        return await response.json();
    } finally {
        if (timer !== null) clearTimeout(timer);
    }
};

const fetchGenreCatalog = async (type, genre) => {
    try {
        const data = await fetchJson(`${CINEMETA_BASE}/catalog/${type}/top/genre=${encodeURIComponent(genre)}.json`);
        return Array.isArray(data?.metas) ? data.metas : [];
    } catch (_e) {
        return [];
    }
};

// Relevance score: genre overlap counts double, IMDb rating breaks ties
// and lifts items that share more than one genre with the finished title.
const relevanceScore = (item, genres) => {
    const itemGenres = Array.isArray(item.genres) ? item.genres.map((genre) => String(genre).toLowerCase()) : [];
    const overlap = genres.reduce((count, genre) => itemGenres.includes(genre.toLowerCase()) ? count + 1 : count, 0);
    return overlap * 2 + parseImdbRating(item.imdbRating);
};

const toCardItem = (meta, type) => ({
    id: meta.id,
    type,
    name: meta.name,
    poster: meta.poster ?? null,
    background: meta.background ?? null,
    posterShape: 'poster',
    imdbRating: meta.imdbRating ?? null,
    releaseInfo: typeof meta.releaseInfo === 'string' ? meta.releaseInfo : '',
    href: `/metadetails/${type}/${encodeURIComponent(meta.id)}`
});

// Builds two ranked lists (series / movies) related to the given title.
const useRelatedTitles = (type, id) => {
    const [state, setState] = React.useState({
        loading: true,
        error: false,
        finishedMeta: null,
        series: [],
        movies: []
    });

    React.useEffect(() => {
        setState({
            loading: true,
            error: false,
            finishedMeta: null,
            series: [],
            movies: []
        });

        if (typeof type !== 'string' || typeof id !== 'string') {
            setState({
                loading: false,
                error: true,
                finishedMeta: null,
                series: [],
                movies: []
            });
            return;
        }

        let cancelled = false;

        const load = async () => {
            try {
                const meta = await fetchCinemetaMeta(type, id);
                if (cancelled) {
                    return;
                }
                if (meta === null) {
                    setState({
                        loading: false,
                        error: true,
                        finishedMeta: null,
                        series: [],
                        movies: []
                    });
                    return;
                }

                const genres = Array.isArray(meta.genres) && meta.genres.length > 0 ?
                    meta.genres.slice(0, MAX_GENRES)
                    :
                    FALLBACK_GENRES;

                const [seriesMetas, movieMetas] = await Promise.all([
                    Promise.all(genres.map((genre) => fetchGenreCatalog('series', genre))),
                    Promise.all(genres.map((genre) => fetchGenreCatalog('movie', genre)))
                ]);
                if (cancelled) {
                    return;
                }

                const buildSection = (batches) => {
                    const seen = new Set([id]);
                    const merged = [];
                    batches.forEach((batch) => {
                        batch.forEach((item) => {
                            if (typeof item?.id !== 'string' || !item.id.startsWith('tt') || seen.has(item.id)) {
                                return;
                            }
                            seen.add(item.id);
                            merged.push(item);
                        });
                    });
                    return merged
                        .sort((a, b) => relevanceScore(b, genres) - relevanceScore(a, genres))
                        .slice(0, MAX_ITEMS_PER_SECTION);
                };

                setState({
                    loading: false,
                    error: false,
                    finishedMeta: meta,
                    series: buildSection(seriesMetas).map((item) => toCardItem(item, 'series')),
                    movies: buildSection(movieMetas).map((item) => toCardItem(item, 'movie'))
                });
            } catch (_e) {
                if (!cancelled) {
                    setState({
                        loading: false,
                        error: true,
                        finishedMeta: null,
                        series: [],
                        movies: []
                    });
                }
            }
        };

        load();

        return () => {
            cancelled = true;
        };
    }, [type, id]);

    return state;
};

module.exports = {
    useRelatedTitles
};
