// Copyright (C) 2017-2026 Smart code 203358507

const React = require('react');

const CACHE_PREFIX = 'desc_translation_v1_';
const FETCH_TIMEOUT_MS = 10000;

const hashText = (text) => {
    let hash = 5381;
    for (let index = 0; index < text.length; index++) {
        hash = ((hash << 5) + hash + text.charCodeAt(index)) | 0;
    }
    return (hash >>> 0).toString(36);
};

const cacheGet = (key, originalText) => {
    try {
        const raw = window.localStorage.getItem(key);
        if (raw === null) {
            return null;
        }
        const entry = JSON.parse(raw);
        return entry?.text === originalText && typeof entry.translated === 'string' ? entry.translated : null;
    } catch (_e) {
        // corrupted or unavailable cache entry: treat as a miss
        return null;
    }
};

const cacheSet = (key, value) => {
    try {
        window.localStorage.setItem(key, JSON.stringify(value));
    } catch (_e) {
        // storage full or unavailable: translations stay in memory only
    }
};

const toBaseLanguage = (language) => {
    return typeof language === 'string' ? language.split('-')[0].toLowerCase() : '';
};

// Translates a meta description into the interface language through the
// local server proxy. Returns null until (and unless) a translation is
// available; callers render the original text meanwhile. Skipped entirely
// for English so most users never hit the network.
const useTranslatedText = (text, interfaceLanguage) => {
    const [translated, setTranslated] = React.useState(null);
    const target = toBaseLanguage(interfaceLanguage);
    const enabled = typeof text === 'string' && text.length > 0 && target.length > 0 && target !== 'en';

    React.useEffect(() => {
        setTranslated(null);
        if (!enabled) {
            return;
        }

        const key = `${CACHE_PREFIX}${target}_${hashText(text)}`;
        const cached = cacheGet(key, text);
        if (cached !== null) {
            setTranslated(cached);
            return;
        }

        let cancelled = false;
        const controller = typeof AbortController === 'function' ? new AbortController() : null;
        const timer = controller !== null ? setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS) : null;
        fetch(`/proxy/translate?text=${encodeURIComponent(text)}&target=${encodeURIComponent(target)}`, controller !== null ? { signal: controller.signal } : undefined)
            .then((response) => {
                if (!response.ok) throw new Error('HTTP ' + response.status);
                return response.json();
            })
            .then((data) => {
                if (!cancelled && typeof data?.translated === 'string' && data.translated.length > 0) {
                    cacheSet(key, { text, translated: data.translated });
                    setTranslated(data.translated);
                }
            })
            .catch(() => null)
            .finally(() => {
                if (timer !== null) clearTimeout(timer);
            });

        return () => {
            cancelled = true;
            if (timer !== null) clearTimeout(timer);
        };
    }, [text, target]);

    return translated;
};

module.exports = {
    useTranslatedText
};
