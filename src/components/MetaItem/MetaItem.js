// Copyright (C) 2017-2023 Smart code 203358507

const React = require('react');
const ReactDOM = require('react-dom');
const PropTypes = require('prop-types');
const classnames = require('classnames');
const { useTranslation } = require('react-i18next');
const filterInvalidDOMProps = require('filter-invalid-dom-props').default;
const { default: Icon } = require('@stremio/stremio-icons/react');
const { useNavigateWithOrigin } = require('stremio-router');
const { default: Button } = require('stremio/components/Button');
const { default: Image } = require('stremio/components/Image');
const Multiselect = require('stremio/components/Multiselect');
const HoverPreviewCard = require('stremio/components/HoverPreview/HoverPreviewCard');
const useBinaryState = require('stremio/common/useBinaryState');
const { default: getMetaDetailsHref } = require('stremio/common/getMetaDetailsHref');
const { ICON_FOR_TYPE } = require('stremio/common/CONSTANTS');
const RatingBadge = require('./RatingBadge');
const styles = require('./styles');

const MetaItem = React.memo(({ className, type, id, name, poster, posterShape, posterChangeCursor, progress, newVideos, subtitleLabel, subtitleTitle, options, deepLinks, href: customHref, imdbRating, releaseInfo, dataset, optionOnSelect, onDismissClick, onPlayClick, watched, ...props }) => {
    const { t } = useTranslation();
    const { navigateWithOrigin } = useNavigateWithOrigin();
    const [menuOpen, onMenuOpen, onMenuClose] = useBinaryState(false);
    const href = React.useMemo(() => {
        return typeof customHref === 'string' ? customHref : getMetaDetailsHref(deepLinks);
    }, [customHref, deepLinks]);
    const metaItemOnClick = React.useCallback((event) => {
        if (event.nativeEvent.selectPrevented) {
            event.preventDefault();
        } else if (typeof href === 'string') {
            event.preventDefault();
            navigateWithOrigin(href);
        } else if (typeof props.onClick === 'function') {
            props.onClick(event);
        }
    }, [href, navigateWithOrigin, props.onClick]);
    const menuOnClick = React.useCallback((event) => {
        event.nativeEvent.selectPrevented = true;
    }, []);
    const dismissOnClick = React.useCallback((event) => {
        event.preventDefault();
        event.stopPropagation();
        onDismissClick(event);
    }, [onDismissClick]);
    const playOnClick = React.useCallback((event) => {
        event.preventDefault();
        event.stopPropagation();
        onPlayClick(event);
    }, [onPlayClick]);
    const menuOnSelect = React.useCallback((event) => {
        if (typeof optionOnSelect === 'function') {
            optionOnSelect({
                type: 'select-option',
                value: event.value,
                dataset: dataset,
                reactEvent: event.reactEvent,
                nativeEvent: event.nativeEvent
            });
        }
    }, [dataset, optionOnSelect]);
    const renderPosterFallback = React.useCallback(() => (
        <Icon
            className={styles['placeholder-icon']}
            name={ICON_FOR_TYPE.has(type) ? ICON_FOR_TYPE.get(type) : ICON_FOR_TYPE.get('other')}
        />
    ), [type]);
    const renderMenuLabelContent = React.useCallback(() => (
        <Icon className={styles['icon']} name={'more-vertical'} />
    ), []);
    const hasReleaseInfo = typeof releaseInfo === 'string' && releaseInfo.length > 0 || typeof releaseInfo === 'number' && !isNaN(releaseInfo);
    const hasRating = imdbRating !== null && imdbRating !== undefined && String(imdbRating).trim() !== '' && parseFloat(imdbRating) > 0;

    // Netflix-style hover preview: after 3s of hover on pointer devices,
    // an expanded card with an auto-playing trailer opens near the poster.
    const hoverCapable = React.useMemo(() => {
        return typeof window.matchMedia === 'function' &&
            window.matchMedia('(hover: hover) and (pointer: fine)').matches &&
            !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    }, []);
    const [hoverPreviewRect, setHoverPreviewRect] = React.useState(null);
    const hoverTimerRef = React.useRef(null);
    const hoverCloseTimerRef = React.useRef(null);
    const closeHoverPreview = React.useCallback(() => {
        if (hoverCloseTimerRef.current !== null) {
            return;
        }
        hoverCloseTimerRef.current = setTimeout(() => {
            hoverCloseTimerRef.current = null;
            setHoverPreviewRect(null);
        }, 150);
    }, []);
    const keepHoverPreview = React.useCallback(() => {
        if (hoverCloseTimerRef.current !== null) {
            clearTimeout(hoverCloseTimerRef.current);
            hoverCloseTimerRef.current = null;
        }
    }, []);
    const onItemMouseEnter = React.useCallback((event) => {
        if (!hoverCapable || typeof id !== 'string' || !id.startsWith('tt')) {
            return;
        }
        const targetRect = event.currentTarget.getBoundingClientRect();
        hoverTimerRef.current = setTimeout(() => {
            hoverTimerRef.current = null;
            setHoverPreviewRect({
                left: targetRect.left / parseFloat(window.getComputedStyle(document.documentElement).fontSize),
                right: targetRect.right / parseFloat(window.getComputedStyle(document.documentElement).fontSize),
                top: targetRect.top / parseFloat(window.getComputedStyle(document.documentElement).fontSize),
                height: targetRect.height / parseFloat(window.getComputedStyle(document.documentElement).fontSize)
            });
        }, 1000);
    }, [hoverCapable, id]);
    const onItemMouseLeave = React.useCallback(() => {
        if (hoverTimerRef.current !== null) {
            clearTimeout(hoverTimerRef.current);
            hoverTimerRef.current = null;
        }
        if (hoverPreviewRect !== null) {
            closeHoverPreview();
        }
    }, [hoverPreviewRect, closeHoverPreview]);
    React.useEffect(() => () => {
        if (hoverTimerRef.current !== null) clearTimeout(hoverTimerRef.current);
        if (hoverCloseTimerRef.current !== null) clearTimeout(hoverCloseTimerRef.current);
    }, []);
    return (
        <React.Fragment>
            <Button title={name} href={href} {...filterInvalidDOMProps(props)} className={classnames(className, styles['meta-item-container'], styles['poster-shape-poster'], styles[`poster-shape-${posterShape}`], { 'active': menuOpen })} onClick={metaItemOnClick} onMouseEnter={onItemMouseEnter} onMouseLeave={onItemMouseLeave}>
                <div className={classnames(styles['poster-container'], { 'poster-change-cursor': posterChangeCursor })}>
                    {
                        onDismissClick ?
                            <div title={t('LIBRARY_RESUME_DISMISS')} className={styles['dismiss-icon-layer']} onClick={dismissOnClick}>
                                <Icon className={styles['dismiss-icon']} name={'close'} />
                                <div className={styles['dismiss-icon-backdrop']} />
                            </div>
                            :
                            null
                    }
                    {
                        watched ?
                            <div className={styles['watched-icon-layer']}>
                                <Icon className={styles['watched-icon']} name={'checkmark'} />
                            </div>
                            :
                            null
                    }
                    <div className={styles['poster-image-layer']}>
                        <Image
                            className={styles['poster-image']}
                            src={poster}
                            alt={' '}
                            renderFallback={renderPosterFallback}
                        />
                    </div>
                    {
                        onPlayClick ?
                            <div title={t('CONTINUE_WATCHING')} className={styles['play-icon-layer']} onClick={playOnClick}>
                                <Icon className={styles['play-icon']} name={'play'} />
                                <div className={styles['play-icon-outer']} />
                                <div className={styles['play-icon-background']} />
                            </div>
                            :
                            null
                    }
                    {
                        (typeof subtitleLabel === 'string' && subtitleLabel.length > 0) || (typeof subtitleTitle === 'string' && subtitleTitle.length > 0) ?
                            <div className={styles['subtitle-label-layer']}>
                                {
                                    typeof subtitleLabel === 'string' && subtitleLabel.length > 0 ?
                                        <div className={styles['season-label']}>{subtitleLabel}</div>
                                        :
                                        null
                                }
                                {
                                    typeof subtitleTitle === 'string' && subtitleTitle.length > 0 ?
                                        <div className={styles['title-label']} title={subtitleTitle}>{subtitleTitle}</div>
                                        :
                                        null
                                }
                            </div>
                            :
                            null
                    }
                    {
                        progress > 0 ?
                            <div className={styles['progress-bar-layer']}>
                                <div className={styles['progress-bar']} style={{ width: `${progress}%` }} />
                                <div className={styles['progress-bar-background']} />
                            </div>
                            :
                            null
                    }
                    {
                        newVideos > 0 ?
                            <div className={styles['new-videos']}>
                                <div className={styles['layer']} />
                                <div className={styles['layer']} />
                                <div className={styles['layer']}>
                                    <Icon className={styles['icon']} name={'add'} />
                                    <div className={styles['label']}>
                                        {newVideos}
                                    </div>
                                </div>
                            </div>
                            :
                            null
                    }
                </div>
                {
                    (typeof name === 'string' && name.length > 0) || (Array.isArray(options) && options.length > 0) ?
                        <div className={styles['title-bar-container']}>
                            <div className={styles['title-label']}>
                                {typeof name === 'string' && name.length > 0 ? name : ''}
                            </div>
                            {
                                Array.isArray(options) && options.length > 0 ?
                                    <Multiselect
                                        className={styles['menu-label-container']}
                                        renderLabelContent={renderMenuLabelContent}
                                        options={options}
                                        onOpen={onMenuOpen}
                                        onClose={onMenuClose}
                                        onSelect={menuOnSelect}
                                        tabIndex={-1}
                                        onClick={menuOnClick}
                                    />
                                    :
                                    null
                            }
                        </div>
                        :
                        null
                }
                {
                    hasRating || hasReleaseInfo ?
                        <div className={styles['info-line-container']}>
                            <RatingBadge
                                type={type}
                                id={id}
                                rating={hasRating ? imdbRating : null}
                            />
                            {
                                hasReleaseInfo ?
                                    <div className={styles['release-info-label']}>{releaseInfo}</div>
                                    :
                                    null
                            }
                        </div>
                        :
                        null
                }
            </Button>
            {
                hoverPreviewRect !== null ?
                    ReactDOM.createPortal(
                        <HoverPreviewCard
                            type={type}
                            id={id}
                            name={name}
                            poster={poster}
                            imdbRating={imdbRating}
                            releaseInfo={releaseInfo}
                            rect={hoverPreviewRect}
                            onClose={closeHoverPreview}
                            onKeep={keepHoverPreview}
                        />,
                        document.body
                    )
                    :
                    null
            }
        </React.Fragment>
    );
});

MetaItem.displayName = 'MetaItem';

MetaItem.propTypes = {
    className: PropTypes.string,
    type: PropTypes.string,
    id: PropTypes.string,
    name: PropTypes.string,
    poster: PropTypes.string,
    posterShape: PropTypes.oneOf(['poster', 'landscape', 'square']),
    posterChangeCursor: PropTypes.bool,
    progress: PropTypes.number,
    newVideos: PropTypes.number,
    subtitleLabel: PropTypes.string,
    subtitleTitle: PropTypes.string,
    options: PropTypes.array,
    href: PropTypes.string,
    imdbRating: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    releaseInfo: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    deepLinks: PropTypes.shape({
        metaDetailsVideos: PropTypes.string,
        metaDetailsStreams: PropTypes.string,
        player: PropTypes.string
    }),
    dataset: PropTypes.object,
    optionOnSelect: PropTypes.func,
    onDismissClick: PropTypes.func,
    onPlayClick: PropTypes.func,
    onClick: PropTypes.func,
    watched: PropTypes.bool
};

module.exports = MetaItem;
