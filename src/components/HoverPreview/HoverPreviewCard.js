// Copyright (C) 2017-2026 Smart code 203358507

const React = require('react');
const PropTypes = require('prop-types');
const { useTranslation } = require('react-i18next');
const { default: Icon } = require('@stremio/stremio-icons/react');
const { default: Image } = require('stremio/components/Image');
const { useNavigateWithOrigin } = require('stremio-router');
const { fetchCinemetaMeta } = require('stremio/common/ratings');
const { useTranslatedText } = require('stremio/common/translate');
const useProfile = require('stremio/common/useProfile');
const styles = require('./styles');

const IMDB_LABEL = 'IMDb';
const PREVIEW_WIDTH = 20;
const PREVIEW_HEIGHT_ESTIMATE = 21;

const toImdbId = (id) => {
    if (typeof id !== 'string') {
        return null;
    }
    const match = id.match(/^(tt\d+)/);
    return match !== null ? match[1] : null;
};

const pickTrailer = (meta) => {
    if (!Array.isArray(meta?.trailerStreams)) {
        return null;
    }
    return meta.trailerStreams.find((stream) => typeof stream?.ytId === 'string' && stream.ytId.length > 0) ??
        meta.trailerStreams.find((stream) => typeof stream?.url === 'string' && stream.url.length > 0) ??
        null;
};

