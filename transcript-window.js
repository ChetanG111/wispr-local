/**
 * Transcript Window - Premium Dark Mode UI
 * Handles settings popover, history loading, and button interactions
 */

(function () {
    'use strict';

    // Electron IPC for window control and data
    const { ipcRenderer } = require('electron');

    // DOM Elements
    const settingsBtn = document.getElementById('settingsBtn');
    const settingsPopover = document.getElementById('settingsPopover');
    const closeBtn = document.getElementById('closeBtn');
    const transcriptList = document.getElementById('transcriptList');
    const emptyState = document.getElementById('emptyState');

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
     * Create HTML for a transcript entry
     */
    function createEntryHTML(transcript) {
        return `
            <div class="transcript-entry" data-id="${transcript.id}">
                <div class="entry-content">
                    <p class="entry-text">${escapeHtml(transcript.final_text || '')}</p>
                </div>
                <div class="entry-actions">
                    <button class="action-btn copy-btn" aria-label="Copy transcript" title="Copy Text">
                        <svg class="icon-copy" width="16" height="16" viewBox="0 0 24 24" fill="none"
                            stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                        </svg>
                        <svg class="icon-check" width="16" height="16" viewBox="0 0 24 24" fill="none"
                            stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                            <polyline points="20 6 9 17 4 12"></polyline>
                        </svg>
                    </button>
                    <button class="action-btn delete-btn" aria-label="Delete transcript" title="Delete">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                            stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <polyline points="3 6 5 6 21 6"></polyline>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2">
                            </path>
                        </svg>
                    </button>
                </div>
            </div>
        `;
    }

    /**
     * Escape HTML to prevent XSS
     */
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    /**
     * Load history from database and render entries
     */
    async function loadHistory() {
        try {
            const transcripts = await ipcRenderer.invoke('history:load', 50);
            console.log('[transcript-window] Loaded transcripts:', transcripts.length);

            renderTranscripts(transcripts);
        } catch (err) {
            console.error('[transcript-window] Failed to load history:', err);
        }
    }

    /**
     * Render transcripts to the list
     */
    function renderTranscripts(transcripts) {
        // Clear existing entries (except empty state)
        const entries = transcriptList.querySelectorAll('.transcript-entry');
        entries.forEach(entry => entry.remove());

        if (transcripts.length === 0) {
            // Show empty state
            emptyState.classList.remove('hidden');
            return;
        }

        // Hide empty state
        emptyState.classList.add('hidden');

        // Add entries (newest first, already sorted by DB)
        transcripts.forEach(transcript => {
            // Skip error entries with no text
            if (transcript.final_text) {
                const html = createEntryHTML(transcript);
                emptyState.insertAdjacentHTML('beforebegin', html);
            }
        });

        // Attach event listeners to new entries
        attachEntryListeners();
    }

    /**
     * Attach event listeners to transcript entries
     */
    function attachEntryListeners() {
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
    async function handleDelete(entry) {
        const id = parseInt(entry.dataset.id, 10);

        // Animate out with Apple-style
        entry.style.transition = 'opacity 250ms cubic-bezier(0.16, 1, 0.3, 1), transform 250ms cubic-bezier(0.16, 1, 0.3, 1), height 250ms cubic-bezier(0.16, 1, 0.3, 1), margin 250ms cubic-bezier(0.16, 1, 0.3, 1), padding 250ms cubic-bezier(0.16, 1, 0.3, 1)';
        entry.style.opacity = '0';
        entry.style.transform = 'translateX(-20px)';

        // Delete from database
        try {
            await ipcRenderer.invoke('history:delete', id);
            console.log('[transcript-window] Deleted transcript id:', id);
        } catch (err) {
            console.error('[transcript-window] Failed to delete:', err);
        }

        // Complete animation and remove element
        setTimeout(() => {
            entry.style.height = '0';
            entry.style.marginBottom = '0';
            entry.style.padding = '0';

            setTimeout(() => {
                entry.remove();

                // Check if list is now empty
                const remaining = transcriptList.querySelectorAll('.transcript-entry');
                if (remaining.length === 0) {
                    emptyState.classList.remove('hidden');
                }
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

        // Load history on init
        loadHistory();

        // Reload history when window becomes visible (e.g., after new transcription)
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') {
                loadHistory();
            }
        });

        // Listen for refresh command from main process
        ipcRenderer.on('refresh-history', () => {
            console.log('[transcript-window] Received refresh-history command');
            loadHistory();
        });
    }

    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
