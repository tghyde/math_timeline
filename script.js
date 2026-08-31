// Wait for the DOM to be fully loaded before running the script
document.addEventListener('DOMContentLoaded', () => {

    // --- 1. ELEMENT SELECTION ---
    // Get references to all the HTML elements we'll need to interact with
    const timelineContainer = document.getElementById('timeline-container');
    const searchBar = document.getElementById('search-bar');
    const searchResultsContainer = document.getElementById('search-results');
    const infoPanel = document.getElementById('info-panel');
    const timelineNameInput = document.getElementById('timeline-name');
    const saveTimelineBtn = document.getElementById('save-timeline-btn');
    const savedTimelinesList = document.getElementById('saved-timelines-list');
    const addEntryBtn = document.getElementById('add-entry-btn');
    const exportBtn = document.getElementById('export-btn');
    const addDialog = document.getElementById('add-dialog');
    const addForm = document.getElementById('add-form');
    const addFormError = document.getElementById('add-form-error');

    // --- 2. STATE MANAGEMENT ---
    // Variables to hold the application's state
    let timeline = null; // This will hold the Vis.js Timeline instance
    let allItems = []; // A flat array of all mathematicians and events for easy searching
    const selectedIds = new Set(); // A Set to efficiently track the IDs of items to display

    // The data as it exists in data.json (the repo copy)
    let baseData = { mathematicians: [], events: [], timelines: [] };
    // Items added through the form in this browser, not yet committed to the repo
    let customItems = { mathematicians: [], events: [] };
    // Named selections; merged from data.json and this browser's saves
    let savedTimelines = [];

    const LS_CUSTOM_KEY = 'mathTimeline.customItems';
    const LS_TIMELINES_KEY = 'mathTimeline.savedTimelines';
    const LS_THEME_KEY = 'mathTimeline.theme';

    // --- DAY/NIGHT MODE ---
    // The initial theme is applied by the inline script in index.html; this
    // button flips it and remembers the choice for future visits.
    const themeToggleBtn = document.getElementById('theme-toggle');

    function syncThemeToggle() {
        const isLight = document.documentElement.dataset.theme === 'light';
        themeToggleBtn.textContent = isLight ? '🌙' : '☀️';
        themeToggleBtn.title = isLight ? 'Switch to night mode' : 'Switch to day mode';
    }

    themeToggleBtn.addEventListener('click', () => {
        const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
        document.documentElement.dataset.theme = next;
        localStorage.setItem(LS_THEME_KEY, next);
        syncThemeToggle();
    });

    syncThemeToggle();

    // --- FOLDABLE CONTROLS PANEL ---
    const appContainer = document.getElementById('app-container');
    const foldBtn = document.getElementById('fold-btn');

    foldBtn.addEventListener('click', () => {
        const collapsed = appContainer.classList.toggle('controls-collapsed');
        foldBtn.textContent = collapsed ? '⟩' : '⟨';
        foldBtn.title = collapsed ? 'Show panel' : 'Hide panel';
        if (timeline) timeline.redraw();
    });

    // --- 3. DATA FETCHING & INITIALIZATION ---
    // Fetch the data from the JSON file and initialize the application
    fetch('data.json')
        .then(response => {
            if (!response.ok) {
                throw new Error(`HTTP error! Status: ${response.status}`);
            }
            return response.json();
        })
        .then(data => {
            baseData = {
                mathematicians: data.mathematicians || [],
                events: data.events || [],
                timelines: data.timelines || []
            };
            loadLocalAdditions();
            rebuildAllItems();
            initialize();
        })
        .catch(error => {
            console.error("Could not load data.json:", error);
            searchResultsContainer.innerHTML = "<p>Error loading data. Please check the console.</p>";
        });

    /**
     * Reads this browser's saved additions/timelines from localStorage and merges
     * them with the repo data. Additions that have since been committed to
     * data.json (matched by name + start date) are pruned so nothing duplicates.
     */
    function loadLocalAdditions() {
        try {
            customItems = JSON.parse(localStorage.getItem(LS_CUSTOM_KEY)) || { mathematicians: [], events: [] };
        } catch (e) {
            customItems = { mathematicians: [], events: [] };
        }
        const inBase = (list, item) => list.some(b => b.content === item.content && b.start === item.start);
        customItems.mathematicians = (customItems.mathematicians || []).filter(m => !inBase(baseData.mathematicians, m));
        customItems.events = (customItems.events || []).filter(ev => !inBase(baseData.events, ev));
        persistCustomItems();

        let localTimelines = [];
        try {
            localTimelines = JSON.parse(localStorage.getItem(LS_TIMELINES_KEY)) || [];
        } catch (e) {
            localTimelines = [];
        }
        // A locally saved timeline overrides a repo one with the same name (it's newer)
        const localNames = new Set(localTimelines.map(t => t.name));
        savedTimelines = [
            ...baseData.timelines.filter(t => !localNames.has(t.name)),
            ...localTimelines
        ];
    }

    function persistCustomItems() {
        localStorage.setItem(LS_CUSTOM_KEY, JSON.stringify(customItems));
    }

    function persistTimelines() {
        localStorage.setItem(LS_TIMELINES_KEY, JSON.stringify(savedTimelines));
    }

    /**
     * Rebuilds the flat searchable list from repo data plus local additions,
     * tagging each item with its kind so we can tell them apart later
     * (events may also have an end date).
     */
    function rebuildAllItems() {
        allItems = [
            ...[...baseData.mathematicians, ...customItems.mathematicians].map(m => ({ ...m, kind: 'person' })),
            ...[...baseData.events, ...customItems.events].map(e => ({ ...e, kind: 'event' }))
        ];
    }

    /**
     * Sets up the initial state of the application after data is loaded.
     */
    function initialize() {
        // Initially, display all items in the search results
        applyFilter();
        renderSavedTimelines();

        // Create a new Vis.js Timeline instance
        const options = {
            stack: true,        // Stack overlapping items
            zoomable: true,
            zoomMin: 1000 * 60 * 60 * 24 * 365, // Min zoom is one year
            zoomMax: 1000 * 60 * 60 * 24 * 365 * 5000, // Max zoom is 5000 years
            minHeight: '200px',
            maxHeight: '65vh', // Leave room for the info panel below
            margin: {
                item: { vertical: 4, horizontal: 2 }, // Gap between stacked bars
                axis: 5
            },
            className: 'vis-timeline-graph2d-dark'
        };
        timeline = new vis.Timeline(timelineContainer, new vis.DataSet(), options);

        // Add an event listener for when an item on the timeline is selected (clicked)
        timeline.on('select', handleTimelineSelect);
    }

    /**
     * Handles the 'select' event from the timeline to show info in the panel.
     * @param {object} properties - The event properties from Vis.js.
     */
    function handleTimelineSelect(properties) {
        const selectedId = properties.items[0];
        infoPanel.innerHTML = ''; // Clear the panel

        if (!selectedId) {
            infoPanel.innerHTML = '<p class="placeholder">Click an item on the timeline to see details here.</p>';
            return;
        }

        const selectedItem = allItems.find(item => item.id === selectedId);
        if (!selectedItem) return;

        // Create the content for the info panel
        let content = '';
        if (selectedItem.image) {
            content += `<div class="info-image-box"><img src="${selectedItem.image}" alt="${selectedItem.content}"></div>`;
        }

        // Format ISO dates in UTC so e.g. "1770-01-01" doesn't display as Dec 31, 1769 locally
        const formatDate = iso => new Date(iso).toLocaleDateString(undefined, { timeZone: 'UTC' });

        let details = '<div>';
        details += `<h3>${selectedItem.content}</h3>`;
        if (selectedItem.kind === 'person') {
            details += `<p><strong>Lived:</strong> ${formatDate(selectedItem.start)} to ${formatDate(selectedItem.end)}</p>`;
        } else if (selectedItem.end) { // An event spanning a range of years
            details += `<p><strong>Date:</strong> ${formatDate(selectedItem.start)} to ${formatDate(selectedItem.end)}</p>`;
        } else {
            details += `<p><strong>Date:</strong> ${formatDate(selectedItem.start)}</p>`;
        }

        if (selectedItem.description) {
            details += `<p>${selectedItem.description}</p>`;
        }

        if (selectedItem.tags && selectedItem.tags.length > 0) {
            details += `<p><strong>Tags:</strong> ${selectedItem.tags.join(', ')}</p>`;
        }
        details += '</div>';

        infoPanel.innerHTML = content + details;
        timeline.setSelection([]); // Deselect to allow clicking again
    }

    // --- 4. SEARCH & FILTERING LOGIC ---
    // Add an event listener to the search bar to filter results as the user types
    searchBar.addEventListener('input', applyFilter);

    /**
     * Filters `allItems` by the current search term and re-renders the results list.
     */
    function applyFilter() {
        const searchTerm = searchBar.value.toLowerCase();

        // If the search bar is empty, show all items
        if (!searchTerm) {
            renderSearchResults(allItems);
            return;
        }

        // Filter `allItems` based on the search term
        const filteredItems = allItems.filter(item => {
            const nameMatch = item.content.toLowerCase().includes(searchTerm);
            const tagMatch = item.tags && item.tags.some(tag => tag.toLowerCase().includes(searchTerm));
            return nameMatch || tagMatch;
        });

        renderSearchResults(filteredItems);
    }

    /**
     * Renders the provided list of items into the search results container.
     * @param {Array} items - The array of items to display.
     */
    function renderSearchResults(items) {
        // Clear previous results
        searchResultsContainer.innerHTML = '';

        if (items.length === 0) {
            searchResultsContainer.innerHTML = '<p>No results found.</p>';
            return;
        }

        // Create and append a result item for each person/event
        items.forEach(item => {
            const itemDiv = document.createElement('div');
            itemDiv.className = 'result-item';

            const label = document.createElement('label');
            label.textContent = item.content;
            label.setAttribute('for', `checkbox-${item.id}`);

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.id = `checkbox-${item.id}`;
            checkbox.value = item.id;
            checkbox.checked = selectedIds.has(item.id); // Set checked state based on our Set

            // When a checkbox is changed, update the selection and the timeline
            checkbox.addEventListener('change', () => {
                handleSelectionChange(item.id, checkbox.checked);
            });

            itemDiv.appendChild(label);
            itemDiv.appendChild(checkbox);
            searchResultsContainer.appendChild(itemDiv);
        });
    }

    // --- 5. TIMELINE UPDATE LOGIC ---
    /**
     * Handles adding or removing an item's ID from the selection set.
     * @param {number} id - The ID of the item.
     * @param {boolean} isSelected - The new selected state.
     */
    function handleSelectionChange(id, isSelected) {
        if (isSelected) {
            selectedIds.add(id);
        } else {
            selectedIds.delete(id);
        }
        updateTimeline();
    }

    /**
     * Updates the timeline visualization with the currently selected items.
     */
    function updateTimeline() {
        // Filter the main list to get only the items whose IDs are in our `selectedIds` Set
        const itemsToShow = allItems
        .filter(item => selectedIds.has(item.id))
        .map(item => {
            // If it's a mathematician, append life dates to the label
            if (item.kind === 'person') {
                const birthYear = new Date(item.start).getUTCFullYear();
                const deathYear = new Date(item.end).getUTCFullYear();
                return {
                    ...item, // Copy all original properties
                    content: `${item.content} (${birthYear}–${deathYear})`
                };
            }
            return item; // Otherwise, return the item (event) as is
        });

        // Update the timeline with the new dataset
        timeline.setItems(new vis.DataSet(itemsToShow));

        if (itemsToShow.length > 0) {
            // Manually set the window with a buffer instead of using fit()
            const allDates = itemsToShow.flatMap(item => [new Date(item.start), new Date(item.end || item.start)]);
            const minDate = new Date(Math.min.apply(null, allDates));
            const maxDate = new Date(Math.max.apply(null, allDates));

            // Add a 5-year buffer on each side
            const bufferYears = 5;
            minDate.setFullYear(minDate.getFullYear() - bufferYears);
            maxDate.setFullYear(maxDate.getFullYear() + bufferYears);

            timeline.setWindow(minDate, maxDate, { animation: true });
        }
    }

    // --- 6. SAVED TIMELINES ---
    saveTimelineBtn.addEventListener('click', () => {
        const name = timelineNameInput.value.trim();
        if (!name) {
            alert('Give the timeline a name first.');
            return;
        }
        if (selectedIds.size === 0) {
            alert('Select at least one item to save a timeline.');
            return;
        }
        // Saving under an existing name overwrites that timeline
        savedTimelines = savedTimelines.filter(t => t.name !== name);
        savedTimelines.push({ name, ids: [...selectedIds] });
        persistTimelines();
        renderSavedTimelines();
        timelineNameInput.value = '';
    });

    /**
     * Renders the list of saved timelines with load/delete controls.
     */
    function renderSavedTimelines() {
        savedTimelinesList.innerHTML = '';

        if (savedTimelines.length === 0) {
            savedTimelinesList.innerHTML = '<p class="hint">No saved timelines yet. Select some items and save them under a name.</p>';
            return;
        }

        savedTimelines.forEach(t => {
            const row = document.createElement('div');
            row.className = 'saved-timeline-row';

            const name = document.createElement('span');
            name.className = 'saved-timeline-name';
            name.textContent = `${t.name} (${t.ids.length})`;
            name.title = 'Load this timeline';
            name.addEventListener('click', () => loadTimeline(t));

            const loadBtn = document.createElement('button');
            loadBtn.textContent = 'Load';
            loadBtn.addEventListener('click', () => loadTimeline(t));

            const deleteBtn = document.createElement('button');
            deleteBtn.textContent = '✕';
            deleteBtn.title = 'Delete this saved timeline';
            deleteBtn.addEventListener('click', () => {
                if (!confirm(`Delete saved timeline "${t.name}"?`)) return;
                savedTimelines = savedTimelines.filter(s => s.name !== t.name);
                persistTimelines();
                renderSavedTimelines();
            });

            row.appendChild(name);
            row.appendChild(loadBtn);
            row.appendChild(deleteBtn);
            savedTimelinesList.appendChild(row);
        });
    }

    /**
     * Replaces the current selection with a saved timeline's items.
     */
    function loadTimeline(t) {
        selectedIds.clear();
        t.ids.forEach(id => {
            if (allItems.some(item => item.id === id)) {
                selectedIds.add(id);
            }
        });
        applyFilter(); // Re-render checkboxes to reflect the new selection
        updateTimeline();
    }

    // --- 7. ADDING PEOPLE & EVENTS ---
    const entryType = document.getElementById('entry-type');
    const entryName = document.getElementById('entry-name');
    const entryStart = document.getElementById('entry-start');
    const entryEnd = document.getElementById('entry-end');
    const entryTags = document.getElementById('entry-tags');
    const entryImage = document.getElementById('entry-image');
    const entryDescription = document.getElementById('entry-description');

    addEntryBtn.addEventListener('click', () => {
        addForm.reset();
        addFormError.hidden = true;
        updateFormLabels();
        addDialog.showModal();
    });

    document.getElementById('add-cancel-btn').addEventListener('click', () => addDialog.close());

    // Relabel the date fields depending on whether we're adding a person or an event
    entryType.addEventListener('change', updateFormLabels);
    function updateFormLabels() {
        const isPerson = entryType.value === 'person';
        document.getElementById('entry-name-label').textContent = isPerson ? 'Name' : 'Title';
        document.getElementById('entry-start-label').textContent = isPerson ? 'Born' : 'Date';
        document.getElementById('entry-end-label').textContent = isPerson ? 'Died' : 'End date (optional, for a period)';
        entryEnd.required = isPerson;
        entryName.placeholder = isPerson ? 'e.g., Sophus Lie' : "e.g., Lie founds the theory of continuous groups";
    }

    /**
     * Accepts "YYYY" or "YYYY-MM-DD" and returns a full ISO date, or null if invalid.
     */
    function normalizeDate(value) {
        const v = value.trim();
        if (/^-?\d{1,4}$/.test(v)) return `${v.padStart(4, '0')}-01-01`;
        if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
            return isNaN(new Date(v).getTime()) ? null : v;
        }
        return null;
    }

    addForm.addEventListener('submit', (e) => {
        e.preventDefault();

        const isPerson = entryType.value === 'person';
        const name = entryName.value.trim();
        const start = normalizeDate(entryStart.value);
        const end = entryEnd.value.trim() ? normalizeDate(entryEnd.value) : null;

        const fail = msg => {
            addFormError.textContent = msg;
            addFormError.hidden = false;
        };

        if (!name) return fail('A name is required.');
        if (!start) return fail('The first date must be a year (e.g., 1770) or a full date (e.g., 1770-01-01).');
        if (entryEnd.value.trim() && !end) return fail('The end date must be a year or a full date.');
        if (isPerson && !end) return fail('A death date is required for a person.');
        if (end && new Date(end) < new Date(start)) return fail('The end date is before the start date.');
        if (allItems.some(item => item.content.toLowerCase() === name.toLowerCase())) {
            return fail(`"${name}" is already on the list.`);
        }

        const tags = entryTags.value.split(',').map(t => t.trim().toLowerCase()).filter(Boolean);

        const item = { id: nextId(isPerson), content: name, start };
        if (end) item.end = end;
        if (!isPerson) item.type = end ? 'range' : 'point';
        if (tags.length) item.tags = tags;
        if (entryImage.value.trim()) item.image = entryImage.value.trim();
        if (entryDescription.value.trim()) item.description = entryDescription.value.trim();

        customItems[isPerson ? 'mathematicians' : 'events'].push(item);
        persistCustomItems();
        rebuildAllItems();

        // Show the new item immediately: select it and refresh the list
        selectedIds.add(item.id);
        applyFilter();
        updateTimeline();

        addDialog.close();
    });

    /**
     * People and events use separate id ranges (events start at 101).
     */
    function nextId(isPerson) {
        const pool = isPerson
            ? [...baseData.mathematicians, ...customItems.mathematicians]
            : [...baseData.events, ...customItems.events];
        return pool.reduce((max, item) => Math.max(max, item.id), isPerson ? 0 : 100) + 1;
    }

    // --- 8. EXPORTING THE DATA ---
    // Downloads the full dataset (repo data + this browser's additions + saved
    // timelines) as data.json, ready to commit to the repo.
    exportBtn.addEventListener('click', () => {
        const out = {
            mathematicians: [...baseData.mathematicians, ...customItems.mathematicians],
            events: [...baseData.events, ...customItems.events],
            timelines: savedTimelines
        };
        const blob = new Blob([JSON.stringify(out, null, 2) + '\n'], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'data.json';
        a.click();
        URL.revokeObjectURL(url);
    });

});
