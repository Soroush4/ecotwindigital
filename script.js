/**
 * Main Application Script - Modular EcoTwinAI Application
 * Coordinates all modules and initializes the application
 */

// Application state
let app = {
    core: null,
    data: null,
    tree: null,
    sun: null,
    energyStats: null,
    ui: null,
    stlExporter: null,
    isInitialized: false
};

/**
 * Validate that all required modules are available
 */
function validateModules() {
    const requiredModules = [
        'UtilsModule', 'CoreModule', 'DataModule', 
        'TreeModule', 'SunModule', 'EnergyStatsModule', 'UIModule'
    ];
    
    const missingModules = requiredModules.filter(moduleName => {
        return typeof window[moduleName] !== 'function';
    });
    
    if (missingModules.length > 0) {
        throw new Error(`Missing required modules: ${missingModules.join(', ')}`);
    }
    
    return true;
}

/**
 * Update status bar
 */
function updateStatus(message, showLoading = false) {
    const statusText = document.getElementById('status-text');
    const loadingIndicator = document.getElementById('loading-indicator');
    
    if (statusText) {
        statusText.textContent = message;
    }
    
    if (loadingIndicator) {
        loadingIndicator.style.display = showLoading ? 'flex' : 'none';
    }
}

/**
 * Initialize the application with all modules
 */
async function initializeApplication() {
    try {
        updateStatus('Initializing EcoTwinAI application...', true);
        console.log('Initializing EcoTwinAI application...');
        
        // Validate modules are loaded
        validateModules();
        updateStatus('All modules loaded successfully', false);
        console.log('✓ All required modules are available');

        // Initialize core module
        updateStatus('Initializing core module...', true);
        app.core = new CoreModule();
        await app.core.initialize();
        updateStatus('Core module ready', false);
        console.log('✓ Core module initialized');

        // Initialize data module
        updateStatus('Initializing data module...', true);
        app.data = new DataModule(app.core);
        app.data.updateBuildingCounter(); // Initialize building counter
        updateStatus('Data module ready', false);
        console.log('✓ Data module initialized');

        // Initialize tree module (but don't setup map layers yet)
        updateStatus('Initializing tree module...', true);
        app.tree = new TreeModule(app.core, app.data);
        app.tree.initialize();
        updateStatus('Tree module ready', false);
        console.log('✓ Tree module initialized');

        // Initialize sun module
        updateStatus('Initializing sun module...', true);
        app.sun = new SunModule(app.core);
        app.sun.initialize();
        updateStatus('Sun module ready', false);
        console.log('✓ Sun module initialized');

        // Initialize energy statistics module
        updateStatus('Initializing energy statistics module...', true);
        app.energyStats = new EnergyStatsModule(app.core, app.data);
        app.energyStats.initialize();
        app.data.setEnergyStatsModule(app.energyStats);
        updateStatus('Energy statistics module ready', false);
        console.log('✓ Energy statistics module initialized');

        // Initialize UI module (but don't setup map layers yet)
        updateStatus('Initializing UI module...', true);
        app.ui = new UIModule(app.core, app.data, app.tree);
        app.ui.initialize();
        updateStatus('UI module ready', false);
        console.log('✓ UI module initialized');

        // Initialize STL Exporter module
        updateStatus('Initializing STL exporter module...', true);
        app.stlExporter = new STLExporterModule(app.core, app.data);
        app.stlExporter.initialize();
        updateStatus('STL exporter module ready', false);
        console.log('✓ STL exporter module initialized');

        // Setup map load event - initialize modules that need map layers here
        const map = app.core.getMap();
        let mapLayersSetup = false;
        
        // Function to normalize layer order - ensure all layers have equal priority
        const normalizeLayerOrder = () => {
            try {
                // Wait a bit to ensure all layers are added
                setTimeout(() => {
                    if (!map.getLayer('geojson-layer')) return;
                    
                    // Since roads are now added BEFORE buildings, they should already be behind
                    // But we still need to ensure buildings and trees are at the same level
                    
                    // Ensure buildings and trees are at the same level (equal priority)
                    // Move tree layers to be right after buildings so they render together
                    // We want: buildings -> trunks -> canopies (all at same level)
                    // moveLayer(A, B) places A before B, so to place A after B, we need to:
                    // 1. Move A before B (A -> B)
                    // 2. Move B before A (B -> A)
                    // Result: B -> A (A is after B)
                    const buildingAndTreeLayers = [
                        'geojson-layer',       // Buildings (reference point)
                        'tree-trunks-layer',   // Tree trunks (same level as buildings)
                        'tree-canopies-layer'  // Tree canopies (same level as buildings)
                    ];
                    
                    // Move each tree layer to be right after the previous one
                    for (let i = 1; i < buildingAndTreeLayers.length; i++) {
                        const layerId = buildingAndTreeLayers[i];
                        const previousLayer = buildingAndTreeLayers[i - 1];
                        
                        if (map.getLayer(layerId) && map.getLayer(previousLayer)) {
                            try {
                                // To place layerId after previousLayer:
                                // 1. Move layerId before previousLayer (creates: layerId -> previousLayer)
                                map.moveLayer(layerId, previousLayer);
                                // 2. Move previousLayer before layerId (creates: previousLayer -> layerId)
                                map.moveLayer(previousLayer, layerId);
                                // Result: previousLayer -> layerId (layerId is after previousLayer)
                            } catch (e) {
                                console.debug(`Could not move layer ${layerId}:`, e.message);
                            }
                        }
                    }
                    
                    // Double-check: ensure roads are still behind buildings
                    if (map.getLayer('roads-layer') && map.getLayer('geojson-layer')) {
                        try {
                            // Move roads to be right before buildings (so roads render behind)
                            map.moveLayer('roads-layer', 'geojson-layer');
                            console.log('✓ Roads confirmed behind buildings');
                        } catch (e) {
                            console.debug(`Could not move roads-layer:`, e.message);
                        }
                    }
                    
                    console.log('✓ Layer order normalized - roads behind, buildings and trees at same level');
                }, 300);
            } catch (error) {
                console.warn('Could not normalize layer order:', error);
            }
        };

        // Function to setup map layers when ready
        const setupMapLayersWhenReady = () => {
            if (map.isStyleLoaded() && !mapLayersSetup) {
                updateStatus('Setting up map layers...', true);
                
                // Now that map is loaded, setup map layers for modules
                app.tree.setupMapLayers();
                app.ui.setupMapLayers();
                
                // Normalize layer order to ensure equal priority
                normalizeLayerOrder();
                
                // Set up lighting and initial sun position
                map.setConfigProperty('basemap', 'lightPreset', 'custom');
                app.sun.initializeSunPosition();
                
                mapLayersSetup = true;
                updateStatus('', false);
                console.log('✓ Map loaded and configured');
            } else if (!map.isStyleLoaded()) {
                // Retry after a short delay without showing loading message
                setTimeout(setupMapLayersWhenReady, 100);
            }
        };

        map.on('load', setupMapLayersWhenReady);
        map.on('styledata', setupMapLayersWhenReady);

        app.isInitialized = true;
        console.log('✓ Application fully initialized');
        
        // Make app globally accessible for modules
        window.app = app;
        
        // Setup delete buildings button after everything is ready
        setTimeout(() => {
            if (typeof window.setupDeleteBuildingsButton === 'function') {
                console.log('Setting up delete buildings button...');
                window.setupDeleteBuildingsButton();
            }
        }, 1000);
        
    } catch (error) {
        console.error('Failed to initialize application:', error);
        if (app.core) {
            app.core.showErrorMessage('Failed to initialize application. Please refresh the page.');
        } else {
            // Fallback error display if core module failed to initialize
    const mapContainer = document.getElementById('map');
    mapContainer.innerHTML = `
        <div style="
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100%;
            background-color: #f8f9fa;
            color: #dc3545;
            font-family: Arial, sans-serif;
            text-align: center;
            padding: 20px;
        ">
            <div>
                        <h3>🚫 Application Error</h3>
                        <p>Failed to initialize application: ${error.message}</p>
                <button onclick="location.reload()" style="
                    background-color: #007bff;
                    color: white;
                    border: none;
                    padding: 10px 20px;
                    border-radius: 5px;
                    cursor: pointer;
                    margin-top: 10px;
                ">Retry</button>
            </div>
        </div>
    `;
}
    }
}

