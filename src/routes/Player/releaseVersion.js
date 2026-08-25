// Parses release tags (source, streaming service, resolution, release group)
// out of stream/torrent names, e.g.:
//   "Show Name S01E02 1080p NF WEB-DL DD+5.1 H.264-GROUP" ->
//   { resolution: '1080p', source: 'web', service: 'nf', group: 'GROUP' }

const SOURCE_PATTERNS = [
    ['bluray-remux', /\b(?:BD|UHD)[\s.-]?REMUX\b|\bREMUX\b/i],
    ['bluray', /\bBLU[\s.-]?RAY\b|\bBDRIP\b|\bBRRIP\b|\bBD(MV|5|9|25|50|66)\b/i],
    ['web', /\bWEB[\s.-]?(?:DL|RIP)\b|\bWEB\b|\bHDRIP\b/i],
    ['hdtv', /\b[HDP]DTV\b|\bDSR\b|\bTVRIP\b|\bPDTV\b/i],
    ['dvd', /\bDVD(RIP|9|5|R)?\b|\bVOB\b/i],
    ['cam', /\bCAM\b|\bHDTS\b|\bTELESYNC\b|\bTELECINE\b|\bTC\b|\bTS\b/i]
];

const SERVICE_PATTERNS = [
    ['amzn', /\bAMZN\b|\bPRIME\s*VIDEO\b/i],
    ['atvp', /\bATVP\b|\bAPPLE\s*TV\+?\b|\bitunes\b/i],
    ['bcore', /\bBCORE\b|\bBRITBOX\b/i],
    ['bbc', /\bBBC\b|\biPlayer\b/i],
    ['crave', /\bCRAV(E|1)\b/i],
    ['dsnp', /\bDSNP\b|\bDISNEY\s*\+?\b|\bDisneyPlus\b/i],
    ['hbo', /\bHBO\b|\bHMAX\b/],
    ['hulu', /\bHULU\b/i],
    ['itvx', /\bITVX\b/],
    ['nf', /\bNF\b|\bNETFLIX\b/i],
    ['pcok', /\bPCOK\b/],
    ['pmtp', /\bPMTP\b|\bParamount\+?\b/i],
    ['sho', /\bSHO\b|\bShowtime\b/i],
    ['stan', /\bSTAN\b/i]
];

const RESOLUTION_PATTERN = /\b(4320p|2160p|1440p|1080[pi]|720p|576p|480p|360p|4k|uhd)\b/i;

// Audio/subtitle language tags that mark a genuinely different cut of an
// episode (different intros, recaps, credits...).
const LANGUAGE_PATTERNS = [
    ['french', /\bFRENCH\b|\bTRUEFRENCH\b|\bVOSTFR\b|\bVFF\b|\bVFI\b|\bVF2\b|\bVFQ\b|\bVF\b|\bVOST\b/i],
    ['multi', /\bMULTI\b/i],
    ['german', /\bGERMAN\b|(?<![\w-])DL\b/i],
    ['italian', /\bITALIAN\b|\bITA\b/i],
    ['spanish', /\bSPANISH\b|\bESP\b|\bCASTELLANO\b|\bLATINO\b/i],
    ['japanese', /\bJAPANESE\b|\bJAP\b/i],
    ['korean', /\bKOREAN\b/i],
    ['hindi', /\bHINDI\b/i],
    ['turkish', /\bTURKISH\b/i],
    ['arabic', /\bARABIC\b|\bARA\b/i]
];

const NON_GROUP_TOKENS = new Set([
    'aac', 'ac3', 'atmos', 'avc', 'ddp', 'dd', 'dl', 'dolby', 'dts', 'dv',
    'eac3', 'h', 'hevc', 'hdr', 'mpeg', 'ray', 'remux', 'rip', 'truehd',
    'vision', 'x264', 'x265'
]);

const parseSource = (text) => {
    for (const [source, pattern] of SOURCE_PATTERNS) {
        if (pattern.test(text)) {
            return source;
        }
    }
    return null;
};

const parseService = (text) => {
    for (const [service, pattern] of SERVICE_PATTERNS) {
        if (pattern.test(text)) {
            return service;
        }
    }
    return null;
};

const parseResolution = (text) => {
    const match = text.match(RESOLUTION_PATTERN);
    if (match === null) {
        return null;
    }
    const token = match[1].toLowerCase();
    if (token === '4k' || token === 'uhd') {
        return '2160p';
    }
    return /[pi]$/.test(token) ? token : `${token}p`;
};

const parseLanguage = (text) => {
    for (const [language, pattern] of LANGUAGE_PATTERNS) {
        if (pattern.test(text)) {
            return language;
        }
    }
    return null;
};

const parseGroup = (text) => {
    const matches = Array.from(text.matchAll(/[\s.-]([A-Za-z][A-Za-z0-9_]{1,30})(?=[\s.]|$)/g));
    for (let index = matches.length - 1; index >= 0; index--) {
        const token = matches[index][1];
        if (!NON_GROUP_TOKENS.has(token.toLowerCase())) {
            return token;
        }
    }
    return null;
};

// Accepts any number of strings (stream name, description, file name...).
// Returns null when no recognizable release tags are found.
const parseReleaseInfo = (...sources) => {
    const text = sources
        .filter((source) => typeof source === 'string' && source.trim().length > 0)
        .join(' ');

    if (text.length === 0) {
        return null;
    }

    const info = {
        resolution: parseResolution(text),
        source: parseSource(text),
        service: parseService(text),
        language: parseLanguage(text),
        group: parseGroup(text)
    };

    return info.resolution !== null || info.source !== null || info.service !== null || info.language !== null || info.group !== null ?
        info
        :
        null;
};

// Canonical cache-key fragment identifying a release version,
// e.g. "bluray", "web-nf-1080p-french". Null when the version is unknown.
const getVersionKey = (info) => {
    if (info === null || typeof info !== 'object') {
        return null;
    }

    const parts = [info.source, info.service, info.resolution, info.language].filter((part) => typeof part === 'string');
    return parts.length > 0 ?
        parts.join('-')
        :
        null;
};

module.exports = { parseReleaseInfo, getVersionKey };
