import { NocoDBClient } from './nocodb.js';

class ShoppingApp {
    constructor() {
        this.client = null;
        this.items = [];
        this.config = {
            tableUrl: '',
            token: ''
        };
        this.state = {
            filterTags: [],
            searchQuery: '',
            isPolling: false,
            currentEditId: null,
            currentDeleteId: null,
            hideDone: false,
            bulkMode: false,
            selectedItems: new Set()
        };
        this.pollInterval = null;
        this._longPressTimer = null;
        this._preventNextClick = false;
        
        // Bind methods
        this.init = this.init.bind(this);
        this.refreshProps = this.renderList.bind(this);
    }

    async init() {
        this.loadConfig();
        
        // Setup Event Listeners
        this.setupEventListeners();
        
        // Check availability
        if (this.config.tableUrl && this.config.token) {
            this.client = new NocoDBClient(this.config.tableUrl, this.config.token);
            await this.fetchItems();
            this.startPolling();
        } else {
            ui("#dialog-settings"); // Open settings if no config
        }

        // Visibility API for polling optimization
        document.addEventListener("visibilitychange", () => {
            if (document.hidden) {
                this.stopPolling();
            } else {
                this.fetchItems(); // Immediate refresh
                this.startPolling();
            }
        });
    }

    loadConfig() {
        const stored = localStorage.getItem('shoplist-config');
        if (stored) {
            this.config = JSON.parse(stored);
            // Populate inputs
            const urlInput = document.getElementById('inp-url');
            const tokenInput = document.getElementById('inp-token');
            if (urlInput) urlInput.value = this.config.tableUrl || '';
            if (tokenInput) tokenInput.value = this.config.token || '';
        }
    }

    saveConfig(url, token) {
        this.config = { tableUrl: url, token: token };
        localStorage.setItem('shoplist-config', JSON.stringify(this.config));
        this.client = new NocoDBClient(url, token);
        this.fetchItems();
        this.startPolling();
    }

