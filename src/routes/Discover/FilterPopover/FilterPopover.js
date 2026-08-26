// Copyright (C) 2017-2026 Smart code 203358507

const React = require('react');
const ReactDOM = require('react-dom');
const PropTypes = require('prop-types');
const { useTranslation } = require('react-i18next');
const classnames = require('classnames');
const { MultiselectMenu } = require('stremio/components');
const styles = require('./styles');

const RATING_PRESETS = [
    { value: null, labelKey: 'DISCOVER_ANY_RATING', fallback: 'Any' },
    { value: 6, label: '6+' },
    { value: 7, label: '7+' },
    { value: 8, label: '8+' }
];

const PERIOD_PRESETS = [
    { value: null, labelKey: 'DISCOVER_ANY_PERIOD', fallback: 'Any' },
    { value: 2020, label: '2020s' },
    { value: 2010, label: '2010s' },
    { value: 2000, label: '2000s' },
    { value: 1990, label: '1990s' }
];

const SORT_PRESETS = [
    { value: 'default', labelKey: 'DISCOVER_SORT_DEFAULT', fallback: 'Recommended' },
    { value: 'name', labelKey: 'DISCOVER_SORT_NAME', fallback: 'A to Z' },
    { value: 'year_new', labelKey: 'DISCOVER_SORT_YEAR_NEW', fallback: 'Newest' },
    { value: 'rating', labelKey: 'DISCOVER_SORT_RATING', fallback: 'Top rated' }
];

const ChipGroup = ({ title, options, value, onSelect }) => {
    return (
        <section className={styles['popover-section']}>
            <div className={styles['section-title']}>{title}</div>
            <div className={styles['chip-group']}>
                {options.map((option) => {
                    const selected = option.selected !== undefined ? option.selected : option.value === value;
                    return (
                        <button
                            key={String(option.value)}
                            className={classnames(styles['chip'], { [styles['selected']]: selected })}
                            onClick={() => onSelect(option.value)}
                            aria-pressed={selected}
                        >
                            {option.label}
                        </button>
                    );
                })}
            </div>
        </section>
    );
};

ChipGroup.propTypes = {
    title: PropTypes.string.isRequired,
    options: PropTypes.array.isRequired,
    value: PropTypes.any,
    onSelect: PropTypes.func.isRequired
};

