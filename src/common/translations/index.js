// Copyright (C) 2017-2026 Smart code 203358507

const overridesA = require('./overrides-a');
const overridesB = require('./overrides-b');
const overridesC = require('./overrides-c');

const merged = {};
[overridesA, overridesB, overridesC].forEach((part) => {
    Object.entries(part).forEach(([language, bundle]) => {
        merged[language] = { ...merged[language], ...bundle };
    });
});

module.exports = merged;
