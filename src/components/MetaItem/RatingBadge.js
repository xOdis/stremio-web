// Copyright (C) 2017-2026 Smart code 203358507

const React = require('react');
const PropTypes = require('prop-types');
const { useImdbRating } = require('stremio/common/ratings');
const styles = require('./styles');

const RATING_PATTERN = /^\d(\.\d)?$/;
const IMDB_LABEL = 'IMDb';

const normalizeRating = (rating) => {
    if (rating === null || rating === undefined) {
        return null;
    }
    const value = typeof rating === 'number' ? rating.toFixed(1).replace(/\.0$/, '') : String(rating).trim();
    return RATING_PATTERN.test(value) && parseFloat(value) > 0 ? value : null;
};

// Shows an IMDb rating chip. When the parent item carries no rating
// (`imdbRating` prop), one is lazily fetched once the badge scrolls
// into view, so offscreen cards never hit the network.
const RatingBadge = ({ type, id, rating }) => {
    const containerRef = React.useRef(null);
    const [visible, setVisible] = React.useState(false);

    React.useEffect(() => {
        if (normalizeRating(rating) !== null) {
            return;
        }

        if (typeof IntersectionObserver !== 'function') {
            setVisible(true);
            return;
        }

        const observer = new IntersectionObserver((entries) => {
            if (entries.some((entry) => entry.isIntersecting)) {
                setVisible(true);
                observer.disconnect();
            }
        }, { rootMargin: '300px' });

        if (containerRef.current !== null) {
            observer.observe(containerRef.current);
        }

        return () => observer.disconnect();
    }, [rating]);

    const fetchedRating = useImdbRating(visible ? type : null, visible ? id : null);
    const displayRating = normalizeRating(rating) ?? normalizeRating(fetchedRating);

    return (
        <span ref={containerRef} className={styles['rating-badge-container']}>
            {
                displayRating !== null ?
                    <span className={styles['rating-badge']} title={`IMDb ${displayRating}`}>
                        <span className={styles['rating-source']}>{IMDB_LABEL}</span>
                        <span className={styles['rating-value']}>{displayRating}</span>
                    </span>
                    :
                    null
            }
        </span>
    );
};

RatingBadge.propTypes = {
    type: PropTypes.string,
    id: PropTypes.string,
    rating: PropTypes.oneOfType([PropTypes.string, PropTypes.number])
};

module.exports = RatingBadge;
