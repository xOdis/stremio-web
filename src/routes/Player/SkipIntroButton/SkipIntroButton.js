// Copyright (C) 2017-2023 Smart code 203358507

const React = require('react');
const PropTypes = require('prop-types');
const classnames = require('classnames');
const { default: Icon } = require('@stremio/stremio-icons/react');
const { Button } = require('stremio/components');
const styles = require('./styles');

const EXIT_ANIMATION_MS = 350;

// Renders a vertical stack of skip buttons (Skip Intro / Skip Recap /
// Skip Preview / Next Episode). Items that stop being active are kept
// rendered briefly with an `exiting` class so they can fade out smoothly.
const SkipIntroButton = ({ className, items, prepend }) => {
    const [displayed, setDisplayed] = React.useState([]);

    React.useEffect(() => {
        setDisplayed((prev) => {
            const activeKeys = new Set(items.map((item) => item.key));
            const result = items.map((item) => ({ ...item, exiting: false }));
            prev.forEach((entry) => {
                if (!activeKeys.has(entry.key) && !result.some((item) => item.key === entry.key)) {
                    result.push({ ...entry, exiting: true });
                }
            });
            return result;
        });
    }, [items]);

    React.useEffect(() => {
        if (!displayed.some((item) => item.exiting)) {
            return;
        }
        const timer = setTimeout(() => {
            setDisplayed((prev) => prev.filter((item) => !item.exiting));
        }, EXIT_ANIMATION_MS);
        return () => clearTimeout(timer);
    }, [displayed]);

    return (
        <div className={classnames(className, styles['skip-intro-container'])}>
            {prepend}
            {displayed.map((item) => (
                <Button
                    key={item.key}
                    className={classnames(styles['skip-intro-button'], { [styles['exiting']]: item.exiting })}
                    onClick={item.onClick}
                >
                    <Icon className={styles['icon']} name={'next'} />
                    <div className={styles['label']}>{item.label}</div>
                </Button>
            ))}
        </div>
    );
};

SkipIntroButton.propTypes = {
    className: PropTypes.string,
    items: PropTypes.arrayOf(PropTypes.shape({
        key: PropTypes.string.isRequired,
        label: PropTypes.string.isRequired,
        onClick: PropTypes.func,
    })),
    prepend: PropTypes.node,
};

module.exports = SkipIntroButton;
