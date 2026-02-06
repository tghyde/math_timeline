// Wait for the DOM to be fully loaded before running the script
document.addEventListener('DOMContentLoaded', () => {

    // --- 1. ELEMENT SELECTION ---
    // Get references to all the HTML elements we'll need to interact with
    const timelineContainer = document.getElementById('timeline-container');
    const searchBar = document.getElementById('search-bar');
    const searchResultsContainer = document.getElementById('search-results');
    const infoPanel = document.getElementById('info-panel');

    // --- 2. STATE MANAGEMENT ---
    // Variables to hold the application's state
    let timeline = null; // This will hold the Vis.js Timeline instance
    let allItems = []; // A flat array of all mathematicians and events for easy searching
    const selectedIds = new Set(); // A Set to efficiently track the IDs of items to display

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
            // Combine mathematicians and events into a single array for easier processing
            allItems = [...data.mathematicians, ...data.events];
            initialize();
        })
        .catch(error => {
            console.error("Could not load data.json:", error);
            searchResultsContainer.innerHTML = "<p>Error loading data. Please check the console.</p>";
        });

    /**
     * Sets up the initial state of the application after data is loaded.
     */
    function initialize() {
        // Initially, display all items in the search results
        renderSearchResults(allItems);
        
        // Create a new Vis.js Timeline instance
        const options = {
            stack: true,        // Stack overlapping items
            zoomable: true,
            zoomMin: 1000 * 60 * 60 * 24 * 365, // Min zoom is one year
            zoomMax: 1000 * 60 * 60 * 24 * 365 * 5000, // Max zoom is 5000 years
            minHeight: '200px',
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

        let details = '<div>';
        details += `<h3>${selectedItem.content}</h3>`;
        if (selectedItem.end) { // It's a mathematician
            const birthDate = new Date(selectedItem.start).toLocaleDateString();
            const deathDate = new Date(selectedItem.end).toLocaleDateString();
            details += `<p><strong>Lived:</strong> ${birthDate} to ${deathDate}</p>`;
        } else { // It's an event
            const eventDate = new Date(selectedItem.start).toLocaleDateString();
            details += `<p><strong>Date:</strong> ${eventDate}</p>`;
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
    searchBar.addEventListener('input', (e) => {
        const searchTerm = e.target.value.toLowerCase();

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
    });

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
            // If it's a mathematician (has an 'end' date), format the content
            if (item.end) {
                const birthYear = new Date(item.start).getFullYear();
                const deathYear = new Date(item.end).getFullYear();
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
    
    
});