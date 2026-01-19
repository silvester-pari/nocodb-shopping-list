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
            filterTag: null,
            searchQuery: '',
            isPolling: false,
            currentEditId: null,
            currentDeleteId: null,
            hideDone: false
        };
        this.pollInterval = null;
        
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

        // Delegate clicks for list items (Toggle, Delete, Edit)
        document.getElementById('app-list').addEventListener('click', async (e) => {
            const listItem = e.target.closest('li[data-id]');
            if (!listItem) return;
            const id = listItem.dataset.id;
            
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
        const item = this.items.find(i => i.Id == id); // NocoDB uses 'Id' usually
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
            this.items = this.items.filter(i => i.Id != id);
            this.renderList();
        } catch (err) {
            alert("Failed to delete");
        }
    }
    
    async openEditDialog(id) {
        const item = this.items.find(i => i.Id == id);
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
            const item = this.items.find(i => i.Id == id);
            if (item) item.Title = newTitle;
            this.renderList();

            await this.client.update(id, { Title: newTitle });
            this.fetchItems();
        } catch (err) {
            alert("Failed to update");
            this.fetchItems(); // Revert
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
        let html = `<button class="chip ${this.state.filterTag === null ? 'fill' : ''}" onclick="window.app.setFilter(null)">All</button>`;
        
        // Sort tags by frequency (descending), then alphabetical
        const sortedTags = Object.keys(tagCounts).sort((a, b) => {
            const countDiff = tagCounts[b] - tagCounts[a];
            if (countDiff !== 0) return countDiff;
            return a.localeCompare(b);
        });

        sortedTags.forEach(tag => {
            const isActive = this.state.filterTag === tag;
            html += `<button class="chip ${isActive ? 'fill' : ''}" onclick="window.app.setFilter('${tag}')">${tag}</button>`;
        });
        
        filterContainer.innerHTML = html;
    }

    setFilter(tag) {
        this.state.filterTag = tag;
        this.renderAll(); // Re-render chips to update active state and list
    }

    renderList() {
        const listContainer = document.getElementById('app-list');
        
        // Filter
        let filtered = this.items.filter(item => {
            const title = (item.Title || '').toLowerCase();
            // Search
            if (this.state.searchQuery && !title.includes(this.state.searchQuery)) return false;
            // Tag
            if (this.state.filterTag && !title.includes(this.state.filterTag.toLowerCase())) return false;
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
            
            const tagHtml = tags.map(t => `<span class="tag-chip">${t}</span>`).join('');

            return `
            <li class="${isDone ? 'item-done' : ''}" data-id="${item.Id}">
                <label class="checkbox large ${isDone ? 'grey-text' : ''}">
                    <input type="checkbox" ${isDone ? 'checked' : ''}>
                    <span></span>
                </label>
                <div class="max title-text pointer" style="min-width: 0;">
                    <h6 class="small no-margin truncate ${isDone ? 'grey-text overline' : ''}">${displayTitle} ${tagHtml}</h6>
                </div>
                <button class="circle transparent">
                    <i>more_vert</i>
                    <menu class="left no-wrap">
                         <li class="delete-action"><a>Delete</a></li>
                    </menu>
                </button>
            </li>
            `;
        }).join('');

        listContainer.innerHTML = html;
    }
}

// Global expose for inline onclicks (simple way)
window.app = new ShoppingApp();
window.addEventListener('DOMContentLoaded', window.app.init);
