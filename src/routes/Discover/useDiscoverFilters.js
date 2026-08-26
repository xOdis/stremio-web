// Copyright (C) 2017-2026 Smart code 203358507

const React = require('react');

// Client-side filtering/sorting engine for the Discover grid. Server-side
// filters are limited to what each addon manifest supports (genre, search...);
// these filters run on the already-loaded catalog items and live in the URL
// query so they survive back/forward and can be shared.

const FILTER_PARAM_KEYS = ['minRating', 'yearFrom', 'yearTo', 'hideWatched', 'hideUnrated', 'sort', 'poster'];

const DEFAULT_SORT = 'default';
const DEFAULT_POSTER = 'm';

const YEAR_PATTERN = /(\d{4})/;

const parseYear = (releaseInfo) => {
    if (typeof releaseInfo !== 'string') {
        return null;
    }
    const match = releaseInfo.match(YEAR_PATTERN);
    return match !== null ? parseInt(match[1], 10) : null;
};

const parseRating = (item) => {
    const rating = parseFloat(item?.imdbRating);
    return !isNaN(rating) && rating > 0 ? rating : null;
};

const hasRating = (item) => {
    return typeof item?.imdbRating === 'string' && item.imdbRating.trim().length > 0 && parseRating(item) !== null;
};

const useDiscoverFilters = (items, queryParams, setSearchParams) => {
    const filters = React.useMemo(() => {
        const minRating = parseFloat(queryParams.get('minRating'));
        const yearFrom = parseInt(queryParams.get('yearFrom'), 10);
        const yearTo = parseInt(queryParams.get('yearTo'), 10);
        return {
            minRating: !isNaN(minRating) && minRating > 0 ? minRating : null,
            yearFrom: !isNaN(yearFrom) ? yearFrom : null,
            yearTo: !isNaN(yearTo) ? yearTo : null,
            hideWatched: queryParams.get('hideWatched') === '1',
            hideUnrated: queryParams.get('hideUnrated') === '1',
            sort: queryParams.get('sort') ?? DEFAULT_SORT,
            poster: queryParams.get('poster') ?? DEFAULT_POSTER
        };
    }, [queryParams]);

    const writeParam = React.useCallback((key, serialized) => {
        setSearchParams((prev) => {
            const next = new URLSearchParams(prev);
            if (serialized === null) {
                next.delete(key);
            } else {
                next.set(key, serialized);
            }
            return next;
        });
    }, [setSearchParams]);

    const setFilter = React.useCallback((key, value) => {
        const empty = value === null || value === undefined ||
            value === false ||
            (key === 'sort' && value === DEFAULT_SORT) ||
            (key === 'poster' && value === DEFAULT_POSTER);
        writeParam(key, empty ? null : String(value === true ? '1' : value));
    }, [writeParam]);

    const clearClientFilters = React.useCallback(() => {
        setSearchParams((prev) => {
            const next = new URLSearchParams(prev);
            FILTER_PARAM_KEYS.forEach((key) => next.delete(key));
            return next;
        });
    }, [setSearchParams]);

    const filteredItems = React.useMemo(() => {
        if (!Array.isArray(items)) {
            return [];
        }
        let result = items.filter((item) => {
            if (filters.minRating !== null && parseRating(item) !== null && parseRating(item) < filters.minRating) {
                return false;
            }
            if (filters.minRating !== null && parseRating(item) === null) {
                return false;
            }
            if (filters.hideUnrated && !hasRating(item)) {
                return false;
            }
            if (filters.hideWatched && item.watched === true) {
                return false;
            }
            if (filters.yearFrom !== null || filters.yearTo !== null) {
                const year = parseYear(item.releaseInfo);
                if (year === null) {
                    return false;
                }
                if (filters.yearFrom !== null && year < filters.yearFrom) {
                    return false;
                }
                if (filters.yearTo !== null && year > filters.yearTo) {
                    return false;
                }
            }
            return true;
        });

        const yearOf = (item) => parseYear(item.releaseInfo);
        switch (filters.sort) {
            case 'name':
                result = [...result].sort((a, b) => String(a.name ?? '').localeCompare(String(b.name ?? '')));
                break;
            case 'year_new':
                result = [...result].sort((a, b) => (yearOf(b) ?? -1) - (yearOf(a) ?? -1));
                break;
            case 'year_old':
                result = [...result].sort((a, b) => {
                    const yearA = yearOf(a);
                    const yearB = yearOf(b);
                    if (yearA === null && yearB === null) return 0;
                    if (yearA === null) return 1;
                    if (yearB === null) return -1;
                    return yearA - yearB;
                });
                break;
            case 'rating':
                result = [...result].sort((a, b) => {
                    const ratingA = parseRating(a);
                    const ratingB = parseRating(b);
                    if (ratingA === null && ratingB === null) return 0;
                    if (ratingA === null) return 1;
                    if (ratingB === null) return -1;
                    return ratingB - ratingA;
                });
                break;
        }
        return result;
    }, [items, filters]);

    const activeFilterCount = React.useMemo(() => {
        return [
            filters.minRating !== null,
            filters.yearFrom !== null || filters.yearTo !== null,
            filters.hideWatched,
            filters.hideUnrated,
            filters.sort !== DEFAULT_SORT
        ].filter(Boolean).length;
    }, [filters]);

    const activeClientFilterChips = React.useMemo(() => {
        const chips = [];
        if (filters.minRating !== null) {
            chips.push({ key: 'minRating', label: `IMDb \u2265 ${filters.minRating}` });
        }
        if (filters.yearFrom !== null && filters.yearTo !== null) {
            chips.push({ key: 'yearFrom', label: `${filters.yearFrom} \u2013 ${filters.yearTo}` });
        } else if (filters.yearFrom !== null) {
            chips.push({ key: 'yearFrom', label: `${filters.yearFrom} \u2192` });
        } else if (filters.yearTo !== null) {
            chips.push({ key: 'yearTo', label: `\u2192 ${filters.yearTo}` });
        }
        if (filters.hideWatched) {
            chips.push({ key: 'hideWatched', label: 'hideWatched' });
        }
        if (filters.hideUnrated) {
            chips.push({ key: 'hideUnrated', label: 'hideUnrated' });
        }
        return chips;
    }, [filters]);

    return { filters, setFilter, clearClientFilters, filteredItems, activeFilterCount, activeClientFilterChips };
};

module.exports = useDiscoverFilters;
module.exports.FILTER_PARAM_KEYS = FILTER_PARAM_KEYS;
module.exports.DEFAULT_SORT = DEFAULT_SORT;
module.exports.DEFAULT_POSTER = DEFAULT_POSTER;
