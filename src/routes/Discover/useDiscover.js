// Copyright (C) 2017-2023 Smart code 203358507

const React = require('react');
const UrlUtils = require('url');
const { useCore } = require('stremio/core');
const { useModelState } = require('stremio/common');
const { FILTER_PARAM_KEYS } = require('./useDiscoverFilters');

const map = (discover) => ({
    ...discover,
    catalog: discover.catalog !== null && discover.catalog.content.type === 'Ready' ?
        {
            ...discover.catalog,
            content: {
                ...discover.catalog.content,
                content: discover.catalog.content.content.map((metaItem) => ({
                    ...metaItem,
                    released: new Date(typeof metaItem.released === 'string' ? metaItem.released : NaN),
                }))
            }
        }
        :
        discover.catalog
});

const useDiscover = (urlParams, queryParams) => {
    const core = useCore();
    const loadNextPage = React.useCallback(() => {
        core.transport.dispatch({
            action: 'CatalogWithFilters',
            args: {
                action: 'LoadNextPage'
            }
        }, 'discover');
    }, []);
    // Only server-side extras (genre, search...) reach the addon. Client
    // filter params (minRating, sort, poster...) stay in the URL for the
    // grid but must NEVER be sent to the addon, and changing them must not
    // re-request the catalog — hence the serialized-extras memo key.
    const serverExtrasKey = React.useMemo(() => {
        const clientKeys = new Set(FILTER_PARAM_KEYS);
        return JSON.stringify(Array.from(queryParams.entries()).filter(([key]) => !clientKeys.has(key)));
    }, [queryParams]);
    const action = React.useMemo(() => {
        if (typeof urlParams.transportUrl === 'string' && typeof urlParams.type === 'string' && typeof urlParams.catalogId === 'string') {
            const { hostname } = UrlUtils.parse(urlParams.transportUrl);
            if (typeof hostname === 'string' && hostname.length > 0) {
                return {
                    action: 'Load',
                    args: {
                        model: 'CatalogWithFilters',
                        args: {
                            request: {
                                base: urlParams.transportUrl,
                                path: {
                                    resource: 'catalog',
                                    type: urlParams.type,
                                    id: urlParams.catalogId,
                                    extra: JSON.parse(serverExtrasKey)
                                }
                            }
                        }
                    }
                };
            }
        } else {
            return {
                action: 'Load',
                args: {
                    model: 'CatalogWithFilters',
                    args: null
                }
            };
        }

        return {
            action: 'Unload'
        };
    }, [urlParams, serverExtrasKey]);
    const discover = useModelState({ model: 'discover', action, map, deps: ['ctx'] });
    const reload = React.useCallback(() => {
        if (action.action !== 'Unload') {
            core.transport.dispatch(action, 'discover');
        }
    }, [action, core]);
    return [discover, loadNextPage, reload];
};

module.exports = useDiscover;
