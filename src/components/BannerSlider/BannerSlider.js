// Copyright (C) 2017-2026 Smart code 203358507

const React = require('react');
const PropTypes = require('prop-types');
const classnames = require('classnames');
const { useTranslation } = require('react-i18next');
const { default: Icon } = require('@stremio/stremio-icons/react');
const { default: Image } = require('stremio/components/Image');
const { useNavigateWithOrigin } = require('stremio-router');
const useProfile = require('stremio/common/useProfile');
const { useTranslatedText } = require('stremio/common/translate');
const styles = require('./styles');

const CINEMETA_BASE = 'https://v3-cinemeta.strem.io';
const WINDOW_SIZE = 6;
const PAGE_COUNT = 2;
const ROTATE_SECONDS = 5;
const IMDB_LABEL = 'IMDb';

let bannerPromise = null;

const fetchJson = async (url) => {
    const response = await fetch(url);
    if (!response.ok) throw new Error('HTTP ' + response.status);
    return response.json();
};

const parseRating = (value) => {
    const rating = parseFloat(value);
    return !isNaN(rating) && rating > 0 ? rating : 0;
};

const sizedImage = (url, size) => {
    if (typeof url !== 'string') {
        return null;
    }
    return url.includes('metahub.space') ? url.replace(/\/(small|medium|large)\//, `/${size}/`) : url;
};

const toSlide = (meta, type) => ({
    id: meta.id,
    type,
    name: meta.name,
    description: typeof meta.description === 'string' ? meta.description : '',
    background: meta.background ?? null,
    poster: meta.poster ?? null,
    imdbRating: parseRating(meta.imdbRating) > 0 ? String(meta.imdbRating) : null,
    releaseInfo: typeof meta.releaseInfo === 'string' ? meta.releaseInfo : '',
    genres: Array.isArray(meta.genres) ? meta.genres.slice(0, 3) : [],
    href: `/metadetails/${type}/${encodeURIComponent(meta.id)}`
});

const fetchPopularCatalog = async (type) => {
    try {
        const data = await fetchJson(`${CINEMETA_BASE}/catalog/${type}/top.json`);
        return Array.isArray(data?.metas) ? data.metas : [];
    } catch (_e) {
        return [];
    }
};

// Trending this week: TMDB weekly trending (via the local proxy, which
// resolves IMDb ids) with the Cinemeta Popular catalogs as fallback.
const fetchTrendingPool = async () => {
    try {
        const data = await fetchJson('/proxy/tmdb/trending');
        if (Array.isArray(data?.metas) && data.metas.length >= WINDOW_SIZE) {
            return data.metas;
        }
    } catch (_e) {
        // TMDB unavailable or key missing: fall back to Cinemeta Popular
    }
    const [movies, series] = await Promise.all([
        fetchPopularCatalog('movie'),
        fetchPopularCatalog('series')
    ]);
    const seen = new Set();
    return [
        ...movies.map((meta) => ({ meta, type: 'movie' })),
        ...series.map((meta) => ({ meta, type: 'series' }))
    ]
        .filter(({ meta }) => typeof meta?.id === 'string' && meta.id.startsWith('tt') && !seen.has(meta.id) && seen.add(meta.id))
        .sort((a, b) => parseRating(b.meta.imdbRating) - parseRating(a.meta.imdbRating))
        .map(({ meta }) => meta);
};

// Enriches pool items with full Cinemeta meta (backdrops, descriptions,
// genres, IMDb ratings). Shared promise: one fetch per load.
const loadBannerPool = () => {
    if (bannerPromise !== null) {
        return bannerPromise;
    }
    bannerPromise = fetchTrendingPool().then((metas) => {
        const seen = new Set();
        return metas
            .filter((meta) => typeof meta?.id === 'string' && meta.id.startsWith('tt') && !seen.has(meta.id) && seen.add(meta.id))
            .slice(0, WINDOW_SIZE * PAGE_COUNT);
    }).then((metas) => {
        return Promise.all(metas.map(async (meta) => {
            try {
                const full = await fetchJson(`${CINEMETA_BASE}/meta/${meta.type}/${meta.id}.json`);
                return toSlide(full?.meta ?? meta, meta.type);
            } catch (_e) {
                return toSlide(meta, meta.type);
            }
        }));
    }).catch(() => []);
    return bannerPromise;
};

const SlideItem = ({ item, active, rotateKey, seekRunning, onSeekEnd }) => {
    const { t } = useTranslation();
    const { navigateWithOrigin } = useNavigateWithOrigin();
    const profile = useProfile();
    const translatedDescription = useTranslatedText(active ? item.description : null, profile.settings?.interfaceLanguage);
    const description = translatedDescription ?? item.description;
    const onOpen = React.useCallback((event) => {
        event.preventDefault();
        navigateWithOrigin(item.href);
    }, [item.href, navigateWithOrigin]);
    return (
        <a
            className={classnames(styles['slide-item'], { [styles['slide-item-active']]: active })}
            href={item.href}
            onClick={onOpen}
            tabIndex={active ? 0 : -1}
            aria-hidden={!active}
        >
            <div className={styles['item-background']}>
                <Image
                    className={classnames(styles['item-image'], styles['item-image-poster'], { [styles['layer-visible']]: !active })}
                    src={sizedImage(item.poster, 'small')}
                    alt={' '}
                    renderFallback={() => null}
                />
                <Image
                    className={classnames(styles['item-image'], styles['item-image-backdrop'], { [styles['layer-visible']]: active })}
                    src={sizedImage(item.background, 'large') ?? sizedImage(item.poster, 'large')}
                    alt={active ? item.name : ' '}
                    renderFallback={() => null}
                />
                <div className={styles['item-scrim']} />
            </div>
            <div className={styles['item-content']}>
                <div className={styles['item-title']}>{item.name}</div>
                <div className={styles['item-meta']}>
                    {
                        item.imdbRating !== null ?
                            <span className={styles['rating-badge']}>
                                <span className={styles['rating-source']}>{IMDB_LABEL}</span>
                                <span className={styles['rating-value']}>{item.imdbRating}</span>
                            </span>
                            :
                            null
                    }
                    {
                        item.releaseInfo.length > 0 ?
                            <span className={styles['meta-label']}>{item.releaseInfo}</span>
                            :
                            null
                    }
                    {
                        item.genres.length > 0 ?
                            <span className={styles['meta-label']}>{item.genres.join(' · ')}</span>
                            :
                            null
                    }
                </div>
                {
                    description.length > 0 ?
                        <div className={styles['item-description']}>{description}</div>
                        :
                        null
                }
                <span className={styles['item-button']}>
                    <Icon className={styles['button-icon']} name={'information-outline'} />
                    <span>{t('BUTTON_DETAILS', 'Details')}</span>
                </span>
            </div>
            <div className={styles['item-mini-title']}>{item.name}</div>
            {
                active ?
                    <div className={styles['seek-bar']}>
                        <div
                            key={rotateKey}
                            className={classnames(styles['seek-bar-fill'], styles['seek-bar-running'], { [styles['seek-bar-paused']]: !seekRunning })}
                            onAnimationEnd={onSeekEnd}
                        />
                    </div>
                    :
                    null
            }
        </a>
    );
};

SlideItem.propTypes = {
    item: PropTypes.shape({
        href: PropTypes.string,
        name: PropTypes.string,
        background: PropTypes.string,
        poster: PropTypes.string,
        imdbRating: PropTypes.string,
        releaseInfo: PropTypes.string,
        genres: PropTypes.array,
        description: PropTypes.string
    }),
    active: PropTypes.bool,
    rotateKey: PropTypes.string,
    seekRunning: PropTypes.bool,
    onSeekEnd: PropTypes.func
};

const BannerSlider = ({ className }) => {
    const { t } = useTranslation();
    const [pool, setPool] = React.useState(null);
    const [pageIndex, setPageIndex] = React.useState(0);
    const [activeIndex, setActiveIndex] = React.useState(0);
    const [playing, setPlaying] = React.useState(true);
    const [interacting, setInteracting] = React.useState(false);

    React.useEffect(() => {
        let cancelled = false;
        loadBannerPool().then((result) => {
            if (!cancelled) {
                setPool(result);
            }
        });
        return () => {
            cancelled = true;
        };
    }, []);

    const reducedMotion = React.useMemo(() => {
        return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    }, []);

    const pageCount = pool !== null ? Math.max(1, Math.ceil(pool.length / WINDOW_SIZE)) : 0;
    const safePageIndex = pageCount > 0 ? pageIndex % pageCount : 0;
    const windowItems = pool !== null ? pool.slice(safePageIndex * WINDOW_SIZE, safePageIndex * WINDOW_SIZE + WINDOW_SIZE) : [];
    // The seek animation runs unless paused (hover/focus/pause toggle or
    // reduced motion). Pausing freezes the fill via animation-play-state,
    // so it resumes exactly where it stopped.
    const seekRunning = playing && !interacting && !reducedMotion && windowItems.length > 0;

    const onSeekEnd = React.useCallback(() => {
        if (!seekRunning) {
            return;
        }
        setActiveIndex((current) => {
            const next = current + 1;
            if (next < Math.min(WINDOW_SIZE, windowItems.length)) {
                return next;
            }
            setPageIndex((currentPage) => pageCount > 0 ? (currentPage + 1) % pageCount : 0);
            return 0;
        });
    }, [seekRunning, windowItems.length, pageCount]);

    const goTo = React.useCallback((nextPage, nextActive) => {
        if (pageCount === 0) {
            return;
        }
        setPageIndex(((nextPage % pageCount) + pageCount) % pageCount);
        setActiveIndex(((nextActive % WINDOW_SIZE) + WINDOW_SIZE) % WINDOW_SIZE);
    }, [pageCount]);

    const onPrevious = React.useCallback(() => {
        const flat = safePageIndex * WINDOW_SIZE + activeIndex - 1;
        goTo(Math.floor(flat / WINDOW_SIZE), flat % WINDOW_SIZE);
    }, [goTo, safePageIndex, activeIndex]);
    const onNext = React.useCallback(() => {
        const flat = safePageIndex * WINDOW_SIZE + activeIndex + 1;
        goTo(Math.floor(flat / WINDOW_SIZE), flat % WINDOW_SIZE);
    }, [goTo, safePageIndex, activeIndex]);
    const onTogglePlaying = React.useCallback(() => setPlaying((prev) => !prev), []);

    const onMouseEnter = React.useCallback(() => setInteracting(true), []);
    const onMouseLeave = React.useCallback(() => setInteracting(false), []);
    const onFocusCapture = React.useCallback(() => setInteracting(true), []);
    const onBlurCapture = React.useCallback(() => setInteracting(false), []);

    return (
        <div
            className={classnames(className, styles['banner-slider-container'])}
            onMouseEnter={onMouseEnter}
            onMouseLeave={onMouseLeave}
            onFocusCapture={onFocusCapture}
            onBlurCapture={onBlurCapture}
        >
            {
                windowItems.length === 0 ?
                    <div className={styles['slider-placeholder']} aria-hidden={true} />
                    :
                    <div className={styles['slider-stage']} role={'region'} aria-label={t('BANNER_TRENDING', 'Trending now')}>
                        <div className={styles['slide']}>
                            {
                                windowItems.map((item, itemIndex) => (
                                    <SlideItem
                                        key={`${item.type}:${item.id}`}
                                        item={item}
                                        active={itemIndex === activeIndex}
                                        rotateKey={`${safePageIndex}:${activeIndex}`}
                                        seekRunning={seekRunning}
                                        onSeekEnd={onSeekEnd}
                                    />
                                ))
                            }
                        </div>
                        <button
                            className={classnames(styles['arrow-button'], styles['arrow-previous'])}
                            onClick={onPrevious}
                            aria-label={t('BANNER_PREVIOUS', 'Previous slide')}
                            title={t('BANNER_PREVIOUS', 'Previous slide')}
                        >
                            <Icon className={styles['arrow-icon']} name={'chevron-back'} />
                        </button>
                        <button
                            className={classnames(styles['arrow-button'], styles['arrow-next'])}
                            onClick={onNext}
                            aria-label={t('BANNER_NEXT', 'Next slide')}
                            title={t('BANNER_NEXT', 'Next slide')}
                        >
                            <Icon className={styles['arrow-icon']} name={'chevron-forward'} />
                        </button>
                        <div className={styles['controls-layer']}>
                            <div className={styles['dots-container']} role={'tablist'} aria-label={t('BANNER_SLIDES', 'Featured titles')}>
                                {
                                    Array(pageCount).fill(null).map((_, dotIndex) => (
                                        <button
                                            key={`dot-${dotIndex}`}
                                            className={classnames(styles['dot'], { [styles['dot-active']]: dotIndex === safePageIndex })}
                                            onClick={() => goTo(dotIndex, 0)}
                                            role={'tab'}
                                            aria-selected={dotIndex === safePageIndex}
                                            aria-label={`${t('BANNER_GO_TO_SLIDE', 'Go to slide')} ${dotIndex + 1}`}
                                        />
                                    ))
                                }
                            </div>
                            <button
                                className={styles['play-pause-button']}
                                onClick={onTogglePlaying}
                                aria-label={playing ? t('BANNER_PAUSE', 'Pause carousel') : t('BANNER_PLAY', 'Play carousel')}
                                title={playing ? t('BANNER_PAUSE', 'Pause carousel') : t('BANNER_PLAY', 'Play carousel')}
                            >
                                <Icon className={styles['play-pause-icon']} name={playing ? 'pause' : 'play'} />
                            </button>
                        </div>
                    </div>
            }
        </div>
    );
};

BannerSlider.propTypes = {
    className: PropTypes.string
};

module.exports = BannerSlider;
