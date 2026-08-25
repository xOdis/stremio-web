// Copyright (C) 2017-2023 Smart code 203358507

const React = require('react');
const { useTranslation } = require('react-i18next');
const { useParams } = require('react-router');
const { useSearchParams } = require('react-router-dom');
const classnames = require('classnames');
const { default: Icon } = require('@stremio/stremio-icons/react');
const { useCore } = require('stremio/core');
const { CONSTANTS, useBinaryState, useOnScrollToBottom, withCoreSuspender } = require('stremio/common');
const { AddonDetailsModal, Button, DelayedRenderer, Image, MainNavBars, MetaItem, MetaPreview, ModalDialog, MultiselectMenu } = require('stremio/components');
const useDiscover = require('./useDiscover');
const useSelectableInputs = require('./useSelectableInputs');
const styles = require('./styles');

const SCROLL_TO_BOTTOM_THRESHOLD = 400;

const Discover = () => {
    const { type, transportUrl, catalogId } = useParams();
    const urlParams = React.useMemo(() => ({
        type,
        transportUrl,
        catalogId
    }), [type, transportUrl, catalogId]);
    const [queryParams, setSearchParams] = useSearchParams();
    const { t } = useTranslation();
    const core = useCore();
    const [discover, loadNextPage] = useDiscover(urlParams, queryParams);
    const [selectInputs, hasNextPage] = useSelectableInputs(discover);
    const [inputsModalOpen, openInputsModal, closeInputsModal] = useBinaryState(false);
    const [addonModalOpen, openAddonModal, closeAddonModal] = useBinaryState(false);
    const [selectedMetaItemIndex, setSelectedMetaItemIndex] = React.useState(0);

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

    const activeFilters = React.useMemo(() => {
        const chips = [...queryParams.entries()]
            .filter(([key, value]) => key !== 'search' && value.length > 0)
            .map(([key, value]) => {
                const extra = Array.isArray(discover.selectable?.extra) ? discover.selectable.extra.find(({ name }) => name === key) : undefined;
                const option = extra !== undefined && Array.isArray(extra.options) ? extra.options.find(({ value: optionValue }) => optionValue === value) : undefined;
                const valueLabel = option !== undefined && typeof option.value === 'string' ? option.value : value;
                const keyLabel = extra !== undefined ? key.charAt(0).toUpperCase() + key.slice(1) : key.charAt(0).toUpperCase() + key.slice(1);
                return { key, label: `${keyLabel}: ${valueLabel}` };
            });
        if (currentSearch.length > 0) {
            chips.unshift({ key: 'search', label: `${t('DISCOVER_SEARCH', 'Search')}: ${currentSearch}` });
        }
        return chips;
    }, [queryParams, discover.selectable, currentSearch]);
    const removeFilter = React.useCallback((key) => {
        const next = new URLSearchParams(queryParams);
        next.delete(key);
        setSearchParams(next);
    }, [queryParams]);
    const clearAllFilters = React.useCallback(() => {
        setSearchParams(new URLSearchParams());
        setSearchInput('');
    }, [setSearchParams]);

    const selectedMetaItem = React.useMemo(() => {
        return discover.catalog?.content.type === 'Ready' &&
            discover.catalog.content.content[selectedMetaItemIndex] || null;
    }, [discover.catalog, selectedMetaItemIndex]);

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
    const onScroll = useOnScrollToBottom(onScrollToBottom, SCROLL_TO_BOTTOM_THRESHOLD);
    React.useEffect(() => {
        closeInputsModal();
        closeAddonModal();
        setSelectedMetaItemIndex(0);
    }, [discover.selected]);
    return (
        <MainNavBars className={styles['discover-container']} route={'discover'}>
            <div className={styles['discover-content']}>
                <div className={styles['catalog-container']}>
                    <div className={styles['selectable-inputs-container']}>
                        {selectInputs.map(({ title, options, value, onSelect }, index) => (
                            <MultiselectMenu
                                key={index}
                                className={styles['select-input']}
                                title={title}
                                options={options}
                                value={value}
                                onSelect={onSelect}
                            />
                        ))}
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
                        <div className={styles['filter-container']}>
                            <Button className={styles['filter-button']} title={t('ALL_FILTERS')} onClick={openInputsModal}>
                                <Icon className={styles['filter-icon']} name={'filters'} />
                            </Button>
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
                                    <div ref={metasContainerRef} className={classnames(styles['meta-items-container'], 'animation-fade-in')} onScroll={onScroll} onFocusCapture={metaItemsOnFocusCapture}>
                                        {discover.catalog.content.content.map((metaItem, index) => (
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
                </div>
                {
                    selectedMetaItem !== null ?
                        <MetaPreview
                            className={styles['meta-preview-container']}
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
                inputsModalOpen ?
                    <ModalDialog title={t('CATALOG_FILTERS')} className={styles['selectable-inputs-modal']} onCloseRequest={closeInputsModal}>
                        <div className={styles['filters-modal-content']}>
                            <div className={styles['filters-modal-grid']}>
                                {selectInputs.map(({ title, options, value, onSelect, isRequired }, index) => (
                                    <MultiselectMenu
                                        key={index}
                                        className={classnames(styles['select-input'], styles['filters-modal-input'], { [styles['filters-modal-input-required']]: isRequired })}
                                        title={title}
                                        options={options}
                                        value={value}
                                        onSelect={onSelect}
                                    />
                                ))}
                            </div>
                            <div className={styles['filters-modal-footer']}>
                                <Button
                                    className={styles['filters-reset-button']}
                                    title={t('DISCOVER_RESET', 'Reset')}
                                    onClick={clearAllFilters}
                                >
                                    <div className={styles['label']}>{t('DISCOVER_RESET', 'Reset')}</div>
                                </Button>
                                <Button
                                    className={styles['filters-apply-button']}
                                    title={t('DISCOVER_APPLY', 'Apply')}
                                    onClick={closeInputsModal}
                                >
                                    <div className={styles['label']}>{t('DISCOVER_APPLY', 'Apply')}</div>
                                </Button>
                            </div>
                        </div>
                    </ModalDialog>
                    :
                    null
            }
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