    setupEventListeners() {
        // Settings Save
        document.getElementById('btn-save-settings').addEventListener('click', () => {
            const url = document.getElementById('inp-url').value.trim();
            const token = document.getElementById('inp-token').value.trim();
            if (url && token) {
                this.saveConfig(url, token);
                ui("#dialog-settings"); // Close
            }
        });

        // Add Item
        document.getElementById('btn-add-item').addEventListener('click', async () => {
            const input = document.getElementById('inp-new-title');
            const val = input.value.trim();
            if (val) {
                await this.addItem(val);
                input.value = '';
                ui("#dialog-add"); // Close
            }
        });

        // Save Edit Item
        document.getElementById('btn-save-edit').addEventListener('click', async () => {
             const input = document.getElementById('inp-edit-title');
             const val = input.value.trim();
             if (val && this.state.currentEditId) {
                 await this.saveEdit(this.state.currentEditId, val);
                 ui("#dialog-edit"); // Close
             }
        });

        // Delete Confirm
        document.getElementById('btn-confirm-delete').addEventListener('click', async () => {
            if (this.state.currentDeleteId) {
                await this.deleteItem(this.state.currentDeleteId);
                ui("#dialog-delete"); // Close
            }
        });

        // Search Input
        const searchInput = document.getElementById('search-input');
        const searchClear = document.getElementById('search-clear');

        searchInput.addEventListener('input', (e) => {
            this.state.searchQuery = e.target.value.toLowerCase();
            searchClear.style.visibility = this.state.searchQuery ? 'visible' : 'hidden';
            this.renderList();
        });

        // Clear Search
        searchClear.addEventListener('click', () => {
            searchInput.value = '';
            this.state.searchQuery = '';
            searchClear.style.visibility = 'hidden';
            this.renderList();
            searchInput.focus();
        });

        // Toggle Done Visibility
        const btnToggleDone = document.getElementById('btn-toggle-done');
        btnToggleDone.addEventListener('click', () => {
            this.state.hideDone = !this.state.hideDone;
            // Use 'filter_list' (filled/active) when hiding done items, 'filter_list_off' when showing all
            btnToggleDone.innerHTML = `<i>${this.state.hideDone ? 'filter_list' : 'filter_list_off'}</i>`;
            btnToggleDone.classList.toggle('primary', this.state.hideDone);
            this.renderList();
        });

        // Bulk Toolbar Buttons
        document.getElementById('btn-bulk-exit').addEventListener('click', () => this.exitBulkMode());

        document.getElementById('btn-bulk-select-all').addEventListener('click', () => this.bulkSelectAll());

        document.getElementById('btn-bulk-toggle-done').addEventListener('click', () => this.bulkToggleDone());

        document.getElementById('btn-bulk-tag').addEventListener('click', () => {
            document.getElementById('inp-bulk-tag').value = '';
            ui('#dialog-bulk-tag');
        });

        document.getElementById('btn-bulk-tag-add').addEventListener('click', async () => {
            const raw = document.getElementById('inp-bulk-tag').value.trim();
            if (!raw) return;
            const tag = this._normalizeTag(raw);
            ui('#dialog-bulk-tag');
            await this.bulkApplyTag(tag, true);
        });

        document.getElementById('btn-bulk-tag-remove').addEventListener('click', async () => {
            const raw = document.getElementById('inp-bulk-tag').value.trim();
            if (!raw) return;
            const tag = this._normalizeTag(raw);
            ui('#dialog-bulk-tag');
            await this.bulkApplyTag(tag, false);
        });

        document.getElementById('btn-bulk-delete').addEventListener('click', () => {
            const count = this.state.selectedItems.size;
            document.getElementById('bulk-delete-confirm-text').textContent =
                `Are you sure you want to delete ${count} selected item${count !== 1 ? 's' : ''}?`;
            ui('#dialog-bulk-delete');
        });

        document.getElementById('btn-confirm-bulk-delete').addEventListener('click', async () => {
            ui('#dialog-bulk-delete');
            await this.bulkDeleteSelected();
        });

        // Long press detection for entering bulk mode
        let touchStartX = 0, touchStartY = 0;

        const appList = document.getElementById('app-list');

        appList.addEventListener('touchstart', (e) => {
            const listItem = e.target.closest('li[data-id]');
            if (!listItem || this.state.bulkMode) return;
            const id = String(listItem.dataset.id);
            touchStartX = e.touches[0].clientX;
            touchStartY = e.touches[0].clientY;
            this._longPressTimer = setTimeout(() => {
                this._preventNextClick = true;
                if (navigator.vibrate) navigator.vibrate(50);
                this.enterBulkMode(id);
            }, 500);
        }, { passive: true });

        appList.addEventListener('touchmove', (e) => {
            if (!this._longPressTimer) return;
            const dx = Math.abs(e.touches[0].clientX - touchStartX);
            const dy = Math.abs(e.touches[0].clientY - touchStartY);
            if (dx > 10 || dy > 10) {
                clearTimeout(this._longPressTimer);
                this._longPressTimer = null;
            }
        }, { passive: true });

        appList.addEventListener('touchend', () => {
            if (this._longPressTimer) {
                clearTimeout(this._longPressTimer);
                this._longPressTimer = null;
            }
        });

        let mouseStartX = 0, mouseStartY = 0;

        appList.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;
            const listItem = e.target.closest('li[data-id]');
            if (!listItem || this.state.bulkMode) return;
            const id = String(listItem.dataset.id);
            mouseStartX = e.clientX;
            mouseStartY = e.clientY;
            this._longPressTimer = setTimeout(() => {
                this._preventNextClick = true;
                this.enterBulkMode(id);
            }, 500);
        });

        appList.addEventListener('mousemove', (e) => {
            if (!this._longPressTimer) return;
            const dx = Math.abs(e.clientX - mouseStartX);
            const dy = Math.abs(e.clientY - mouseStartY);
            if (dx > 10 || dy > 10) {
                clearTimeout(this._longPressTimer);
                this._longPressTimer = null;
            }
        });

        appList.addEventListener('mouseup', () => {
            if (this._longPressTimer) {
                clearTimeout(this._longPressTimer);
                this._longPressTimer = null;
            }
        });

        // Delegate clicks for list items (Toggle, Delete, Edit)
        document.getElementById('app-list').addEventListener('click', async (e) => {
            // Suppress click that immediately follows a long press
            if (this._preventNextClick) {
                this._preventNextClick = false;
                return;
            }

            const listItem = e.target.closest('li[data-id]');
            if (!listItem) return;
            const id = String(listItem.dataset.id);

            // In bulk mode: clicking anywhere on the item toggles its selection
            if (this.state.bulkMode) {
                this.toggleBulkSelection(id);
                return;
            }
            
            // Checkbox click
            if (e.target.tagName === 'INPUT' && e.target.type === 'checkbox') {
                const isChecked = e.target.checked;
                await this.toggleItem(id, isChecked);
                return;
            }

            // Delete action (Menu item)
            const deleteAction = e.target.closest('.delete-action');
            if (deleteAction) {
                this.state.currentDeleteId = id;
                ui("#dialog-delete");
                return;
            }
            
            // Edit (click on text/body but not controls)
             const titleEl = e.target.closest('.title-text');
             if (titleEl && !e.target.closest('button')) {
                 this.openEditDialog(id);
             }
        });
    }

    startPolling() {
        if (this.state.isPolling) return;
        this.state.isPolling = true;
        this.pollInterval = setInterval(() => this.fetchItems(), 5000);
    }

    stopPolling() {
        this.state.isPolling = false;
        clearInterval(this.pollInterval);
    }

    async fetchItems() {
        if (!this.client) return;
        try {
            const res = await this.client.list();
            // NocoDB list returns { list: [], pageInfo: {} } or { records: [] }
            // Some API versions might return the array directly or in 'data' or 'records'
            const rawList = res.list || res.data || res.records || (Array.isArray(res) ? res : []);
            
            // Normalize items structure
            const newItems = rawList.map(item => {
                // Handle nested 'fields' structure (NocoDB V3)
                if (item.fields) {
                    return {
                        ...item.fields,
                        Id: item.id !== undefined ? item.id : item.Id  // Map root ID to 'Id'
                    };
                }
                // Handle flat structure (NocoDB V2)
                return {
                    ...item,
                    Id: item.Id !== undefined ? item.Id : item.id
                };
            });
            
            // Simple Diff to avoid re-rendering DOM if nothing changed (prevents input focus loss if we were editing inline)
            // Ideally we'd compare hash. For now, JSON stringify.
            const currentStr = JSON.stringify(this.items);
            const newStr = JSON.stringify(newItems);
            
            if (currentStr !== newStr) {
                this.items = newItems;
                this.renderAll();
            }
        } catch (err) {
            console.error("Fetch failed", err);
            // Optionally show snackbar "Offline" or "Sync Error"
        }
    }

    async addItem(title) {
        if (!this.client) return;
        try {
            await this.client.create({ Title: title, IsDone: false });
            this.fetchItems();
        } catch (err) {
            alert("Failed to add item");
        }
    }

    async toggleItem(id, isDone) {
        if (!this.client) return;
        // Optimistic UI update could happen here
        // Update local state first
        const item = this.items.find(i => String(i.Id) === String(id));
        if (item) item.IsDone = isDone;
        this.renderList(); 

        try {
            await this.client.update(id, { IsDone: isDone });
        } catch (err) {
            console.error(err);
            this.fetchItems(); // revert on fail
        }
    }

    async deleteItem(id) {
        if (!this.client) return;
        try {
            await this.client.delete(id);
            this.items = this.items.filter(i => String(i.Id) !== String(id));
            this.renderList();
        } catch (err) {
            alert("Failed to delete");
        }
    }
    
    async openEditDialog(id) {
        const item = this.items.find(i => String(i.Id) === String(id));
        if(!item) return;
        
        this.state.currentEditId = id;
        const input = document.getElementById('inp-edit-title');
        input.value = item.Title;
        // Focus trick
        setTimeout(() => input.focus(), 200);
        
        ui("#dialog-edit");
    }

    async saveEdit(id, newTitle) {
         try {
            // Optimistic update
            const item = this.items.find(i => String(i.Id) === String(id));
            if (item) item.Title = newTitle;
            this.renderList();

            await this.client.update(id, { Title: newTitle });
            this.fetchItems();
        } catch (err) {
            alert("Failed to update");
            this.fetchItems(); // Revert
        }
    }

    // --- Bulk Editing ---

    _normalizeTag(raw) {
        return raw.startsWith('#') ? raw : '#' + raw;
    }

    enterBulkMode(id) {
        this.state.bulkMode = true;
        this.state.selectedItems = new Set([String(id)]);
        document.body.classList.add('bulk-mode-active');
        document.getElementById('fab-add').style.display = 'none';
        document.getElementById('bulk-toolbar').style.display = 'block';
        this.renderList();
        this.updateBulkToolbar();
    }

    exitBulkMode() {
        this.state.bulkMode = false;
        this.state.selectedItems = new Set();
        document.body.classList.remove('bulk-mode-active');
        document.getElementById('fab-add').style.display = '';
        document.getElementById('bulk-toolbar').style.display = 'none';
        this.renderList();
    }

    toggleBulkSelection(id) {
        const sid = String(id);
        if (this.state.selectedItems.has(sid)) {
            this.state.selectedItems.delete(sid);
            if (this.state.selectedItems.size === 0) {
                this.exitBulkMode();
                return;
            }
        } else {
            this.state.selectedItems.add(sid);
        }
        this.renderList();
        this.updateBulkToolbar();
    }

    updateBulkToolbar() {
        const count = this.state.selectedItems.size;
        document.getElementById('bulk-count-label').textContent =
            `${count} item${count !== 1 ? 's' : ''} selected`;
    }

    bulkSelectAll() {
        const listItems = document.getElementById('app-list').querySelectorAll('li[data-id]');
        const visibleIds = [...listItems].map(li => String(li.dataset.id));
        const allSelected = visibleIds.every(id => this.state.selectedItems.has(id));
        if (allSelected) {
            // Deselect all and exit bulk mode
            this.exitBulkMode();
        } else {
            visibleIds.forEach(id => this.state.selectedItems.add(id));
            this.renderList();
            this.updateBulkToolbar();
        }
    }

    async bulkToggleDone() {
        if (!this.client || this.state.selectedItems.size === 0) return;
        const selectedIds = [...this.state.selectedItems];
        const selectedItems = this.items.filter(i => selectedIds.includes(String(i.Id)));
        // If all selected are done, unmark; otherwise mark all as done
        const allDone = selectedItems.every(i => i.IsDone);
        const newDoneState = !allDone;

        // Optimistic update
        selectedItems.forEach(item => { item.IsDone = newDoneState; });
        this.renderList();

        try {
            await Promise.all(selectedIds.map(id => this.client.update(id, { IsDone: newDoneState })));
        } catch (err) {
            console.error(err);
            this.fetchItems();
        }
    }

    async bulkApplyTag(tag, add) {
        if (!this.client || this.state.selectedItems.size === 0) return;
        const selectedIds = [...this.state.selectedItems];
        const selectedItems = this.items.filter(i => selectedIds.includes(String(i.Id)));
        // Matches the tag followed by a space, another tag, or end-of-string to avoid partial matches
        const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const tagRegex = new RegExp(escaped + '(?=[\\s#]|$)', 'g');

        // Optimistic update
        if (add) {
            selectedItems.forEach(item => {
                if (!item.Title.includes(tag)) {
                    item.Title = (item.Title.trim() + ' ' + tag).trim();
                }
            });
        } else {
            selectedItems.forEach(item => {
                // Remove the tag, then collapse any resulting double spaces
                item.Title = item.Title.replace(tagRegex, '').replace(/\s{2,}/g, ' ').trim();
            });
        }
        this.renderList();

        try {
            await Promise.all(selectedItems.map(item =>
                this.client.update(item.Id, { Title: item.Title })
            ));
            this.fetchItems();
        } catch (err) {
            console.error(err);
            this.fetchItems();
        }
    }

    async bulkDeleteSelected() {
        if (!this.client || this.state.selectedItems.size === 0) return;
        const selectedIds = [...this.state.selectedItems];
        try {
            await Promise.all(selectedIds.map(id => this.client.delete(id)));
            this.items = this.items.filter(i => !selectedIds.includes(String(i.Id)));
            this.exitBulkMode();
        } catch (err) {
            console.error(err);
            alert("Failed to delete some items");
            this.fetchItems();
        }
    }

    extractTags(title) {
        const regex = /#[\w-]+/g;
        return title.match(regex) || [];
    }

    getTitleWithoutTags(title) {
        // Optional: decide if we want to hide tags from main text.
        // For now user said "Cucumbers #shop-a", and "display visual chips".
        // Let's strip them from the displayed text to look clean.
        return title.replace(/#[\w-]+/g, '').trim();
    }

    renderAll() {
        this.renderFilters();
        this.renderList();
        if (this.state.bulkMode) {
            this.updateBulkToolbar();
        }
    }

    renderFilters() {
        const tagCounts = {};
        this.items.forEach(item => {
            const tags = this.extractTags(item.Title || '');
            tags.forEach(t => {
                tagCounts[t] = (tagCounts[t] || 0) + 1;
            });
        });

        const filterContainer = document.getElementById('filter-row');
        const activeCount = this.state.filterTags.length;
        const isAllActive = activeCount === 0;
        const badgeHtml = activeCount > 0 ? `<span class="filter-reset-badge">${activeCount}</span>` : '';
        let html = `<button class="chip ${isAllActive ? 'fill' : ''}" onclick="window.app.setFilter(null)" title="Clear all filters">All${badgeHtml}</button>`;
        
        // Sort tags by frequency (descending), then alphabetical
        const sortedTags = Object.keys(tagCounts).sort((a, b) => {
            const countDiff = tagCounts[b] - tagCounts[a];
            if (countDiff !== 0) return countDiff;
            return a.localeCompare(b);
        });

        sortedTags.forEach(tag => {
            const isActive = this.state.filterTags.includes(tag);
            html += `<button class="chip ${isActive ? 'fill' : ''}" onclick="window.app.setFilter('${tag}')">${tag}</button>`;
        });
        
        filterContainer.innerHTML = html;
    }

    setFilter(tag) {
        if (tag === null) {
            this.state.filterTags = [];
        } else {
            const idx = this.state.filterTags.indexOf(tag);
            if (idx === -1) {
                this.state.filterTags.push(tag);
            } else {
                this.state.filterTags.splice(idx, 1);
            }
        }
        this.renderAll();
    }

    renderList() {
        const listContainer = document.getElementById('app-list');
        
        // Filter
        let filtered = this.items.filter(item => {
            const title = (item.Title || '').toLowerCase();
            // Search
            if (this.state.searchQuery && !title.includes(this.state.searchQuery)) return false;
            // Tag (AND logic: item must match all selected tags)
            if (this.state.filterTags.length > 0) {
                const itemTags = this.extractTags(item.Title || '').map(t => t.toLowerCase());
                if (!this.state.filterTags.every(ft => itemTags.includes(ft.toLowerCase()))) return false;
            }
            // Hide Done
            if (this.state.hideDone && item.IsDone) return false;
            return true;
        });

        // Sort
        filtered.sort((a, b) => {
            // Sort Alphabetically only (Done status does not affect order)
            const titleA = this.getTitleWithoutTags(a.Title || '').toLowerCase();
            const titleB = this.getTitleWithoutTags(b.Title || '').toLowerCase();
            return titleA.localeCompare(titleB);
        });

        if (filtered.length === 0) {
            listContainer.innerHTML = `<li class="padding center-align opacity">No items found</li>`;
            return;
        }

        const html = filtered.map(item => {
            const tags = this.extractTags(item.Title || '');
            const displayTitle = this.getTitleWithoutTags(item.Title || '');
            const isDone = item.IsDone;
            const isSelected = this.state.bulkMode && this.state.selectedItems.has(String(item.Id));
            
            const tagHtml = tags.map(t => `<span class="tag-chip">${t}</span>`).join('');

            const liClass = [isDone ? 'item-done' : '', isSelected ? 'item-selected' : ''].filter(Boolean).join(' ');

            // In bulk mode use a circle icon (Material multi-select pattern) so
            // the selection state is visually distinct from the square done-checkbox.
            const leadingControl = this.state.bulkMode
                ? `<i class="bulk-circle-icon large ${isSelected ? 'primary-text' : ''}">${isSelected ? 'check_circle' : 'radio_button_unchecked'}</i>`
                : `<label class="checkbox large ${isDone ? 'grey-text' : ''}">
                       <input type="checkbox" ${isDone ? 'checked' : ''}>
                       <span></span>
                   </label>`;

            return `
            <li class="${liClass}" data-id="${item.Id}">
                ${leadingControl}
                <div class="max title-text pointer" style="min-width: 0;">
                    <h6 class="small no-margin truncate ${isDone ? 'grey-text overline' : ''}">${displayTitle} ${tagHtml}</h6>
                </div>
                ${!this.state.bulkMode ? `<button class="circle transparent">
                    <i>more_vert</i>
                    <menu class="left no-wrap">
                         <li class="delete-action">
                            <i>delete</i>
                            <a>Delete</a>
                        </li>
                    </menu>
                </button>` : ''}
            </li>
            `;
        }).join('');

        listContainer.innerHTML = html;
    }
}

// Global expose for inline onclicks (simple way)
window.app = new ShoppingApp();
window.addEventListener('DOMContentLoaded', window.app.init);