// Netflix-style hover preview: trailer video on top, key info below.
// Full meta (trailer, genres, description) is fetched lazily on open and
// cached module-wide by the ratings service.
const HoverPreviewCard = ({ type, id, name, poster, imdbRating, releaseInfo, rect, onClose, onKeep }) => {
    const { t } = useTranslation();
    const { navigateWithOrigin } = useNavigateWithOrigin();
    const profile = useProfile();
    const imdbId = toImdbId(id);
    const [meta, setMeta] = React.useState(null);

    React.useEffect(() => {
        setMeta(null);
        if (imdbId === null || (type !== 'movie' && type !== 'series')) {
            return;
        }
        let cancelled = false;
        fetchCinemetaMeta(type, imdbId).then((result) => {
            if (!cancelled) {
                setMeta(result);
            }
        });
        return () => {
            cancelled = true;
        };
    }, [type, imdbId]);

    const trailer = React.useMemo(() => pickTrailer(meta), [meta]);
    const rawDescription = typeof meta?.description === 'string' ? meta.description : '';
    const translatedDescription = useTranslatedText(rawDescription, profile.settings?.interfaceLanguage);
    const description = translatedDescription ?? rawDescription;
    const genres = Array.isArray(meta?.genres) ? meta.genres.slice(0, 3) : [];

    const position = React.useMemo(() => {
        if (rect === null) {
            return { left: 0, top: 0 };
        }
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        let left = rect.left;
        if (left + PREVIEW_WIDTH + 1 > viewportWidth / 2 && rect.right - PREVIEW_WIDTH - 1 >= 0) {
            left = rect.right - PREVIEW_WIDTH;
        }
        left = Math.max(0.5, Math.min(left, viewportWidth - PREVIEW_WIDTH - 0.5));
        const top = Math.max(0.5, Math.min(rect.top - 1, viewportHeight - PREVIEW_HEIGHT_ESTIMATE - 0.5));
        return { left, top };
    }, [rect]);

    React.useEffect(() => {
        const onKeyDown = (event) => {
            if (event.key === 'Escape') {
                onClose();
            }
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [onClose]);

    const youtubeEmbed = trailer !== null && typeof trailer.ytId === 'string' ?
        `https://www.youtube-nocookie.com/embed/${encodeURIComponent(trailer.ytId)}?autoplay=1&mute=1&controls=0&loop=1&playlist=${encodeURIComponent(trailer.ytId)}&modestbranding=1&rel=0&enablejsapi=1&cc_load_policy=0&iv_load_policy=3&disablekb=1&fs=0`
        :
        null;

    const onDetailsClick = React.useCallback((event) => {
        event.preventDefault();
        onClose();
        navigateWithOrigin(`/metadetails/${type}/${encodeURIComponent(id)}`);
    }, [onClose, navigateWithOrigin, type, id]);

    const iframeRef = React.useRef(null);
    const [muted, setMuted] = React.useState(true);
    const onToggleMute = React.useCallback(() => {
        setMuted((prev) => {
            const next = !prev;
            try {
                iframeRef.current?.contentWindow?.postMessage(JSON.stringify({ event: 'command', func: next ? 'mute' : 'unMute', args: [] }), '*');
            } catch (_e) {
                // embed not ready yet: state stays in sync for the next toggle
            }
            return next;
        });
    }, []);

    return (
        <div
            className={styles['hover-preview-container']}
            style={{ left: `${position.left}rem`, top: `${position.top}rem` }}
            onMouseEnter={onKeep}
            onMouseLeave={onClose}
        >
            <div className={styles['video-container']}>
                {
                    youtubeEmbed !== null ?
                        <iframe
                            ref={iframeRef}
                            className={styles['video-frame']}
                            src={youtubeEmbed}
                            title={typeof name === 'string' ? name : 'trailer'}
                            allow={'autoplay; encrypted-media'}
                            referrerPolicy={'strict-origin-when-cross-origin'}
                            frameBorder={0}
                        />
                        :
                        trailer !== null && typeof trailer.url === 'string' ?
                            <video className={styles['video-frame']} src={trailer.url} autoPlay muted loop playsInline />
                            :
                            <Image
                                className={styles['video-poster']}
                                src={meta?.background ?? poster}
                                alt={' '}
                                renderFallback={() => null}
                            />
                }
                {
                    youtubeEmbed !== null ?
                        <div className={styles['video-top-scrim']} />
                        :
                        null
                }
                {
                    trailer !== null ?
                        <button
                            className={styles['mute-button']}
                            onClick={(event) => { event.preventDefault(); event.stopPropagation(); onToggleMute(); }}
                            aria-label={muted ? t('PLAYER_UNMUTE', 'Unmute') : t('PLAYER_MUTE', 'Mute')}
                            title={muted ? t('PLAYER_UNMUTE', 'Unmute') : t('PLAYER_MUTE', 'Mute')}
                        >
                            <Icon className={styles['mute-icon']} name={muted ? 'volume-mute' : 'volume-high'} />
                        </button>
                        :
                        null
                }
            </div>
            <div className={styles['info-container']}>
                <div className={styles['title-label']}>{name}</div>
                <div className={styles['meta-row']}>
                    {
                        imdbRating !== null && imdbRating !== undefined && parseFloat(imdbRating) > 0 ?
                            <span className={styles['rating-badge']}>
                                <span className={styles['rating-source']}>{IMDB_LABEL}</span>
                                <span className={styles['rating-value']}>{imdbRating}</span>
                            </span>
                            :
                            null
                    }
                    {
                        typeof releaseInfo === 'string' && releaseInfo.length > 0 ?
                            <span className={styles['meta-label']}>{releaseInfo}</span>
                            :
                            null
                    }
                    {
                        genres.length > 0 ?
                            <span className={styles['meta-label']}>{genres.join(' · ')}</span>
                            :
                            null
                    }
                </div>
                {
                    description.length > 0 ?
                        <div className={styles['description-label']}>{description}</div>
                        :
                        null
                }
                <a className={styles['details-button']} href={`/metadetails/${type}/${encodeURIComponent(id)}`} onClick={onDetailsClick}>
                    <Icon className={styles['button-icon']} name={'information-outline'} />
                    <span>{t('BUTTON_DETAILS', 'Details')}</span>
                </a>
            </div>
        </div>
    );
};

HoverPreviewCard.propTypes = {
    type: PropTypes.string,
    id: PropTypes.string,
    name: PropTypes.string,
    poster: PropTypes.string,
    imdbRating: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    releaseInfo: PropTypes.string,
    rect: PropTypes.shape({
        left: PropTypes.number,
        right: PropTypes.number,
        top: PropTypes.number,
        height: PropTypes.number
    }),
    onClose: PropTypes.func,
    onKeep: PropTypes.func
};

module.exports = HoverPreviewCard;
