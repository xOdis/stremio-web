// Copyright (C) 2017-2023 Smart code 203358507

const React = require('react');
const PropTypes = require('prop-types');
const classnames = require('classnames');
const { default: Icon } = require('@stremio/stremio-icons/react');
const { Button } = require('stremio/components');
const { useTranslation } = require('react-i18next');
const styles = require('./styles');

const RING_RADIUS = 13;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

// "Next Episode" prompt: a glassy pill with a circular countdown and a
// cancel button. When `secondsLeft` is null the countdown is hidden and it
// renders as a plain actionable pill.
const NextEpisodeButton = ({ className, secondsLeft, totalSeconds, onClick, onCancel }) => {
    const { t } = useTranslation();
    const counting = typeof secondsLeft === 'number' && isFinite(secondsLeft) &&
        typeof totalSeconds === 'number' && isFinite(totalSeconds) && totalSeconds > 0;
    const fraction = counting ?
        Math.max(0, Math.min(1, 1 - (secondsLeft / totalSeconds)))
        :
        0;

    return (
        <div className={classnames(className, styles['next-episode-container'])}>
            <Button className={styles['next-episode-button']} onClick={onClick}>
                {
                    counting ?
                        <div className={styles['countdown']}>
                            <svg className={styles['ring']} viewBox="0 0 32 32">
                                <circle className={styles['ring-track']} cx="16" cy="16" r={RING_RADIUS} />
                                <circle
                                    className={styles['ring-progress']}
                                    cx="16" cy="16" r={RING_RADIUS}
                                    strokeDasharray={RING_CIRCUMFERENCE}
                                    strokeDashoffset={RING_CIRCUMFERENCE * (1 - fraction)}
                                />
                            </svg>
                            <span className={styles['seconds']}>{secondsLeft}</span>
                        </div>
                        :
                        <Icon className={styles['icon']} name={'next'} />
                }
                <div className={styles['label']}>{t('PLAYER_NEXT_EPISODE', 'Next Episode')}</div>
            </Button>
            {
                counting && typeof onCancel === 'function' ?
                    <Button className={styles['cancel-button']} onClick={onCancel}>
                        <Icon className={styles['icon']} name={'close'} />
                    </Button>
                    :
                    null
            }
        </div>
    );
};

NextEpisodeButton.propTypes = {
    className: PropTypes.string,
    secondsLeft: PropTypes.number,
    totalSeconds: PropTypes.number,
    onClick: PropTypes.func,
    onCancel: PropTypes.func,
};

module.exports = NextEpisodeButton;
