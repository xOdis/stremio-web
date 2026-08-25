// Copyright (C) 2017-2026 Smart code 203358507

const React = require('react');
const PropTypes = require('prop-types');
const classnames = require('classnames');
const { useNavigate } = require('react-router');
const { useTranslation } = require('react-i18next');
const { default: Icon } = require('@stremio/stremio-icons/react');
const { default: Image } = require('stremio/components/Image');
const { useRelatedTitles } = require('stremio/common/related');
const styles = require('./styles');

const SKELETON_COUNT = 8;

const RelatedCard = ({ item }) => {
    const navigate = useNavigate();
    const onOpen = React.useCallback((event) => {
        event.preventDefault();
        navigate(item.href);
    }, [item.href, navigate]);
    return (
        <a
            className={styles['related-card']}
            href={item.href}
            onClick={onOpen}
            title={item.name}
        >
            <div className={styles['card-poster']}>
                <Image
                    className={styles['card-image']}
                    src={item.poster ?? item.background}
                    alt={' '}
                    renderFallback={() => null}
                />
                <div className={styles['card-hover-layer']}>
                    <Icon className={styles['card-hover-icon']} name={'play'} />
                </div>
            </div>
            <div className={styles['card-info']}>
                <div className={styles['card-title']}>{item.name}</div>
                <div className={styles['card-meta']}>
                    {
                        item.imdbRating !== null && item.imdbRating !== undefined && parseFloat(item.imdbRating) > 0 ?
                            <span className={styles['card-rating']}>{'IMDb ' + item.imdbRating}</span>
                            :
                            null
                    }
                    {
                        typeof item.releaseInfo === 'string' && item.releaseInfo.length > 0 ?
                            <span className={styles['card-year']}>{item.releaseInfo}</span>
                            :
                            null
                    }
                </div>
            </div>
        </a>
    );
};

RelatedCard.propTypes = {
    item: PropTypes.shape({
        href: PropTypes.string,
        name: PropTypes.string,
        background: PropTypes.string,
        poster: PropTypes.string,
        imdbRating: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
        releaseInfo: PropTypes.string
    })
};

const RelatedRow = ({ title, items }) => {
    if (!Array.isArray(items) || items.length === 0) {
        return null;
    }
    return (
        <div className={styles['related-row']}>
            <div className={styles['row-title']}>
                <span>{title}</span>
                <Icon className={styles['row-title-icon']} name={'chevron-forward'} />
            </div>
            <div className={styles['row-items']}>
                {items.map((item) => (
                    <RelatedCard key={`${item.type}:${item.id}`} item={item} />
                ))}
            </div>
        </div>
    );
};

RelatedRow.propTypes = {
    title: PropTypes.string,
    items: PropTypes.array
};

const SkeletonRow = () => (
    <div className={styles['related-row']} aria-hidden={true}>
        <div className={classnames(styles['row-title'], styles['skeleton'])} />
        <div className={styles['row-items']}>
            {Array(SKELETON_COUNT).fill(null).map((_, index) => (
                <div key={index} className={classnames(styles['related-card'], styles['skeleton-card'])} />
            ))}
        </div>
    </div>
);

const RelatedOverlay = ({ className, metaItem, onClose }) => {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const related = useRelatedTitles(metaItem?.type, metaItem?.id);
    const finished = related.finishedMeta;
    const renderLogoFallback = React.useCallback(() => (
        typeof finished?.name === 'string' ?
            <div className={styles['logo-placeholder']}>{finished.name}</div>
            :
            null
    ), [finished]);
    const onCloseRequest = React.useCallback(() => {
        if (typeof onClose === 'function') {
            onClose();
        }
    }, [onClose]);
    const onBackClick = React.useCallback(() => {
        onCloseRequest();
        navigate(-1);
    }, [onCloseRequest, navigate]);
    React.useEffect(() => {
        const onKeyDown = (event) => {
            if (event.key === 'Escape') {
                onCloseRequest();
            }
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [onCloseRequest]);
    return (
        <div className={classnames(className, styles['related-overlay-container'])}>
            <div className={styles['overlay-background']}>
                {
                    related.finishedMeta !== null ?
                        <Image
                            className={styles['overlay-background-image']}
                            src={related.finishedMeta.background ?? related.finishedMeta.poster ?? null}
                            alt={' '}
                            renderFallback={() => null}
                        />
                        :
                        null
                }
                <div className={styles['overlay-scrim']} />
            </div>
            <div className={styles['overlay-content']}>
                <div className={styles['overlay-header']}>
                    <div className={styles['header-text']}>
                        <div className={styles['header-eyebrow']}>{t('RELATED_BECAUSE_WATCHED', 'Because you watched')}</div>
                        {
                            finished !== null ?
                                <Image
                                    className={styles['header-logo']}
                                    src={finished.logo ?? null}
                                    alt={finished.name}
                                    renderFallback={renderLogoFallback}
                                />
                                :
                                null
                        }
                    </div>
                    <div className={styles['header-buttons']}>
                        <button
                            className={styles['header-button']}
                            onClick={onBackClick}
                            aria-label={t('PLAYER_NEXT_VIDEO_BUTTON_DISMISS', 'Dismiss')}
                            title={t('PLAYER_NEXT_VIDEO_BUTTON_DISMISS', 'Dismiss')}
                        >
                            <Icon className={styles['header-button-icon']} name={'chevron-back'} />
                        </button>
                        <button
                            className={styles['header-button']}
                            onClick={onCloseRequest}
                            aria-label={t('RELATED_CANCEL', 'Cancel')}
                            title={t('RELATED_CANCEL', 'Cancel')}
                        >
                            <Icon className={styles['header-button-icon']} name={'close'} />
                        </button>
                    </div>
                </div>
                <div className={styles['overlay-rows']}>
                    {
                        related.loading ?
                            <React.Fragment>
                                <SkeletonRow />
                                <SkeletonRow />
                            </React.Fragment>
                            :
                            related.error || (related.series.length === 0 && related.movies.length === 0) ?
                                <div className={styles['overlay-message']}>{t('RELATED_EMPTY', 'No related titles found.')}</div>
                                :
                                <React.Fragment>
                                    <RelatedRow title={t('RELATED_MORE_SERIES', 'More series like this')} items={related.series} />
                                    <RelatedRow title={t('RELATED_SIMILAR_MOVIES', 'Similar movies')} items={related.movies} />
                                </React.Fragment>
                    }
                </div>
            </div>
        </div>
    );
};

RelatedOverlay.propTypes = {
    className: PropTypes.string,
    metaItem: PropTypes.object,
    onClose: PropTypes.func
};

module.exports = RelatedOverlay;
