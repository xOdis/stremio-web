// Copyright (C) 2017-2023 Smart code 203358507

const KEY = 'stremio.autoNextEpisode';

const readAutoNextEpisode = () => {
    try {
        const value = localStorage.getItem(KEY);
        // Default ON: auto-next with countdown is the intended experience;
        // users opt out explicitly via the player options menu.
        return value === null ? true : value === '1';
    } catch (_e) {
        return true;
    }
};

const writeAutoNextEpisode = (enabled) => {
    try {
        localStorage.setItem(KEY, enabled ? '1' : '0');
    } catch (_e) {
        // storage unavailable
    }
};

module.exports = {
    readAutoNextEpisode,
    writeAutoNextEpisode,
};