const FilterPopover = ({
    open,
    onClose,
    anchorRef,
    filters,
    onFilterChange,
    genreChips,
    extraSelects,
    resultCount,
    totalCount,
    onResetFilters,
    moreAvailable
}) => {
    const { t } = useTranslation();
    const popoverRef = React.useRef(null);
    // Like the MultiselectMenu dropdown: the panel is portaled to <body>
    // with fixed coordinates measured from the anchor button, so no
    // ancestor stacking context / overflow can ever hide or clip it.
    const [placement, setPlacement] = React.useState(null);

    React.useLayoutEffect(() => {
        if (!open) {
            setPlacement(null);
            return;
        }
        const rect = anchorRef?.current?.getBoundingClientRect();
        if (rect === undefined || rect === null) {
            return;
        }
        const POPOVER_WIDTH = 320;
        const GAP = 8;
        const spaceBelow = window.innerHeight - rect.bottom - GAP;
        const spaceAbove = rect.top - GAP;
        const openUp = spaceBelow < 260 && spaceAbove > spaceBelow;
        const maxHeight = Math.max(200, Math.min(672, openUp ? spaceAbove : spaceBelow));
        const left = Math.max(GAP, Math.min(rect.right - POPOVER_WIDTH, window.innerWidth - POPOVER_WIDTH - GAP));
        setPlacement({
            left,
            width: POPOVER_WIDTH,
            maxHeight,
            ...(openUp ?
                { bottom: window.innerHeight - rect.top - GAP }
                :
                { top: rect.bottom + GAP })
        });
    }, [open, anchorRef]);

    React.useEffect(() => {
        if (!open) {
            return;
        }
        const onKeyDown = (event) => {
            if (event.key === 'Escape') {
                event.stopPropagation();
                onClose();
            }
        };
        const onMouseDown = (event) => {
            const target = event.target;
            if (popoverRef.current !== null && target instanceof Node && popoverRef.current.contains(target)) {
                return;
            }
            onClose();
        };
        const onScroll = (event) => {
            const target = event.target;
            if (popoverRef.current !== null && target instanceof Node && popoverRef.current.contains(target)) {
                return;
            }
            onClose();
        };
        document.addEventListener('keydown', onKeyDown, true);
        document.addEventListener('mousedown', onMouseDown, true);
        window.addEventListener('scroll', onScroll, true);
        return () => {
            document.removeEventListener('keydown', onKeyDown, true);
            document.removeEventListener('mousedown', onMouseDown, true);
            window.removeEventListener('scroll', onScroll, true);
        };
    }, [open, onClose]);

    if (!open || placement === null) {
        return null;
    }

    const selectedPeriod = PERIOD_PRESETS.find((preset) =>
        preset.value !== null && filters.yearFrom === preset.value && filters.yearTo === preset.value + 9
    )?.value ?? null;

    return ReactDOM.createPortal(
        <div
            className={styles['popover-portal']}
            style={{
                left: `${placement.left}px`,
                width: `${placement.width}px`,
                ...(placement.bottom !== undefined ?
                    { bottom: `${placement.bottom}px` }
                    :
                    { top: `${placement.top}px` })
            }}
        >
            <div
                ref={popoverRef}
                className={styles['popover']}
                style={{ maxHeight: `${placement.maxHeight}px` }}
                role={'dialog'}
                aria-label={t('DISCOVER_FILTERS', 'Filters')}
            >
                <div className={styles['popover-content']}>
                    {
                        Array.isArray(genreChips) && genreChips.length > 0 ?
                    <ChipGroup
                        title={t('DISCOVER_GENRE', 'Genre')}
                        options={genreChips.map((chip) => ({
                            value: chip.key,
                            label: chip.label,
                            selected: chip.selected
                        }))}
                        onSelect={(value) => {
                            const chip = genreChips.find((candidate) => candidate.key === value);
                            if (chip) {
                                chip.onSelect();
                            }
                            onClose();
                        }}
                            />
                            :
                            null
                    }
                    <ChipGroup
                        title={t('DISCOVER_SORT', 'Sort by')}
                        options={SORT_PRESETS.map((preset) => ({
                            value: preset.value,
                            label: preset.labelKey !== undefined ? t(preset.labelKey, preset.fallback) : preset.label
                        }))}
                        value={filters.sort}
                        onSelect={(value) => onFilterChange('sort', value)}
                    />
                    <ChipGroup
                        title={t('DISCOVER_MIN_RATING', 'Minimum IMDb rating')}
                        options={RATING_PRESETS.map((preset) => ({
                            value: preset.value,
                            label: preset.labelKey !== undefined ? t(preset.labelKey, preset.fallback) : preset.label
                        }))}
                        value={filters.minRating}
                        onSelect={(value) => onFilterChange('minRating', value)}
                    />
                    <ChipGroup
                        title={t('DISCOVER_DECADE', 'Period')}
                        options={PERIOD_PRESETS.map((preset) => ({
                            value: preset.value,
                            label: preset.labelKey !== undefined ? t(preset.labelKey, preset.fallback) : preset.label
                        }))}
                        value={selectedPeriod}
                        onSelect={(value) => {
                            if (value === null) {
                                onFilterChange('yearFrom', null);
                                onFilterChange('yearTo', null);
                            } else {
                                onFilterChange('yearFrom', value);
                                onFilterChange('yearTo', value + 9);
                            }
                        }}
                    />
                    <section className={styles['popover-section']}>
                        <div className={styles['section-title']}>{t('DISCOVER_LIBRARY', 'Library')}</div>
                        <button
                            className={classnames(styles['toggle-row'], { [styles['selected']]: filters.hideWatched })}
                            onClick={() => onFilterChange('hideWatched', !filters.hideWatched)}
                            aria-pressed={filters.hideWatched}
                        >
                            <span className={styles['toggle-label']}>{t('DISCOVER_HIDE_WATCHED', 'Hide watched')}</span>
                            <span className={styles['toggle-switch']}>
                                <span className={styles['toggle-knob']} />
                            </span>
                        </button>
                        <button
                            className={classnames(styles['toggle-row'], { [styles['selected']]: filters.hideUnrated })}
                            onClick={() => onFilterChange('hideUnrated', !filters.hideUnrated)}
                            aria-pressed={filters.hideUnrated}
                        >
                            <span className={styles['toggle-label']}>{t('DISCOVER_HIDE_UNRATED', 'Hide unrated')}</span>
                            <span className={styles['toggle-switch']}>
                                <span className={styles['toggle-knob']} />
                            </span>
                        </button>
                    </section>
                    <section className={styles['popover-section']}>
                        <div className={styles['section-title']}>{t('DISCOVER_POSTER_SIZE', 'Poster size')}</div>
                        <div className={styles['chip-group']}>
                            {['s', 'm', 'l'].map((size) => (
                                <button
                                    key={size}
                                    className={classnames(styles['chip'], { [styles['selected']]: filters.poster === size })}
                                    onClick={() => onFilterChange('poster', size)}
                                    aria-pressed={filters.poster === size}
                                >
                                    {size.toUpperCase()}
                                </button>
                            ))}
                        </div>
                    </section>
                    {
                        Array.isArray(extraSelects) && extraSelects.length > 0 ?
                            <section className={styles['popover-section']}>
                                <div className={styles['section-title']}>{t('DISCOVER_MORE_FILTERS', 'More filters')}</div>
                                <div className={styles['extra-selects']}>
                                    {extraSelects.map(({ title, options, value, onSelect }, index) => (
                                        <MultiselectMenu
                                            key={index}
                                            className={styles['extra-select']}
                                            title={title}
                                            options={options}
                                            value={value}
                                            onSelect={onSelect}
                                        />
                                    ))}
                                </div>
                            </section>
                            :
                            null
                    }
                </div>
                <div className={styles['popover-footer']}>
                    <div className={styles['results-count']}>
                        {
                            moreAvailable && resultCount !== totalCount ?
                                t('DISCOVER_LOADED_TITLES', '{{result}} of {{total}} loaded')
                                    .replace('{{result}}', String(resultCount))
                                    .replace('{{total}}', String(totalCount))
                                :
                                t('DISCOVER_TITLES_COUNT', '{{count}} titles').replace('{{count}}', String(totalCount))
                        }
                    </div>
                    <button
                        className={styles['reset-button']}
                        onClick={onResetFilters}
                    >
                        {t('DISCOVER_RESET_FILTERS', 'Reset')}
                    </button>
                </div>
            </div>
        </div>,
        document.body
    );
};

FilterPopover.propTypes = {
    open: PropTypes.bool.isRequired,
    onClose: PropTypes.func.isRequired,
    anchorRef: PropTypes.object,
    filters: PropTypes.shape({
        minRating: PropTypes.number,
        yearFrom: PropTypes.number,
        yearTo: PropTypes.number,
        hideWatched: PropTypes.bool.isRequired,
        hideUnrated: PropTypes.bool.isRequired,
        sort: PropTypes.string.isRequired,
        poster: PropTypes.string.isRequired
    }).isRequired,
    onFilterChange: PropTypes.func.isRequired,
    genreChips: PropTypes.arrayOf(PropTypes.shape({
        key: PropTypes.string.isRequired,
        label: PropTypes.string.isRequired,
        selected: PropTypes.bool,
        onSelect: PropTypes.func.isRequired
    })),
    extraSelects: PropTypes.arrayOf(PropTypes.object),
    resultCount: PropTypes.number.isRequired,
    totalCount: PropTypes.number.isRequired,
    onResetFilters: PropTypes.func.isRequired,
    moreAvailable: PropTypes.bool
};

module.exports = FilterPopover;
