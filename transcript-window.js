/**
 * Transcript Window - Premium Dark Mode UI
 * Handles settings popover and button interactions
 */

(function () {
    'use strict';

    // Electron IPC for window control
    const { ipcRenderer } = require('electron');

    // DOM Elements
    const settingsBtn = document.getElementById('settingsBtn');
    const settingsPopover = document.getElementById('settingsPopover');
    const closeBtn = document.getElementById('closeBtn');

    // State
    let isPopoverOpen = false;

    /**
     * Toggle settings popover visibility
     */
    function togglePopover() {
        isPopoverOpen = !isPopoverOpen;

        if (isPopoverOpen) {
            settingsPopover.classList.add('visible');
            settingsBtn.classList.add('active');
        } else {
            settingsPopover.classList.remove('visible');
            settingsBtn.classList.remove('active');
        }
    }

    /**
     * Close popover
     */
    function closePopover() {
        if (isPopoverOpen) {
            isPopoverOpen = false;
            settingsPopover.classList.remove('visible');
            settingsBtn.classList.remove('active');
        }
    }

    /**
     * Handle click outside popover
     */
    function handleClickOutside(event) {
        if (isPopoverOpen &&
            !settingsPopover.contains(event.target) &&
            !settingsBtn.contains(event.target)) {
            closePopover();
        }
    }

    /**
     * Handle copy button click with icon animation
     */
    function handleCopy(entry, copyBtn) {
        const textElement = entry.querySelector('.entry-text');

        // Prevent multiple clicks during animation
        if (copyBtn.classList.contains('copied')) {
            return;
        }

        if (textElement) {
            const text = textElement.textContent;
            navigator.clipboard.writeText(text).then(() => {
                // Add copied class to trigger icon swap animation
                copyBtn.classList.add('copied');

                // Remove copied class after 1 second to swap back
                setTimeout(() => {
                    copyBtn.classList.remove('copied');
                }, 1000);
            }).catch(err => {
                console.error('Failed to copy:', err);
            });
        }
    }

    /**
     * Handle delete button click
     */
    function handleDelete(entry) {
        // Animate out with Apple-style
        entry.style.transition = 'opacity 250ms cubic-bezier(0.16, 1, 0.3, 1), transform 250ms cubic-bezier(0.16, 1, 0.3, 1), height 250ms cubic-bezier(0.16, 1, 0.3, 1), margin 250ms cubic-bezier(0.16, 1, 0.3, 1), padding 250ms cubic-bezier(0.16, 1, 0.3, 1)';
        entry.style.opacity = '0';
        entry.style.transform = 'translateX(-20px)';

        setTimeout(() => {
            entry.style.height = '0';
            entry.style.marginBottom = '0';
            entry.style.padding = '0';

            setTimeout(() => {
                entry.remove();
            }, 250);
        }, 100);
    }

    /**
     * Initialize event listeners
     */
    function init() {
        // Close button - hide window
        closeBtn.addEventListener('click', () => {
            ipcRenderer.send('hide-transcript-window');
        });

        // Settings button toggle
        settingsBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            togglePopover();
        });

        // Click outside to close
        document.addEventListener('click', handleClickOutside);

        // Escape key to close popover
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                closePopover();
            }
        });

        // Popover item clicks
        document.querySelectorAll('.popover-item').forEach(item => {
            item.addEventListener('click', () => {
                // Just close for now (no backend)
                closePopover();
            });
        });

        // Action buttons on transcript entries
        document.querySelectorAll('.transcript-entry').forEach(entry => {
            const copyBtn = entry.querySelector('.copy-btn');
            const deleteBtn = entry.querySelector('.delete-btn');

            if (copyBtn) {
                copyBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    handleCopy(entry, copyBtn);
                });
            }

            if (deleteBtn) {
                deleteBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    handleDelete(entry);
                });
            }
        });
    }

    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
