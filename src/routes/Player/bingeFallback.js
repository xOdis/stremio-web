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

module.exports = { buildStreamsUrl, pickBestStream };
