// Copyright (C) 2017-2026 Smart code 203358507

const KEY = 'stremio.playerSettings';
const SERVER_URL = '/api/player-settings';

// Fonts offered in the subtitle settings. Bundled Google Fonts (Cairo,
// Alexandria, Tajawal, Lalezar, Noto Naskh Arabic, Inter, Roboto,
// Open Sans, Lato) work without installing them: the local server exposes
// the assets/fonts folder and mpv's libass loads fonts from it
// (sub-fonts-dir). System fonts work as usual. Dubai works once its .ttf
// is dropped into assets/fonts (license forbids redistributing it).
const SUBTITLE_FONTS = [
    'Arial',
    'Cairo',
    'Alexandria',
    'Tajawal',
    'Lalezar',
    'Dubai',
    'Noto Naskh Arabic',
    'Thamaniya',
    'Tahoma',
    'Inter',
    'Roboto',
    'Open Sans',
    'Lato',
    'Segoe UI',
    'Verdana',
    'Calibri',
    'Georgia'
];

const DEFAULT_FONT_ARABIC = 'Arial';
const DEFAULT_FONT_LATIN = 'Segoe UI';

const VIDEO_SCALES = ['contain', 'cover', 'fill'];
const COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

const isFiniteNumber = (value, min, max) => {
    return typeof value === 'number' && isFinite(value) && value >= min && value <= max;
};

// Reads and validates persisted player settings. Invalid or missing
// entries are dropped, so engine defaults apply for them.
const readPlayerSettings = () => {
    try {
        const raw = localStorage.getItem(KEY);
        if (raw === null) {
            return {};
        }
        const parsed = JSON.parse(raw);
        if (parsed === null || typeof parsed !== 'object') {
            return {};
        }
        const settings = {};
        if (isFiniteNumber(parsed.volume, 0, 200)) {
            settings.volume = parsed.volume;
        }
        if (typeof parsed.muted === 'boolean') {
            settings.muted = parsed.muted;
        }
        if (isFiniteNumber(parsed.playbackSpeed, 0.1, 16)) {
            settings.playbackSpeed = parsed.playbackSpeed;
        }
        if (VIDEO_SCALES.includes(parsed.videoScale)) {
            settings.videoScale = parsed.videoScale;
        }
        if (isFiniteNumber(parsed.subtitlesSize, 0, 400)) {
            settings.subtitlesSize = parsed.subtitlesSize;
        }
        if (isFiniteNumber(parsed.subtitlesOffset, 0, 100)) {
            settings.subtitlesOffset = parsed.subtitlesOffset;
        }
        if (typeof parsed.subtitlesTextColor === 'string' && COLOR_PATTERN.test(parsed.subtitlesTextColor)) {
            settings.subtitlesTextColor = parsed.subtitlesTextColor;
        }
        if (typeof parsed.subtitlesBackgroundColor === 'string' && COLOR_PATTERN.test(parsed.subtitlesBackgroundColor)) {
            settings.subtitlesBackgroundColor = parsed.subtitlesBackgroundColor;
        }
        if (typeof parsed.subtitlesOutlineColor === 'string' && COLOR_PATTERN.test(parsed.subtitlesOutlineColor)) {
            settings.subtitlesOutlineColor = parsed.subtitlesOutlineColor;
        }
        if (typeof parsed.subtitlesFontFamily === 'string' && parsed.subtitlesFontFamily.length > 0 && parsed.subtitlesFontFamily.length <= 50) {
            settings.subtitlesFontFamily = parsed.subtitlesFontFamily;
        }
        return settings;
    } catch (_e) {
        // corrupted or unavailable storage: defaults apply
        return {};
    }
};

const writePlayerSettings = (partial) => {
    try {
        const current = readPlayerSettings();
        const merged = { ...current, ...partial };
        localStorage.setItem(KEY, JSON.stringify(merged));
        // Also persist to the local server so settings survive if the shell
        // clears WebView2 localStorage on relaunch.
        try {
            fetch(SERVER_URL, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(merged),
            }).catch(function() {});
        } catch (_e) {}
    } catch (_e) {
        // storage unavailable: settings stay in memory only
    }
};

// On startup, restore server-backed settings into localStorage.  The
// Stremio shell may clear WebView2 storage on relaunch, so the server
// file is the durable source of truth.  This fetch is fire-and-forget;
// readPlayerSettings() returns synchronously from localStorage, so
// the first few reads before the fetch completes may use stale data —
// that window is tiny and self-heals on next page load.
try {
    fetch(SERVER_URL)
        .then(function(res) { return res.ok ? res.json() : null; })
        .then(function(data) {
            if (data && typeof data === 'object' && Object.keys(data).length > 0) {
                // Only overwrite localStorage if the server has data.
                // If localStorage already has newer data the POST
                // (triggered by writePlayerSettings) will bring the
                // server up to speed on next write.
                var existing = {};
                try { existing = JSON.parse(localStorage.getItem(KEY)) || {}; } catch (_e) {}
                localStorage.setItem(KEY, JSON.stringify({ ...data, ...existing }));
            }
        })
        .catch(function() {});
} catch (_e) {}

// Arabic interface gets Arial by default, everything else a modern
// humanist sans that reads well at small subtitle sizes.
const defaultSubtitleFont = (interfaceLanguage) => {
    const lang = typeof interfaceLanguage === 'string' ? interfaceLanguage.toLowerCase() : '';
    return lang.startsWith('ar') ? DEFAULT_FONT_ARABIC : DEFAULT_FONT_LATIN;
};

const subtitleFontStack = (font) => {
    const primary = String(font === null || font === undefined ? '' : font).replace(/['"\\]/g, '').trim();
    if (primary.length === 0) {
        return 'Arial, sans-serif';
    }
    return `'${primary}', Arial, sans-serif`;
};

module.exports = {
    SUBTITLE_FONTS,
    readPlayerSettings,
    writePlayerSettings,
    defaultSubtitleFont,
    subtitleFontStack
};
