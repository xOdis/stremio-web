// Copyright (C) 2017-2023 Smart code 203358507

const { parseReleaseInfo } = require('./releaseVersion');

// When the core engine cannot carry the current provider over to the next
// episode (its binge matching requires identical behaviorHints.bingeGroup
// tags), we query the same addon ourselves and pick the stream that most
// resembles the one currently playing.

const MIN_MATCH_SCORE = 2;

const SCORES = {
    group: 5,
    resolution: 3,
    source: 2,
    service: 1,
    language: 1
};

const buildStreamsUrl = (streamRequest, videoId) => {
    if (!streamRequest || typeof streamRequest.base !== 'string' || !streamRequest.path) {
        return null;
    }
    const { type, extra } = streamRequest.path;
    if (typeof type !== 'string' || typeof videoId !== 'string') {
        return null;
    }
    // Addon protocol appends extra params right after ".json".
    const queryString = Array.isArray(extra) && extra.length > 0 ?
        extra.map(([key, value]) => `&${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join('')
        :
        '';
    return `${streamRequest.base}/stream/${type}/${encodeURIComponent(videoId)}.json${queryString}`;
};

const scoreStream = (candidateInfo, currentInfo) => {
    let score = 0;
    if (candidateInfo === null || currentInfo === null) {
        return score;
    }
    Object.keys(SCORES).forEach((key) => {
        if (candidateInfo[key] && candidateInfo[key] === currentInfo[key]) {
            score += SCORES[key];
        }
    });
    return score;
};

const isPlayableStream = (stream) => {
    return Boolean(
        stream &&
        (
            typeof stream.infoHash === 'string' ||
            typeof stream.url === 'string' ||
            typeof stream.ytId === 'string'
        )
    );
};

// Returns the candidate that most closely resembles the currently playing
// stream, or null when nothing scores high enough to be trusted.
const pickBestStream = (streams, currentStream) => {
    if (!Array.isArray(streams) || streams.length === 0 || !currentStream) {
        return null;
    }

    const currentInfo = parseReleaseInfo(currentStream.name, currentStream.description);

    let best = null;
    let bestScore = 0;
    streams.forEach((stream) => {
        if (!isPlayableStream(stream)) {
            return;
        }
        const info = parseReleaseInfo(stream.name, stream.description);
        const score = scoreStream(info, currentInfo);
        if (score > bestScore) {
            bestScore = score;
            best = stream;
        }
    });

    return bestScore >= MIN_MATCH_SCORE ? best : null;
};

const SEED_COUNT_PATTERN = /(?:👤|👥|🌱)\s*([\d.,]+)\s*(k|m)?\b|^S:\s*([\d.,]+)\s*(k|m)?\b/mi;
const SEED_WORD_PATTERN = /([\d.,]+)\s*(k|m)?\s*(?:seeders?|seeds?)\b/i;
const SUFFIX_MULTIPLIERS = { k: 1000, m: 1000000 };

const parseSeedCount = (rawValue, suffix) => {
    const normalized = typeof rawValue === 'string' ? rawValue.replace(/,/g, '') : rawValue;
    const count = typeof normalized === 'number' ? normalized : parseInt(normalized, 10);
    if (!isFinite(count) || count <= 0) {
        return 0;
    }
    const multiplier = typeof suffix === 'string' ? SUFFIX_MULTIPLIERS[suffix.toLowerCase()] : undefined;
    return multiplier !== undefined ? Math.round(count * multiplier) : count;
};

// Seeders are the health signal of a torrent: the addon may expose them as
// a numeric `seeds` field, or render them in the title/description text
// ("👤 326", "S: 12", "42 seeders"). HTTP/external links have none -> 0.
const parseSeeders = (stream) => {
    if (!stream) {
        return 0;
    }
    if (typeof stream.seeds === 'number' && isFinite(stream.seeds) && stream.seeds > 0) {
        return Math.round(stream.seeds);
    }
    if (typeof stream.seeds === 'string') {
        const fromField = parseSeedCount(stream.seeds, undefined);
        if (fromField > 0) {
            return fromField;
        }
    }
    const text = [stream.title, stream.description, stream.name]
        .filter((part) => typeof part === 'string')
        .join('\n');
    const iconMatch = text.match(SEED_COUNT_PATTERN);
    if (iconMatch !== null) {
        return parseSeedCount(iconMatch[1] ?? iconMatch[3], iconMatch[2] ?? iconMatch[4]);
    }
    const wordMatch = text.match(SEED_WORD_PATTERN);
    if (wordMatch !== null) {
        return parseSeedCount(wordMatch[1], wordMatch[2]);
    }
    return 0;
};

// Last-tier fallback before dropping the user on the streams list: keep the
// resolution the viewer was watching (quality/bandwidth continuity) and pick
// the swarm with the most seeders — the link most likely to play smoothly.
// Strict: when the current resolution is unknown or no candidate matches it,
// returns null so the existing behavior (streams list) takes over.
const pickHealthiestStream = (streams, currentStream) => {
    if (!Array.isArray(streams) || streams.length === 0 || !currentStream) {
        return null;
    }

    const currentInfo = parseReleaseInfo(currentStream.name, currentStream.description);
    const currentResolution = currentInfo !== null ? currentInfo.resolution : null;
    if (typeof currentResolution !== 'string') {
        return null;
    }

    let best = null;
    let bestSeeders = 0;
    streams.forEach((stream) => {
        if (!isPlayableStream(stream)) {
            return;
        }
        const info = parseReleaseInfo(stream.name, stream.description, stream.title);
        if (info === null || info.resolution !== currentResolution) {
            return;
        }
        const seeders = parseSeeders(stream);
        if (seeders > bestSeeders) {
            bestSeeders = seeders;
            best = stream;
        }
    });

    return best;
};

module.exports = { buildStreamsUrl, pickBestStream, pickHealthiestStream, parseSeeders };