/**
 * Get application instance (for debugging)
 */
function getApp() {
    return app;
}

/**
 * Setup menu toggle functionality
 */
function setupMenuToggle() {
    const menuToggle = document.getElementById('menu-toggle');
    const menu = document.getElementById('menu');
    const menuToggleIcon = document.getElementById('menu-toggle-icon');
    
    if (!menuToggle || !menu) return;
    
    // Check if menu state is stored in localStorage
    const savedState = localStorage.getItem('menuVisible');
    const isVisible = savedState === null ? true : savedState === 'true';
    
    // Set initial state
    if (isVisible) {
        menu.classList.add('menu-visible');
        menu.classList.remove('menu-hidden');
        menuToggle.classList.add('menu-visible');
        menuToggle.classList.remove('menu-hidden');
        menuToggleIcon.textContent = '✕';
    } else {
        menu.classList.add('menu-hidden');
        menu.classList.remove('menu-visible');
        menuToggle.classList.add('menu-hidden');
        menuToggle.classList.remove('menu-visible');
        menuToggleIcon.textContent = '☰';
    }
    
    // Toggle menu on button click
    menuToggle.addEventListener('click', () => {
        const isCurrentlyVisible = menu.classList.contains('menu-visible');
        
        if (isCurrentlyVisible) {
            // Hide menu
            menu.classList.remove('menu-visible');
            menu.classList.add('menu-hidden');
            menuToggle.classList.remove('menu-visible');
            menuToggle.classList.add('menu-hidden');
            menuToggleIcon.textContent = '☰';
            localStorage.setItem('menuVisible', 'false');
        } else {
            // Show menu
            menu.classList.remove('menu-hidden');
            menu.classList.add('menu-visible');
            menuToggle.classList.remove('menu-hidden');
            menuToggle.classList.add('menu-visible');
            menuToggleIcon.textContent = '✕';
            localStorage.setItem('menuVisible', 'true');
        }
    });
}

// Start the application when the page loads
document.addEventListener('DOMContentLoaded', () => {
    initializeApplication();
    setupMenuToggle();
});
