// Copyright (C) 2017-2023 Smart code 203358507

const React = require('react');
const { useTranslation } = require('react-i18next');
const { useParams, useNavigate } = require('react-router');
const { useSearchParams } = require('react-router-dom');
const classnames = require('classnames');
const { default: Icon } = require('@stremio/stremio-icons/react');
const { useCore } = require('stremio/core');
const { CONSTANTS, useBinaryState, useOnScrollToBottom, useTranslate, withCoreSuspender } = require('stremio/common');
const { AddonDetailsModal, Button, DelayedRenderer, Image, MainNavBars, MetaItem, MetaPreview, MultiselectMenu } = require('stremio/components');
const { default: toPath } = require('stremio-router/toPath');
const useDiscover = require('./useDiscover');
const useSelectableInputs = require('./useSelectableInputs');
const useDiscoverFilters = require('./useDiscoverFilters');
const FilterPopover = require('./FilterPopover');
const styles = require('./styles');

const SCROLL_TO_BOTTOM_THRESHOLD = 400;
const BACK_TO_TOP_THRESHOLD = 600;

const Discover = () => {
    const { type, transportUrl, catalogId } = useParams();
    const navigate = useNavigate();
    const urlParams = React.useMemo(() => ({
        type,
        transportUrl,
        catalogId
    }), [type, transportUrl, catalogId]);
    const [queryParams, setSearchParams] = useSearchParams();
    const { t } = useTranslation();
    const tString = useTranslate();
    const core = useCore();
    const [discover, loadNextPage, reloadCatalog] = useDiscover(urlParams, queryParams);
    const [selectInputs, hasNextPage, { genreExtra }] = useSelectableInputs(discover);
    const [popoverOpen, openPopover, closePopover] = useBinaryState(false);
    const filterAnchorRef = React.useRef(null);
    const [addonModalOpen, openAddonModal, closeAddonModal] = useBinaryState(false);
    const [selectedMetaItemIndex, setSelectedMetaItemIndex] = React.useState(0);
    const [showBackToTop, setShowBackToTop] = React.useState(false);

    const searchSupported = React.useMemo(() => {
        return Array.isArray(discover.selectable?.extra) && discover.selectable.extra.some(({ name }) => name === 'search');
    }, [discover.selectable]);
    const currentSearch = queryParams.get('search') ?? '';
    const [searchInput, setSearchInput] = React.useState(currentSearch);
    React.useEffect(() => {
        setSearchInput(currentSearch);
    }, [currentSearch, discover.selected]);
    React.useEffect(() => {
        const timer = setTimeout(() => {
            if (searchInput === currentSearch) {
                return;
            }
            const next = new URLSearchParams(queryParams);
            if (searchInput.trim().length > 0) {
                next.set('search', searchInput.trim());
            } else {
                next.delete('search');
            }
            setSearchParams(next, { replace: true });
        }, 400);
        return () => clearTimeout(timer);
    }, [searchInput]);

    const typeSelect = selectInputs[0] ?? null;
    const catalogSelect = selectInputs[1] ?? null;
    const genreIndex = React.useMemo(() => {
        return Array.isArray(discover.selectable?.extra) ?
            discover.selectable.extra.findIndex(({ name }) => name === 'genre')
            :
            -1;
    }, [discover.selectable]);
    const drawerExtraSelects = React.useMemo(() => {
        // selectInputs: [typeSelect, catalogSelect, ...extraSelects] — the
        // catalog select is replaced by quick-switch pills, the genre select
        // by chips; the remaining server-side selects live in the drawer.
        return selectInputs.slice(2).filter((_input, index) => index !== genreIndex);
    }, [selectInputs, genreIndex]);

    const genreChips = React.useMemo(() => {
        if (genreExtra === null || !Array.isArray(genreExtra.options)) {
            return [];
        }
        return genreExtra.options.map(({ value, deepLinks, selected }) => ({
            key: value ?? 'all',
            label: typeof value === 'string' ? tString.string(value) : tString.string('NONE'),
            selected: Boolean(selected),
            onSelect: () => {
                if (deepLinks && deepLinks.discover) {
                    navigate(toPath(deepLinks.discover));
                }
            }
        }));
    }, [genreExtra, tString, navigate]);

    const headerInfo = React.useMemo(() => {
        const catalogs = Array.isArray(discover.selectable?.catalogs) ? discover.selectable.catalogs : [];
        const selectedCatalog = catalogs.find(({ selected }) => selected) ?? null;
        return {
            catalogName: selectedCatalog !== null ? (typeof selectedCatalog.name === 'string' && selectedCatalog.name.length > 0 ? selectedCatalog.name : selectedCatalog.id) : null,
            addonName: selectedCatalog?.addon?.manifest?.name ?? null,
            typeLabel: discover.selected !== null ? tString.stringWithPrefix(discover.selected.request.path.type, 'TYPE_') : null
        };
    }, [discover.selectable, discover.selected, tString]);

    const rawItems = discover.catalog !== null && discover.catalog.content.type === 'Ready' ?
        discover.catalog.content.content
        :
        [];
    const {
        filters,
        setFilter,
        clearClientFilters,
        filteredItems,
        activeFilterCount,
        activeClientFilterChips
    } = useDiscoverFilters(rawItems, queryParams, setSearchParams);
    const clientFiltersActive = activeFilterCount > 0;

    const activeFilters = React.useMemo(() => {
        const clientKeys = new Set(['minRating', 'yearFrom', 'yearTo', 'hideWatched', 'hideUnrated', 'sort', 'poster']);
        const chips = [...queryParams.entries()]
            .filter(([key, value]) => key !== 'search' && !clientKeys.has(key) && value.length > 0)
            .map(([key, value]) => {
                const extra = Array.isArray(discover.selectable?.extra) ? discover.selectable.extra.find(({ name }) => name === key) : undefined;
                const option = extra !== undefined && Array.isArray(extra.options) ? extra.options.find(({ value: optionValue }) => optionValue === value) : undefined;
                const valueLabel = option !== undefined && typeof option.value === 'string' ? option.value : value;
                const keyLabel = key.charAt(0).toUpperCase() + key.slice(1);
                return { key, label: `${keyLabel}: ${valueLabel}` };
            });
        if (currentSearch.length > 0) {
            chips.unshift({ key: 'search', label: `${t('DISCOVER_SEARCH', 'Search')}: ${currentSearch}` });
        }
        activeClientFilterChips.forEach(({ key, label }) => {
            const translatedLabel = key === 'hideWatched' ?
                t('DISCOVER_HIDE_WATCHED', 'Hide watched')
                :
                key === 'hideUnrated' ?
                    t('DISCOVER_HIDE_UNRATED', 'Hide unrated')
                    :
                    label;
            chips.push({ key, label: translatedLabel });
        });
        return chips;
    }, [queryParams, discover.selectable, currentSearch, activeClientFilterChips, t]);
    const removeFilter = React.useCallback((key) => {
        const next = new URLSearchParams(queryParams);
        if (key === 'yearFrom' || key === 'yearTo') {
            next.delete('yearFrom');
            next.delete('yearTo');
        } else {
            next.delete(key);
        }
        setSearchParams(next);
    }, [queryParams]);
    const clearAllFilters = React.useCallback(() => {
        setSearchParams(new URLSearchParams());
        setSearchInput('');
    }, [setSearchParams]);

    const catalogIsEmpty = discover.catalog !== null &&
        discover.catalog.content.type === 'Ready' &&
        rawItems.length === 0;
    const filteredEmpty = !catalogIsEmpty && rawItems.length > 0 && filteredItems.length === 0;

    const selectedMetaItem = filteredItems[selectedMetaItemIndex] ?? null;

    React.useEffect(() => {
        if (selectedMetaItemIndex >= filteredItems.length && filteredItems.length > 0) {
            setSelectedMetaItemIndex(0);
        }
    }, [filteredItems, selectedMetaItemIndex]);

    const metasContainerRef = React.useRef();
    const metaPreviewRef = React.useRef();
    const previousCatalogSizeRef = React.useRef(0);

    React.useEffect(() => {
        if (discover.catalog?.content.type === 'Loading') {
            metasContainerRef.current.scrollTop = 0;
            previousCatalogSizeRef.current = 0;
        }
    }, [discover.catalog]);
    React.useEffect(() => {
        if (discover.catalog?.content.type === 'Ready') {
            const catalogSize = discover.catalog.content.content.length;
            const hasNewItems = catalogSize > previousCatalogSizeRef.current;
            previousCatalogSizeRef.current = catalogSize;
            if (!hasNextPage || !hasNewItems || !metasContainerRef.current) {
                return;
            }

            const containerHeight = metasContainerRef.current.scrollHeight;
            const viewportHeight = metasContainerRef.current.clientHeight;
            if (containerHeight <= viewportHeight + SCROLL_TO_BOTTOM_THRESHOLD) {
                loadNextPage();
            }
        }
    }, [discover.catalog, hasNextPage, loadNextPage]);
    const addToLibrary = React.useCallback(() => {
        if (selectedMetaItem === null) {
            return;
        }

        core.transport.dispatch({
            action: 'Ctx',
            args: {
                action: 'AddToLibrary',
                args: selectedMetaItem
            }
        });
    }, [selectedMetaItem]);
    const removeFromLibrary = React.useCallback(() => {
        if (selectedMetaItem === null) {
            return;
        }

        core.transport.dispatch({
            action: 'Ctx',
            args: {
                action: 'RemoveFromLibrary',
                args: selectedMetaItem.id
            }
        });
    }, [selectedMetaItem]);
    const toggleWatched = React.useCallback(() => {
        if (selectedMetaItem === null) {
            return;
        }

        core.transport.dispatch({
            action: 'Ctx',
            args: {
                action: 'MetaItemMarkAsWatched',
                args: {
                    meta_item: selectedMetaItem,
                    is_watched: !selectedMetaItem.watched,
                }
            }
        });
    }, [selectedMetaItem]);
    const metaItemsOnFocusCapture = React.useCallback((event) => {
        if (event.target.dataset.index !== null && !isNaN(event.target.dataset.index)) {
            setSelectedMetaItemIndex(parseInt(event.target.dataset.index, 10));
        }
    }, []);
    // The side preview follows the mouse: hovering a poster updates the
    // MetaPreview immediately (keyboard focus still works for a11y).
    const metaItemsOnMouseOver = React.useCallback((event) => {
        const item = typeof event.target.closest === 'function' ? event.target.closest('[data-index]') : null;
        if (item !== null && item !== undefined) {
            const index = parseInt(item.dataset.index, 10);
            if (!isNaN(index) && index !== selectedMetaItemIndex) {
                setSelectedMetaItemIndex(index);
            }
        }
    }, [selectedMetaItemIndex]);
    const metaItemOnClick = React.useCallback((event) => {
        const visible = window.getComputedStyle(metaPreviewRef.current).display !== 'none';
        if (event.currentTarget.dataset.index !== selectedMetaItemIndex.toString() && visible) {
            event.preventDefault();
            event.currentTarget.focus();
        }
    }, [selectedMetaItemIndex]);
    const onScrollToBottom = React.useCallback(() => {
        if (hasNextPage) {
            loadNextPage();
        }
    }, [hasNextPage, loadNextPage]);
    const onScrollToBottomHandler = useOnScrollToBottom(onScrollToBottom, SCROLL_TO_BOTTOM_THRESHOLD);
    const onScroll = React.useCallback((event) => {
        onScrollToBottomHandler(event);
        setShowBackToTop(event.currentTarget.scrollTop > BACK_TO_TOP_THRESHOLD);
    }, [onScrollToBottomHandler]);
    const onBackToTop = React.useCallback(() => {
        metasContainerRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
    }, []);
    React.useEffect(() => {
        closePopover();
        closeAddonModal();
        setSelectedMetaItemIndex(0);
        setShowBackToTop(false);
        // Keyed on the ROUTE params, not `discover.selected`: the model
        // object identity churns on unrelated core updates, which used to
        // close the filter popover the instant it opened.
    }, [type, transportUrl, catalogId, closePopover, closeAddonModal]);
    return (
        <MainNavBars className={styles['discover-container']} route={'discover'}>
            <div className={styles['discover-content']}>
                <div className={styles['catalog-container']}>
                    <div className={styles['page-header']}>
                        <div className={styles['header-titles']}>
                            {
                                headerInfo.catalogName !== null ?
                                    <h1 className={styles['header-title']}>{headerInfo.catalogName}</h1>
                                    :
                                    null
                            }
                            <div className={styles['header-badges']}>
                                {
                                    headerInfo.typeLabel !== null ?
                                        <span className={styles['header-badge']}>{headerInfo.typeLabel}</span>
                                        :
                                        null
                                }
                                {
                                    headerInfo.addonName !== null ?
                                        <span className={classnames(styles['header-badge'], styles['addon-badge'])}>{headerInfo.addonName}</span>
                                        :
                                        null
                                }
                            </div>
                        </div>
                        {
                            discover.catalog !== null && discover.catalog.content.type === 'Ready' ?
                                <div className={styles['header-results-count']}>
                                    {
                                        clientFiltersActive ?
                                            `${filteredItems.length} ${t('DISCOVER_OF', 'of')} ${rawItems.length} ${t('DISCOVER_TITLES', 'titles')}`
                                            :
                                            `${rawItems.length} ${t('DISCOVER_TITLES', 'titles')}`
                                    }
                                </div>
                                :
                                null
                        }
                    </div>
                    <div className={styles['control-bar']}>
                        <div className={styles['control-row']}>
                            {
                                catalogSelect !== null ?
                                    <MultiselectMenu
                                        className={classnames(styles['select-input'], styles['catalog-select'])}
                                        title={catalogSelect.title}
                                        options={catalogSelect.options}
                                        value={catalogSelect.value}
                                        onSelect={catalogSelect.onSelect}
                                    />
                                    :
                                    null
                            }
                            {
                                typeSelect !== null ?
                                    <MultiselectMenu
                                        className={classnames(styles['select-input'], styles['type-select'])}
                                        title={typeSelect.title}
                                        options={typeSelect.options}
                                        value={typeSelect.value}
                                        onSelect={typeSelect.onSelect}
                                    />
                                    :
                                    null
                            }
                            {
                                searchSupported ?
                                    <div className={styles['search-container']}>
                                        <Icon className={styles['search-icon']} name={'search'} />
                                        <input
                                            className={styles['search-input']}
                                            type={'text'}
                                            value={searchInput}
                                            placeholder={t('DISCOVER_SEARCH', 'Search')}
                                            onChange={(event) => setSearchInput(event.target.value)}
                                            spellCheck={false}
                                        />
                                        {
                                            searchInput.length > 0 ?
                                                <button
                                                    className={styles['search-clear-button']}
                                                    onClick={() => setSearchInput('')}
                                                    aria-label={t('DISCOVER_CLEAR_ALL', 'Clear all')}
                                                    title={t('DISCOVER_CLEAR_ALL', 'Clear all')}
                                                >
                                                    <Icon className={styles['search-clear-icon']} name={'close'} />
                                                </button>
                                                :
                                                null
                                        }
                                    </div>
                                    :
                                    null
                            }
                            <div className={styles['filter-container']} ref={filterAnchorRef}>
                                <Button
                                    className={classnames(styles['filter-button'], { [styles['active']]: popoverOpen })}
                                    title={t('DISCOVER_FILTERS', 'Filters')}
                                    onClick={popoverOpen ? closePopover : openPopover}
                                >
                                    <Icon className={styles['filter-icon']} name={'filters'} />
                                    <span className={styles['filter-label']}>{t('DISCOVER_FILTERS', 'Filters')}</span>
                                    {
                                        activeFilterCount > 0 ?
                                            <span className={styles['filter-badge']}>{activeFilterCount}</span>
                                            :
                                            null
                                    }
                                </Button>
                                <FilterPopover
                                    open={popoverOpen}
                                    onClose={closePopover}
                                    anchorRef={filterAnchorRef}
                                    filters={filters}
                                    onFilterChange={setFilter}
                                    genreChips={genreChips}
                                    extraSelects={drawerExtraSelects}
                                    resultCount={filteredItems.length}
                                    totalCount={rawItems.length}
                                    onResetFilters={clearClientFilters}
                                    moreAvailable={hasNextPage}
                                />
                            </div>
                        </div>
                    </div>
                    {
                        activeFilters.length > 0 ?
                            <div className={styles['active-filters-container']}>
                                {
                                    activeFilters.map(({ key, label }) => (
                                        <button
                                            key={key}
                                            className={styles['filter-chip']}
                                            onClick={() => removeFilter(key)}
                                            title={label}
                                        >
                                            <span className={styles['filter-chip-label']}>{label}</span>
                                            <Icon className={styles['filter-chip-icon']} name={'close'} />
                                        </button>
                                    ))
                                }
                                <Button
                                    className={styles['clear-filters-button']}
                                    title={t('DISCOVER_CLEAR_ALL', 'Clear all')}
                                    onClick={clearAllFilters}
                                >
                                    <div className={styles['label']}>{t('DISCOVER_CLEAR_ALL', 'Clear all')}</div>
                                </Button>
                            </div>
                            :
                            null
                    }
                    {
                        discover.catalog !== null && !discover.catalog.installed ?
                            <div className={styles['missing-addon-warning-container']}>
                                <div className={styles['warning-label']}>{t('ERR_ADDON_NOT_INSTALLED')}</div>
                                <Button className={styles['install-button']} title={t('INSTALL_ADDON')} onClick={openAddonModal}>
                                    <div className={styles['label']}>{t('ADDON_INSTALL')}</div>
                                </Button>
                            </div>
                            :
                            null
                    }
                    {
                        discover.catalog === null ?
                            <DelayedRenderer delay={500}>
                                <div className={styles['message-container']}>
                                    <Image className={styles['image']} src={require('/assets/images/empty.png')} alt={' '} />
                                    <div className={styles['message-label']}>{t('NO_CATALOG_SELECTED')}</div>
                                </div>
                            </DelayedRenderer>
                            :
                            discover.catalog.content.type === 'Err' ?
                                <div className={styles['message-container']}>
                                    <Image className={styles['image']} src={require('/assets/images/empty.png')} alt={' '} />
                                    <div className={styles['message-label']}>{discover.catalog.content.content}</div>
                                    <Button className={styles['retry-button']} title={t('DISCOVER_RETRY', 'Try again')} onClick={reloadCatalog}>
                                        <div className={styles['label']}>{t('DISCOVER_RETRY', 'Try again')}</div>
                                    </Button>
                                </div>
                                :
                                filteredEmpty ?
                                    <div className={styles['message-container']}>
                                        <Image className={styles['image']} src={require('/assets/images/empty.png')} alt={' '} />
                                        <div className={styles['message-label']}>{t('DISCOVER_NO_FILTER_MATCH', 'No titles match your filters')}</div>
                                        <Button className={styles['retry-button']} title={t('DISCOVER_CLEAR_ALL', 'Clear all')} onClick={clearClientFilters}>
                                            <div className={styles['label']}>{t('DISCOVER_CLEAR_ALL', 'Clear all')}</div>
                                        </Button>
                                    </div>
                                    :
                                    catalogIsEmpty ?
                                        <div className={styles['message-container']}>
                                            <Image className={styles['image']} src={require('/assets/images/empty.png')} alt={' '} />
                                            <div className={styles['message-label']}>{t('DISCOVER_EMPTY_RESULTS', 'Nothing found')}</div>
                                            <div className={styles['message-hint-label']}>{t('DISCOVER_EMPTY_RESULTS_HINT', 'No titles match the current search or filters')}</div>
                                            {
                                                activeFilters.length > 0 ?
                                                    <Button className={styles['retry-button']} title={t('DISCOVER_CLEAR_ALL', 'Clear all')} onClick={clearAllFilters}>
                                                        <div className={styles['label']}>{t('DISCOVER_CLEAR_ALL', 'Clear all')}</div>
                                                    </Button>
                                                    :
                                                    null
                                            }
                                        </div>
                                        :
                                        discover.catalog.content.type === 'Loading' ?
                                            <div ref={metasContainerRef} className={classnames(styles['meta-items-container'], 'animation-fade-in')}>
                                                {Array(CONSTANTS.CATALOG_PAGE_SIZE).fill(null).map((_, index) => (
                                                    <div key={index} className={styles['meta-item-placeholder']}>
                                                        <div className={styles['poster-container']} />
                                                        <div className={styles['title-bar-container']}>
                                                            <div className={styles['title-label']} />
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                            :
                                            <div
                                                ref={metasContainerRef}
                                                key={discover.selected !== null ? `${discover.selected.request.base}|${discover.selected.request.path.type}|${discover.selected.request.path.id}` : 'grid'}
                                                className={classnames(
                                                    styles['meta-items-container'],
                                                    styles[`poster-density-${filters.poster}`],
                                                    'animation-fade-in'
                                                )}
                                                onScroll={onScroll}
                                                onMouseOver={metaItemsOnMouseOver}
                                                onFocusCapture={metaItemsOnFocusCapture}
                                            >
                                                {filteredItems.map((metaItem, index) => (
                                                    <MetaItem
                                                        key={index}
                                                        className={classnames({ 'selected': selectedMetaItemIndex === index })}
                                                        type={metaItem.type}
                                                        name={metaItem.name}
                                                        poster={metaItem.poster}
                                                        posterShape={metaItem.posterShape}
                                                        playname={selectedMetaItemIndex === index}
                                                        deepLinks={metaItem.deepLinks}
                                                        watched={metaItem.watched}
                                                        data-index={index}
                                                        onClick={metaItemOnClick}
                                                    />
                                                ))}
                                            </div>
                    }
                    {
                        clientFiltersActive && hasNextPage && !filteredEmpty && discover.catalog?.content.type === 'Ready' ?
                            <div className={styles['loaded-only-hint']}>
                                {t('DISCOVER_LOADED_ONLY_HINT', 'Filters apply to loaded titles — keep scrolling to load more')}
                            </div>
                            :
                            null
                    }
                    {
                        showBackToTop && discover.catalog !== null && discover.catalog.content.type === 'Ready' && filteredItems.length > 0 ?
                            <button
                                className={styles['back-to-top-button']}
                                onClick={onBackToTop}
                                aria-label={t('DISCOVER_BACK_TO_TOP', 'Back to top')}
                                title={t('DISCOVER_BACK_TO_TOP', 'Back to top')}
                            >
                                <Icon className={styles['back-to-top-icon']} name={'chevron-up'} />
                            </button>
                            :
                            null
                    }
                </div>
                {
                    selectedMetaItem !== null ?
                        <MetaPreview
                            key={selectedMetaItem.id}
                            className={classnames(styles['meta-preview-container'], 'animation-fade-in')}
                            compact={true}
                            ref={metaPreviewRef}
                            name={selectedMetaItem.name}
                            logo={selectedMetaItem.logo}
                            background={selectedMetaItem.poster}
                            runtime={selectedMetaItem.runtime}
                            releaseInfo={selectedMetaItem.releaseInfo}
                            released={selectedMetaItem.released}
                            description={selectedMetaItem.description}
                            links={selectedMetaItem.links}
                            deepLinks={selectedMetaItem.deepLinks}
                            trailerStreams={selectedMetaItem.trailerStreams}
                            inLibrary={selectedMetaItem.inLibrary}
                            toggleInLibrary={selectedMetaItem.inLibrary ? removeFromLibrary : addToLibrary}
                            watched={selectedMetaItem.watched}
                            toggleWatched={toggleWatched}
                            metaId={selectedMetaItem.id}
                            like={selectedMetaItem.like}
                        />
                        :
                        discover.catalog !== null && discover.catalog.content.type === 'Loading' ?
                            <div className={styles['meta-preview-container']} />
                            :
                            null
                }
            </div>
            {
                addonModalOpen && discover.selected !== null ?
                    <AddonDetailsModal transportUrl={discover.selected.request.base} onCloseRequest={closeAddonModal} />
                    :
                    null
            }
        </MainNavBars>
    );
};

const DiscoverFallback = () => (
    <MainNavBars className={styles['discover-container']} route={'discover'} />
);

module.exports = withCoreSuspender(Discover, DiscoverFallback);
