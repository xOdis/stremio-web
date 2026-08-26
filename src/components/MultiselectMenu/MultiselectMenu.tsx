// Copyright (C) 2017-2024 Smart code 203358507

import React from 'react';
import ReactDOM from 'react-dom';
import { Button } from 'stremio/components';
import useBinaryState from 'stremio/common/useBinaryState';
import Dropdown from './Dropdown';
import classNames from 'classnames';
import Icon from '@stremio/stremio-icons/react';
import styles from './MultiselectMenu.less';

type Props = {
    className?: string,
    title?: string | (() => string | null);
    options: MultiselectMenuOption[];
    value?: any;
    disabled?: boolean,
    onSelect: (value: any) => void;
};

const MultiselectMenu = ({ className, title, options, value, disabled, onSelect }: Props) => {
    const multiselectMenuRef = React.useRef<HTMLDivElement | null>(null);
    const dropdownRef = React.useRef<HTMLDivElement | null>(null);
    const [menuOpen, , closeMenu, toggleMenu] = useBinaryState(false);
    const [level, setLevel] = React.useState<number>(0);
    const [openUp, setOpenUp] = React.useState<boolean>(false);
    const [dropdownRect, setDropdownRect] = React.useState<{ left: number; top: number; bottom: number; width: number } | null>(null);

    const selectedOption = options.find((opt) => opt.value === value);

    const onOptionSelect = (selectedValue: string | number) => {
        level ? setLevel(level + 1) : onSelect(selectedValue), closeMenu();
    };

    const onToggle = () => {
        if (!menuOpen) {
            const rect = multiselectMenuRef.current?.getBoundingClientRect();
            if (rect) {
                // Full list ≈ 7 options × 48px; flip upward when there is
                // more room above the button than below it.
                const spaceBelow = window.innerHeight - rect.bottom;
                const up = spaceBelow < 7 * 48 && rect.top > spaceBelow;
                setOpenUp(up);
                setDropdownRect({ left: rect.left, top: rect.bottom, bottom: rect.top, width: rect.width });
            }
        }
        toggleMenu();
    };

    // The dropdown renders in a portal on <body> so no ancestor overflow /
    // stacking context can clip it. Outside clicks, Escape and any scroll
    // close it.
    React.useEffect(() => {
        if (!menuOpen) {
            return;
        }
        const onPointer = (event: MouseEvent | TouchEvent) => {
            const target = event.target as Node;
            if (multiselectMenuRef.current?.contains(target) || dropdownRef.current?.contains(target)) {
                return;
            }
            closeMenu();
        };
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                closeMenu();
            }
        };
        const onScroll = (event: Event) => {
            // Scrolling INSIDE the open list must not close it — only
            // scrolls that happen elsewhere (grid, page, ...) do.
            const target = event.target as Node;
            if (dropdownRef.current?.contains(target) || multiselectMenuRef.current?.contains(target)) {
                return;
            }
            closeMenu();
        };
        document.addEventListener('mouseup', onPointer);
        document.addEventListener('touchend', onPointer);
        document.addEventListener('keydown', onKeyDown);
        window.addEventListener('scroll', onScroll, true);
        return () => {
            document.removeEventListener('mouseup', onPointer);
            document.removeEventListener('touchend', onPointer);
            document.removeEventListener('keydown', onKeyDown);
            window.removeEventListener('scroll', onScroll, true);
        };
    }, [menuOpen, closeMenu]);

    return (
        <div className={classNames(styles['multiselect-menu'], { [styles['active']]: menuOpen }, className)} ref={multiselectMenuRef}>
            <Button
                className={classNames(styles['multiselect-button'], { [styles['open']]: menuOpen })}
                disabled={disabled}
                onClick={onToggle}
                tabIndex={0}
                aria-haspopup='listbox'
                aria-expanded={menuOpen}
            >
                <div className={styles['label']}>
                    {
                        typeof title === 'function'
                            ? title()
                            : title ?? selectedOption?.label
                    }
                </div>
                <Icon name={'caret-down'} className={classNames(styles['icon'], { [styles['open']]: menuOpen })} />
            </Button>
            {
                menuOpen && dropdownRect !== null ?
                    ReactDOM.createPortal(
                        <div
                            ref={dropdownRef}
                            className={styles['dropdown-portal']}
                            style={{
                                left: `${dropdownRect.left}px`,
                                width: `${dropdownRect.width}px`,
                                ...(openUp ?
                                    { bottom: `${window.innerHeight - dropdownRect.bottom}px` }
                                    :
                                    { top: `${dropdownRect.top}px` })
                            }}
                        >
                            <Dropdown
                                level={level}
                                setLevel={setLevel}
                                options={options}
                                onSelect={onOptionSelect}
                                menuOpen={menuOpen}
                                value={value}
                                inPortal={true}
                            />
                        </div>,
                        document.body
                    )
                    : null
            }
        </div>
    );
};

export default MultiselectMenu;
