// Copyright (C) 2017-2023 Smart code 203358507

const React = require('react');
const PropTypes = require('prop-types');
const classnames = require('classnames');
const debounce = require('lodash.debounce');
const { default: useRouteFocused } = require('stremio/common/useRouteFocused');
const { useBinaryState } = require('stremio/common');
const { Button, Slider } = require('stremio/components');
const formatTime = require('./formatTime');
const styles = require('./styles');

const SeekBar = ({ className, time, duration, buffered, skipSegments, onSeekRequested, playbackSpeed }) => {
    const disabled = time === null || isNaN(time) || duration === null || isNaN(duration);
    const routeFocused = useRouteFocused();
    const [seekTime, setSeekTime] = React.useState(null);

    const [remainingTimeMode,,, toggleRemainingTimeMode] = useBinaryState(false);
    const resetTimeDebounced = React.useCallback(debounce(() => {
        setSeekTime(null);
    }, 1500), []);
    const onSlide = React.useCallback((time) => {
        resetTimeDebounced.cancel();
        setSeekTime(time);
    }, []);
    const onComplete = React.useCallback((time) => {
        resetTimeDebounced();
        setSeekTime(time);
        if (typeof onSeekRequested === 'function') {
            onSeekRequested(time);
        }
    }, [onSeekRequested]);
    React.useLayoutEffect(() => {
        if (!routeFocused || disabled) {
            resetTimeDebounced.cancel();
            setSeekTime(null);
        }
    }, [routeFocused, disabled]);
    React.useEffect(() => {
        return () => {
            resetTimeDebounced.cancel();
        };
    }, []);
    const segmentRanges = React.useMemo(() => {
        if (!Array.isArray(skipSegments) || !(typeof duration === 'number' && isFinite(duration) && duration > 0)) {
            return [];
        }
        return skipSegments
            .filter((segment) => typeof segment.startMs === 'number' && isFinite(segment.startMs))
            .map((segment) => {
                const start = Math.max(0, Math.min(1, segment.startMs / duration));
                const end = segment.endMs === null ? 1 : Math.max(start, Math.min(1, segment.endMs / duration));
                return { type: segment.type, start: start * 100, width: (end - start) * 100 };
            })
            .filter((range) => range.width > 0.1);
    }, [skipSegments, duration]);
    return (
        <div className={classnames(className, styles['seek-bar-container'], { 'active': seekTime !== null })}>
            <div className={styles['label']}>{formatTime(seekTime !== null ? seekTime : time)}</div>
            <div className={styles['slider-wrapper']}>
                <Slider
                    className={classnames(styles['slider'], { 'active': seekTime !== null })}
                    value={
                        !disabled ?
                            seekTime !== null ? seekTime : time
                            :
                            0
                    }
                    buffered={buffered}
                    minimumValue={0}
                    maximumValue={duration}
                    disabled={disabled}
                    onSlide={onSlide}
                    onComplete={onComplete}
                />
                {
                    segmentRanges.length > 0 ?
                        <div className={styles['segments-layer']}>
                            {segmentRanges.map((range, index) => (
                                <div
                                    key={`${range.type}:${index}`}
                                    className={styles[`segment-${range.type}`]}
                                    style={{ left: `${range.start}%`, width: `${range.width}%` }}
                                />
                            ))}
                        </div>
                        :
                        null
                }
            </div>
            <Button onClick={toggleRemainingTimeMode} tabIndex={-1}>
                <div className={styles['label']}>
                    {remainingTimeMode && duration !== null && !isNaN(duration)
                        ? formatTime((duration - time)/playbackSpeed, '-')
                        : formatTime(duration) }
                </div>
            </Button>
        </div>
    );
};

SeekBar.propTypes = {
    className: PropTypes.string,
    time: PropTypes.number,
    duration: PropTypes.number,
    buffered: PropTypes.number,
    skipSegments: PropTypes.array,
    onSeekRequested: PropTypes.func,
    playbackSpeed: PropTypes.number
};

module.exports = SeekBar;
