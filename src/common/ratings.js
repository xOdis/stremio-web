// Copyright (C) 2017-2026 Smart code 203358507

const React = require('react');

const CINEMETA_BASE = 'https://v3-cinemeta.strem.io';
const FETCH_TIMEOUT_MS = 8000;

// "{type}:{imdbId}" -> Promise<meta | null>, shared across all consumers.
const metaPromises = new Map();

const fetchCinemetaMeta = (type, imdbId) => {
    const key = `${type}:${imdbId}`;
    let promise = metaPromises.get(key);
    if (!promise) {
        const controller = typeof AbortController === 'function' ? new AbortController() : null;
        const timer = controller !== null ? setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS) : null;
        promise = fetch(`${CINEMETA_BASE}/meta/${type}/${imdbId}.json`, controller !== null ? { signal: controller.signal } : undefined)
            .then((response) => {
                if (!response.ok) throw new Error('HTTP ' + response.status);
                return response.json();
            })
            .then((data) => data?.meta ?? null)
            .catch(() => null)
            .finally(() => {
                if (timer !== null) clearTimeout(timer);
            });
        metaPromises.set(key, promise);
    }
    return promise;
};

const parseImdbRating = (meta) => {
    if (meta === null || typeof meta !== 'object') {
        return null;
    }
    const rating = parseFloat(meta.imdbRating);
    return !isNaN(rating) && rating > 0 ? rating.toFixed(1) : null;
};

const IMDB_ID_PATTERN = /^(tt\d+)/;
const RATED_TYPES = new Set(['movie', 'series']);

const toImdbId = (id) => {
    if (typeof id !== 'string') {
        return null;
    }
    const match = id.match(IMDB_ID_PATTERN);
    return match !== null ? match[1] : null;
};

// Returns the IMDb rating string (e.g. "8.4") for an item id like "tt123"
// or "tt123:1:1", lazily fetched from Cinemeta and cached module-wide.
const useImdbRating = (type, id) => {
    const [rating, setRating] = React.useState(null);
    const imdbId = React.useMemo(() => toImdbId(id), [id]);

    React.useEffect(() => {
        setRating(null);
        if (imdbId === null || !RATED_TYPES.has(type)) {
            return;
        }

        let cancelled = false;
        fetchCinemetaMeta(type, imdbId).then((meta) => {
            if (!cancelled) {
                setRating(parseImdbRating(meta));
            }
        });

        return () => {
            cancelled = true;
        };
    }, [type, imdbId]);

    return rating;
};

module.exports = {
    CINEMETA_BASE,
    fetchCinemetaMeta,
    parseImdbRating,
    useImdbRating
};
