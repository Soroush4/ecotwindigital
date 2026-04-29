/**
 * Tree Module - Tree simulation and management
 * Handles tree creation, deletion, and interaction
 */

class TreeModule {
    constructor(coreModule, dataModule) {
        this.core = coreModule;
        this.data = dataModule;
        this.currentTreeMode = null;
        this.isDragging = false;
        this.lastTreePosition = null;
        this.layersSetup = false;
        this.brushShape = null; // Current brush shape feature
        this.polygonPoints = []; // Points for custom polygon
        this.isDrawingPolygon = false; // Flag for polygon drawing mode
        this.deletePolygonPoints = []; // Points for delete polygon
        this.isDrawingDeletePolygon = false; // Flag for delete polygon drawing mode
        this.treesVisible = true; // Track tree visibility state
    }

    /**
     * Initialize tree module (without map layers)
     */
    initialize() {
        this.setupEventListeners();
        this.updateTreeCounter();
    }

    /**
     * Setup map layers (call this after map is loaded)
     */
    setupMapLayers() {
        if (!this.layersSetup) {
            this.setupMapLayersInternal();
        }
    }

    /**
     * Set tree mode (multi, delete, or null)
     * @param {string|null} mode - Tree mode
     */
    setTreeMode(mode) {
        if (this.currentTreeMode === mode) {
            this.currentTreeMode = null;
        } else {
            this.currentTreeMode = mode;
        }

        this.updateTreeButtons();
        const map = this.core.getMap();
        map.getCanvas().style.cursor = this.currentTreeMode ? 'crosshair' : '';
    }

    /**
     * Update tree button states
     */
    updateTreeButtons() {
        const treeModeMultiBtn = document.getElementById('tree-mode-multi');
        const treeModeBrushBtn = document.getElementById('tree-mode-brush');
        const treeModeDeleteBtn = document.getElementById('tree-mode-delete');
        const treeModeDeleteBrushBtn = document.getElementById('tree-mode-delete-brush');
        const treeCreatorBtns = [treeModeMultiBtn, treeModeBrushBtn, treeModeDeleteBtn, treeModeDeleteBrushBtn];

        treeCreatorBtns.forEach(btn => {
            if (!btn) return;
            let btnMode;
            if (btn.id === 'tree-mode-delete-brush') {
                btnMode = 'delete-brush';
            } else if (btn.id === 'tree-mode-brush') {
                btnMode = 'brush';
            } else {
                btnMode = btn.id.split('-')[2];
            }
            if (btnMode === this.currentTreeMode) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });
        
        // Show/hide create brush parameters
        const brushParams = document.getElementById('brush-params');
        if (brushParams) {
            brushParams.style.display = this.currentTreeMode === 'brush' ? 'block' : 'none';
        }
        
        // Show/hide delete brush parameters
        const deleteBrushParams = document.getElementById('delete-brush-params');
        if (deleteBrushParams) {
            deleteBrushParams.style.display = this.currentTreeMode === 'delete-brush' ? 'block' : 'none';
        }
        
        // Clear brush shape when mode changes
        if (this.currentTreeMode !== 'brush' && this.currentTreeMode !== 'delete-brush') {
            this.clearBrushShape();
            this.cancelPolygon();
            this.cancelDeletePolygon();
        } else if (this.currentTreeMode === 'brush') {
            this.updateBrushShapeUI();
        } else if (this.currentTreeMode === 'delete-brush') {
            this.updateDeleteBrushShapeUI();
        }
    }

    /**
     * Setup event listeners for tree functionality
     */
    setupEventListeners() {
        const treeModeMultiBtn = document.getElementById('tree-mode-multi');
        const treeModeBrushBtn = document.getElementById('tree-mode-brush');
        const treeModeDeleteBtn = document.getElementById('tree-mode-delete');
        const treeModeDeleteBrushBtn = document.getElementById('tree-mode-delete-brush');
        const treeDeleteAllBtn = document.getElementById('tree-delete-all');

        // Create mode buttons
        if (treeModeMultiBtn) {
            treeModeMultiBtn.addEventListener('click', () => this.setTreeMode('multi'));
        }
        if (treeModeBrushBtn) {
            treeModeBrushBtn.addEventListener('click', () => this.setTreeMode('brush'));
        }
        
        // Delete mode buttons
        if (treeModeDeleteBtn) {
            treeModeDeleteBtn.addEventListener('click', () => this.setTreeMode('delete'));
        }
        if (treeModeDeleteBrushBtn) {
            treeModeDeleteBrushBtn.addEventListener('click', () => this.setTreeMode('delete-brush'));
        }

        // Delete all trees button
        treeDeleteAllBtn.addEventListener('click', () => {
            this.deleteAllTrees();
        });
        
        // Tree visibility toggle button
        const treeVisibilityToggle = document.getElementById('tree-visibility-toggle');
        if (treeVisibilityToggle) {
            treeVisibilityToggle.addEventListener('click', () => {
                this.toggleTreesVisibility();
            });
        }
        
        // Brush shape selector - update UI immediately on change
        const brushShapeSelector = document.getElementById('brush-shape');
        if (brushShapeSelector) {
            brushShapeSelector.addEventListener('change', () => {
                this.updateBrushShapeUI();
            });
        }
        
        // Delete brush shape selector - update UI immediately on change
        const deleteBrushShapeSelector = document.getElementById('delete-brush-shape');
        if (deleteBrushShapeSelector) {
            deleteBrushShapeSelector.addEventListener('change', () => {
                this.updateDeleteBrushShapeUI();
            });
        }

        const map = this.core.getMap();

        // Map click events
        map.on('click', (e) => {
            if (this.currentTreeMode === 'delete') {
                this.data.deleteTreesAtPoint(e.point);
            } else if (this.currentTreeMode === 'brush') {
                const brushShape = document.getElementById('brush-shape').value;
                
                if (brushShape === 'polygon') {
                    // Handle polygon drawing
                    if (this.isDrawingPolygon) {
                        // Add point to polygon
                        this.polygonPoints.push([e.lngLat.lng, e.lngLat.lat]);
                        this.updatePolygonPreview();
                    } else {
                        // Start drawing polygon
                        this.startDrawingPolygon(e.lngLat);
                    }
                } else {
                    // Place trees in shape (circle or square)
                    const brushSize = Number(document.getElementById('brush-radius').value);
                    const brushCount = Number(document.getElementById('brush-count').value);
                    this.data.placeTreesInShape(e.lngLat, brushShape, brushSize, brushCount);
                }
            } else if (this.currentTreeMode === 'delete-brush') {
                const deleteBrushShape = document.getElementById('delete-brush-shape').value;
                
                if (deleteBrushShape === 'polygon') {
                    // Handle delete polygon drawing
                    if (this.isDrawingDeletePolygon) {
                        // Add point to delete polygon
                        this.deletePolygonPoints.push([e.lngLat.lng, e.lngLat.lat]);
                        this.updateDeletePolygonPreview();
                    } else {
                        // Start drawing delete polygon
                        this.startDrawingDeletePolygon(e.lngLat);
                    }
                } else {
                    // Delete trees in shape (circle or square)
                    const deleteBrushSize = Number(document.getElementById('delete-brush-radius').value);
                    this.data.deleteTreesInShape(e.lngLat, deleteBrushShape, deleteBrushSize);
                }
            }
        });
        
        // Double-click to finish polygon
        map.on('dblclick', (e) => {
            if (this.currentTreeMode === 'brush' && this.isDrawingPolygon) {
                e.preventDefault();
                this.finishPolygon();
            } else if (this.currentTreeMode === 'delete-brush' && this.isDrawingDeletePolygon) {
                e.preventDefault();
                this.finishDeletePolygon();
            }
        });

        // Mouse events for tree placement
        map.on('mousedown', (e) => {
            if (e.originalEvent.button !== 0) return;
            if (this.currentTreeMode) e.preventDefault();

            if (this.currentTreeMode === 'multi') {
                this.isDragging = true;
                map.dragPan.disable();
                this.data.placeTree(e.lngLat);
                this.lastTreePosition = e.lngLat;
            } else if (this.currentTreeMode === 'delete') {
                this.isDragging = true;
                map.dragPan.disable();
                this.data.deleteTreesAtPoint(e.point);
            }
        });

        // Throttled mouse move for tree placement and brush preview
        map.on('mousemove', UtilsModule.throttle((e) => {
            if (this.currentTreeMode === 'brush' && !this.isDrawingPolygon) {
                // Update brush shape preview
                this.updateBrushShape(e.lngLat);
            } else if (this.isDrawingPolygon && this.polygonPoints.length > 0) {
                // Update polygon preview with current mouse position
                this.updatePolygonPreview(e.lngLat);
            } else if (this.currentTreeMode === 'delete-brush' && !this.isDrawingDeletePolygon) {
                // Update delete brush shape preview
                this.updateDeleteBrushShape(e.lngLat);
            } else if (this.isDrawingDeletePolygon && this.deletePolygonPoints.length > 0) {
                // Update delete polygon preview with current mouse position
                this.updateDeletePolygonPreview(e.lngLat);
            } else if (this.isDragging) {
                if (this.currentTreeMode === 'multi') {
                    const distance = turf.distance(
                        [this.lastTreePosition.lng, this.lastTreePosition.lat],
                        [e.lngLat.lng, e.lngLat.lat],
                        { units: 'meters' }
                    );
                    const minDistance = document.getElementById('tree-distance').value;
                    if (distance > minDistance) {
                        this.data.placeTree(e.lngLat);
                        this.lastTreePosition = e.lngLat;
                    }
                } else if (this.currentTreeMode === 'delete') {
                    this.data.deleteTreesAtPoint(e.point);
                }
            }
        }, 50));

        map.on('mouseup', () => {
            if (this.isDragging) {
                this.isDragging = false;
                this.lastTreePosition = null;
                if (!this.currentTreeMode) {
                    map.dragPan.enable();
                }
            }
            if (this.currentTreeMode !== 'multi' && this.currentTreeMode !== 'delete' && this.currentTreeMode !== 'brush' && this.currentTreeMode !== 'delete-brush') {
                map.dragPan.enable();
            }
        });
        
        // Disable drag pan when brush mode is active
        map.on('mousedown', (e) => {
            if ((this.currentTreeMode === 'brush' || this.currentTreeMode === 'delete-brush') && e.originalEvent.button === 0) {
                if (this.currentTreeMode === 'brush') {
                    const brushShape = document.getElementById('brush-shape')?.value;
                    if (brushShape !== 'polygon') {
                        map.dragPan.disable();
                    }
                } else if (this.currentTreeMode === 'delete-brush') {
                    const deleteBrushShape = document.getElementById('delete-brush-shape')?.value;
                    if (deleteBrushShape !== 'polygon') {
                        map.dragPan.disable();
                    }
                }
            }
        });

        // Cursor changes for tree layers
        map.on('mouseenter', 'tree-trunks-layer', () => { 
            if (!this.currentTreeMode) map.getCanvas().style.cursor = 'pointer'; 
        });
        map.on('mouseleave', 'tree-trunks-layer', () => { 
            if (!this.currentTreeMode) map.getCanvas().style.cursor = ''; 
        });
        map.on('mouseenter', 'tree-canopies-layer', () => { 
            if (!this.currentTreeMode) map.getCanvas().style.cursor = 'pointer'; 
        });
        map.on('mouseleave', 'tree-canopies-layer', () => { 
            if (!this.currentTreeMode) map.getCanvas().style.cursor = ''; 
        });
    }

    /**
     * Setup map layers for trees (internal method)
     */
    setupMapLayersInternal() {
        const map = this.core.getMap();

        // Check if map is ready
        if (!map.isStyleLoaded()) {
            console.warn('Map style not loaded yet, retrying...');
            setTimeout(() => this.setupMapLayersInternal(), 100);
            return;
        }

        // Check if sources already exist to avoid duplicate errors
        if (!map.getSource('tree-trunks-source')) {
            map.addSource('tree-trunks-source', {
                type: 'geojson',
                data: this.data.getTreeTrunkData()
            });
        }
        
        if (!map.getSource('tree-canopies-source')) {
            map.addSource('tree-canopies-source', {
                type: 'geojson',
                data: this.data.getTreeCanopyData()
            });
        }
        
        // Create source for canopy centroids (for billboard LOD)
        // Delay to ensure function is available
        setTimeout(() => {
            if (this.updateCanopyCentroidsSource) {
                this.updateCanopyCentroidsSource(map);
            }
        }, 0);

        // LOD Level 1: Full 3D trees (trunk + canopy) - High zoom (zoom > 15)
        if (!map.getLayer('tree-trunks-layer')) {
            map.addLayer({
                'id': 'tree-trunks-layer',
                'type': 'fill-extrusion',
                'source': 'tree-trunks-source',
                'minzoom': 15,
                'maxzoom': 24,
                'layout': {
                    'visibility': this.treesVisible ? 'visible' : 'none'
                },
                'paint': {
                    'fill-extrusion-color': '#8B4513', // Brown
                    'fill-extrusion-height': ['get', 'height'],
                    'fill-extrusion-base': ['get', 'base'],
                    'fill-extrusion-opacity': [
                        'interpolate',
                        ['linear'],
                        ['zoom'],
                        15, 0,
                        15.5, 1.0,
                        24, 1.0
                    ]
                }
            });
        }

        if (!map.getLayer('tree-canopies-layer')) {
            map.addLayer({
                'id': 'tree-canopies-layer',
                'type': 'fill-extrusion',
                'source': 'tree-canopies-source',
                'minzoom': 15,
                'maxzoom': 24,
                'layout': {
                    'visibility': this.treesVisible ? 'visible' : 'none'
                },
                'paint': {
                    'fill-extrusion-color': '#008000', // Green
                    'fill-extrusion-height': ['+', ['get', 'base'], ['get', 'height']],
                    'fill-extrusion-base': ['get', 'base'],
                    'fill-extrusion-opacity': [
                        'interpolate',
                        ['linear'],
                        ['zoom'],
                        15, 0,
                        15.5, 1.0,
                        24, 1.0
                    ]
                }
            });
        }

        
        // LOD Level 2: Billboard canopies (face to camera) - Medium zoom (12-15)
        // Create canvas image for tree icon
        this.createTreeIcon(map);
        
        // Only add billboard layer if source exists
        if (!map.getLayer('tree-canopies-billboard-layer')) {
            // Create source for billboard if it doesn't exist
            if (!map.getSource('tree-canopies-billboard-source')) {
                this.updateCanopyCentroidsSource(map);
            }
            
            // Wait a bit for source to be ready
            setTimeout(() => {
                if (map.getSource('tree-canopies-billboard-source') && !map.getLayer('tree-canopies-billboard-layer')) {
                    try {
                        map.addLayer({
                            'id': 'tree-canopies-billboard-layer',
                            'type': 'symbol',
                            'source': 'tree-canopies-billboard-source',
                            'minzoom': 12,
                            'maxzoom': 15,
                            'layout': {
                                'visibility': this.treesVisible ? 'visible' : 'none',
                                'icon-image': 'tree-icon',
                                'icon-size': [
                                    'interpolate',
                                    ['linear'],
                                    ['zoom'],
                                    12, 0.3,
                                    15, 0.8
                                ],
                                'icon-allow-overlap': true,
                                'icon-ignore-placement': true
                            },
                            'paint': {
                                'icon-opacity': [
                                    'interpolate',
                                    ['linear'],
                                    ['zoom'],
                                    12, 0,
                                    12.5, 0.8,
                                    14.5, 0.8,
                                    15, 0
                                ]
                            }
                        });
                    } catch (error) {
                        console.warn('Could not add billboard layer:', error);
                    }
                }
            }, 100);
        }
        
        // Mark layers as setup
        this.layersSetup = true;
        
        // Update tree rendering when map moves (for viewport-based rendering)
        map.on('moveend', () => {
            if (this.data && this.data.treeTrunkData && this.data.treeTrunkData.features.length > 50000) {
                this.data.updateTreeSources(map);
            }
            // Update billboard source when map moves
            if (this.updateCanopyCentroidsSource) {
                this.updateCanopyCentroidsSource(map);
            }
        });
        
        map.on('zoomend', () => {
            if (this.data && this.data.treeTrunkData && this.data.treeTrunkData.features.length > 50000) {
                this.data.updateTreeSources(map);
            }
            // Update billboard source when zoom changes
            if (this.updateCanopyCentroidsSource) {
                this.updateCanopyCentroidsSource(map);
            }
        });

        // Add source and layer for brush circle preview
        map.addSource('brush-circle-source', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] }
        });

        map.addLayer({
            'id': 'brush-circle-layer',
            'type': 'fill',
            'source': 'brush-circle-source',
            'paint': {
                'fill-color': '#3b82f6',
                'fill-opacity': 0.2
            }
        });

        map.addLayer({
            'id': 'brush-circle-outline-layer',
            'type': 'line',
            'source': 'brush-circle-source',
            'paint': {
                'line-color': '#3b82f6',
                'line-width': 2,
                'line-opacity': 0.6,
                'line-dasharray': [2, 2]
            }
        });

        this.layersSetup = true;
        console.log('✓ Tree layers setup complete');
    }

    /**
     * Get current tree mode
     * @returns {string|null} Current tree mode
     */
    getCurrentTreeMode() {
        return this.currentTreeMode;
    }

    /**
     * Reset tree mode
     */
    resetTreeMode() {
        this.setTreeMode(null);
    }

    /**
     * Delete all trees
     */
    deleteAllTrees() {
        // Reset tree data
        this.data.treeTrunkData = { type: 'FeatureCollection', features: [] };
        this.data.treeCanopyData = { type: 'FeatureCollection', features: [] };
        this.data.treeIdCounter = 0;

        // Update map sources
        const map = this.core.getMap();
        map.getSource('tree-trunks-source').setData(this.data.treeTrunkData);
        map.getSource('tree-canopies-source').setData(this.data.treeCanopyData);

        // Update tree counter
        this.updateTreeCounter();

        console.log('✓ All trees deleted');
    }

    /**
     * Update tree counter display
     */
    updateTreeCounter() {
        // Count unique tree IDs (not raw trunk features), since IDs are used to pair trunk/canopy.
        // This avoids confusing situations where duplicate IDs inflate the trunk feature count.
        const ids = new Set();
        for (const t of this.data.treeTrunkData.features) {
            const id = t?.properties?.id;
            if (id !== undefined && id !== null) ids.add(String(id));
        }
        const treeCount = ids.size;
        const counterElement = document.getElementById('tree-count');
        if (counterElement) {
            counterElement.textContent = treeCount;
            
            // Add visual feedback for loaded trees
            if (treeCount > 0) {
                counterElement.style.color = '#10b981';
                counterElement.style.fontWeight = '600';
            } else {
                counterElement.style.color = '#6b7280';
                counterElement.style.fontWeight = '500';
            }
        }
    }

    /**
     * Update brush shape preview at mouse position
     * @param {Object} lngLat - Longitude and latitude coordinates
     */
    updateBrushShape(lngLat) {
        if (this.currentTreeMode !== 'brush' || this.isDrawingPolygon) return;
        
        const map = this.core.getMap();
        if (!map.getSource('brush-circle-source')) return;
        
        const brushShape = document.getElementById('brush-shape').value;
        const brushSize = Number(document.getElementById('brush-radius').value);
        const centerPoint = turf.point([lngLat.lng, lngLat.lat]);
        
        let shapeFeature;
        
        if (brushShape === 'circle') {
            const circle = turf.circle(centerPoint, brushSize, { units: 'meters', steps: 64 });
            shapeFeature = {
                type: 'Feature',
                geometry: circle.geometry,
                properties: {}
            };
        } else if (brushShape === 'square') {
            // Create square: half size in each direction
            const halfSize = brushSize / 2;
            // Convert meters to degrees (approximate)
            const latOffset = halfSize / 111320; // 1 degree latitude ≈ 111320 meters
            const lngOffset = halfSize / (111320 * Math.cos(lngLat.lat * Math.PI / 180));
            
            const bbox = [
                lngLat.lng - lngOffset, // min longitude
                lngLat.lat - latOffset, // min latitude
                lngLat.lng + lngOffset, // max longitude
                lngLat.lat + latOffset  // max latitude
            ];
            const square = turf.bboxPolygon(bbox);
            shapeFeature = {
                type: 'Feature',
                geometry: square.geometry,
                properties: {}
            };
        } else {
            return; // Polygon is handled separately
        }
        
        this.brushShape = shapeFeature;
        
        map.getSource('brush-circle-source').setData({
            type: 'FeatureCollection',
            features: [this.brushShape]
        });
    }

    /**
     * Clear brush shape preview
     */
    clearBrushShape() {
        const map = this.core.getMap();
        if (map.getSource('brush-circle-source')) {
            map.getSource('brush-circle-source').setData({
                type: 'FeatureCollection',
                features: []
            });
        }
        this.brushShape = null;
    }

    /**
     * Update brush shape UI based on selected shape
     */
    updateBrushShapeUI() {
        const brushShape = document.getElementById('brush-shape').value;
        const brushSizeRow = document.getElementById('brush-size-row');
        const brushSizeGroup = document.getElementById('brush-size-group');
        const brushCountGroup = document.getElementById('brush-count-group');
        const polygonControls = document.getElementById('polygon-controls');
        const brushSizeLabel = document.getElementById('brush-size-label');
        
        if (brushShape === 'polygon') {
            // Hide only size parameter, keep Tree Count visible
            if (brushSizeGroup) brushSizeGroup.style.display = 'none';
            if (brushCountGroup) brushCountGroup.style.display = 'block';
            if (brushSizeRow) brushSizeRow.style.display = 'flex';
            if (polygonControls) polygonControls.style.display = 'block';
        } else {
            // Show both size and count parameters
            if (brushSizeGroup) brushSizeGroup.style.display = 'block';
            if (brushCountGroup) brushCountGroup.style.display = 'block';
            if (brushSizeRow) brushSizeRow.style.display = 'flex';
            if (polygonControls) polygonControls.style.display = 'none';
            
            // Update label text immediately
            if (brushSizeLabel) {
                if (brushShape === 'circle') {
                    brushSizeLabel.textContent = 'Radius (m)';
                } else if (brushShape === 'square') {
                    brushSizeLabel.textContent = 'Side Length (m)';
                }
            }
            
            this.cancelPolygon();
        }
    }

    /**
     * Start drawing custom polygon
     * @param {Object} lngLat - Initial point coordinates
     */
    startDrawingPolygon(lngLat) {
        this.isDrawingPolygon = true;
        this.polygonPoints = [[lngLat.lng, lngLat.lat]];
        this.updatePolygonPreview();
        
        const map = this.core.getMap();
        map.getCanvas().style.cursor = 'crosshair';
    }

    /**
     * Update polygon preview
     * @param {Object} currentLngLat - Current mouse position (optional)
     */
    updatePolygonPreview(currentLngLat = null) {
        if (this.polygonPoints.length < 2) return;
        
        const map = this.core.getMap();
        if (!map.getSource('brush-circle-source')) return;
        
        let points = [...this.polygonPoints];
        if (currentLngLat) {
            points.push([currentLngLat.lng, currentLngLat.lat]);
        }
        
        // Close polygon if we have at least 3 points
        if (points.length >= 3) {
            points.push(points[0]); // Close the polygon
        }
        
        const polygon = turf.polygon([points]);
        
        this.brushShape = {
            type: 'Feature',
            geometry: polygon.geometry,
            properties: {}
        };
        
        map.getSource('brush-circle-source').setData({
            type: 'FeatureCollection',
            features: [this.brushShape]
        });
    }

    /**
     * Finish polygon and place trees
     */
    finishPolygon() {
        if (this.polygonPoints.length < 3) {
            alert('Polygon needs at least 3 points');
            return;
        }
        
        // Close the polygon
        const closedPoints = [...this.polygonPoints, this.polygonPoints[0]];
        const polygon = turf.polygon([closedPoints]);
        
        const brushCount = Number(document.getElementById('brush-count').value);
        
        // Handle async placement for large counts
        const result = this.data.placeTreesInPolygon(polygon, brushCount);
        if (result instanceof Promise) {
            result.then(() => {
                // Update tree counter after async completion
                if (window.app && window.app.tree) {
                    window.app.tree.updateTreeCounter();
                }
            });
        }
        
        // Reset polygon drawing
        this.cancelPolygon();
    }

    /**
     * Cancel polygon drawing
     */
    cancelPolygon() {
        this.isDrawingPolygon = false;
        this.polygonPoints = [];
        this.clearBrushShape();
        
        const map = this.core.getMap();
        if (map) {
            map.getCanvas().style.cursor = '';
        }
    }

    /**
     * Update delete brush shape UI based on selected shape
     */
    updateDeleteBrushShapeUI() {
        const deleteBrushShape = document.getElementById('delete-brush-shape').value;
        const deleteBrushSizeRow = document.getElementById('delete-brush-size-row');
        const deleteBrushSizeGroup = document.getElementById('delete-brush-size-group');
        const deletePolygonControls = document.getElementById('delete-polygon-controls');
        const deleteBrushSizeLabel = document.getElementById('delete-brush-size-label');
        
        if (deleteBrushShape === 'polygon') {
            if (deleteBrushSizeRow) deleteBrushSizeRow.style.display = 'none';
            if (deletePolygonControls) deletePolygonControls.style.display = 'block';
        } else {
            if (deleteBrushSizeRow) deleteBrushSizeRow.style.display = 'flex';
            if (deletePolygonControls) deletePolygonControls.style.display = 'none';
            
            // Update label text immediately
            if (deleteBrushSizeLabel) {
                if (deleteBrushShape === 'circle') {
                    deleteBrushSizeLabel.textContent = 'Radius (m)';
                } else if (deleteBrushShape === 'square') {
                    deleteBrushSizeLabel.textContent = 'Side Length (m)';
                }
            }
            
            this.cancelDeletePolygon();
        }
    }

    /**
     * Update delete brush shape preview at mouse position
     * @param {Object} lngLat - Longitude and latitude coordinates
     */
    updateDeleteBrushShape(lngLat) {
        if (this.currentTreeMode !== 'delete-brush' || this.isDrawingDeletePolygon) return;
        
        const map = this.core.getMap();
        if (!map.getSource('brush-circle-source')) return;
        
        const deleteBrushShape = document.getElementById('delete-brush-shape').value;
        const deleteBrushSize = Number(document.getElementById('delete-brush-radius').value);
        const centerPoint = turf.point([lngLat.lng, lngLat.lat]);
        
        let shapeFeature;
        
        if (deleteBrushShape === 'circle') {
            const circle = turf.circle(centerPoint, deleteBrushSize, { units: 'meters', steps: 64 });
            shapeFeature = {
                type: 'Feature',
                geometry: circle.geometry,
                properties: {}
            };
        } else if (deleteBrushShape === 'square') {
            const halfSize = deleteBrushSize / 2;
            const latOffset = halfSize / 111320;
            const lngOffset = halfSize / (111320 * Math.cos(lngLat.lat * Math.PI / 180));
            
            const bbox = [
                lngLat.lng - lngOffset,
                lngLat.lat - latOffset,
                lngLat.lng + lngOffset,
                lngLat.lat + latOffset
            ];
            const square = turf.bboxPolygon(bbox);
            shapeFeature = {
                type: 'Feature',
                geometry: square.geometry,
                properties: {}
            };
        } else {
            return;
        }
        
        this.brushShape = shapeFeature;
        
        map.getSource('brush-circle-source').setData({
            type: 'FeatureCollection',
            features: [this.brushShape]
        });
    }

    /**
     * Start drawing delete polygon
     * @param {Object} lngLat - Initial point coordinates
     */
    startDrawingDeletePolygon(lngLat) {
        this.isDrawingDeletePolygon = true;
        this.deletePolygonPoints = [[lngLat.lng, lngLat.lat]];
        this.updateDeletePolygonPreview();
        
        const map = this.core.getMap();
        map.getCanvas().style.cursor = 'crosshair';
    }

    /**
     * Update delete polygon preview
     * @param {Object} currentLngLat - Current mouse position (optional)
     */
    updateDeletePolygonPreview(currentLngLat = null) {
        if (this.deletePolygonPoints.length < 2) return;
        
        const map = this.core.getMap();
        if (!map.getSource('brush-circle-source')) return;
        
        let points = [...this.deletePolygonPoints];
        if (currentLngLat) {
            points.push([currentLngLat.lng, currentLngLat.lat]);
        }
        
        if (points.length >= 3) {
            points.push(points[0]);
        }
        
        const polygon = turf.polygon([points]);
        
        this.brushShape = {
            type: 'Feature',
            geometry: polygon.geometry,
            properties: {}
        };
        
        map.getSource('brush-circle-source').setData({
            type: 'FeatureCollection',
            features: [this.brushShape]
        });
    }

    /**
     * Finish delete polygon and delete trees
     */
    finishDeletePolygon() {
        if (this.deletePolygonPoints.length < 3) {
            alert('Polygon needs at least 3 points');
            return;
        }
        
        const closedPoints = [...this.deletePolygonPoints, this.deletePolygonPoints[0]];
        const polygon = turf.polygon([closedPoints]);
        
        this.data.deleteTreesInPolygon(polygon);
        
        this.cancelDeletePolygon();
    }

    /**
     * Cancel delete polygon drawing
     */
    cancelDeletePolygon() {
        this.isDrawingDeletePolygon = false;
        this.deletePolygonPoints = [];
        this.clearBrushShape();
        
        const map = this.core.getMap();
        if (map) {
            map.getCanvas().style.cursor = '';
        }
    }

    /**
     * Create tree icon for billboard LOD
     * @param {Object} map - Mapbox map instance
     */
    createTreeIcon(map) {
        if (!map) return;
        
        // Check if icon already exists
        if (map.hasImage('tree-icon')) {
            return;
        }
        
        try {
            // Create canvas for tree icon (green circle)
            const size = 64;
            const canvas = document.createElement('canvas');
            canvas.width = size;
            canvas.height = size;
            const ctx = canvas.getContext('2d');
            
            // Draw green circle with gradient
            const gradient = ctx.createRadialGradient(size/2, size/2, 0, size/2, size/2, size/2);
            gradient.addColorStop(0, '#00cc00');
            gradient.addColorStop(0.7, '#008000');
            gradient.addColorStop(1, '#004d00');
            
            ctx.fillStyle = gradient;
            ctx.beginPath();
            ctx.arc(size/2, size/2, size/2 - 2, 0, Math.PI * 2);
            ctx.fill();
            
            // Add to map as image
            map.loadImage(canvas.toDataURL(), (error, image) => {
                if (error) {
                    console.warn('Error loading tree icon:', error);
                    return;
                }
                if (!map.hasImage('tree-icon')) {
                    map.addImage('tree-icon', image);
                }
            });
        } catch (error) {
            console.warn('Error creating tree icon:', error);
        }
    }

    /**
     * Update canopy centroids source for billboard LOD
     * Optimized for large datasets with viewport-based filtering and sampling
     * @param {Object} map - Mapbox map instance
     */
    updateCanopyCentroidsSource(map) {
        if (!map || !this.data) return;
        
        try {
            const canopies = this.data.getTreeCanopyData().features;
            const totalCanopies = canopies.length;
            const MAX_BILLBOARD_TREES = 10000; // Maximum billboards to render
            
            let centroids;
            
            // For very large datasets, use viewport-based filtering and sampling
            if (totalCanopies > MAX_BILLBOARD_TREES) {
                try {
                    // Get current viewport bounds
                    const bounds = map.getBounds();
                    const bbox = [
                        bounds.getWest(),
                        bounds.getSouth(),
                        bounds.getEast(),
                        bounds.getNorth()
                    ];
                    
                    const viewportPolygon = turf.bboxPolygon(bbox);
                    const expandedBbox = turf.bbox(turf.buffer(viewportPolygon, 0.02, { units: 'degrees' }));
                    const expandedPolygon = turf.bboxPolygon(expandedBbox);
                    
                    // Sample rate based on total count
                    const sampleRate = Math.ceil(totalCanopies / MAX_BILLBOARD_TREES);
                    const visibleCentroids = [];
                    let processed = 0;
                    
                    // Process in chunks to prevent blocking
                    for (let i = 0; i < canopies.length && visibleCentroids.length < MAX_BILLBOARD_TREES; i += sampleRate) {
                        const canopy = canopies[i];
                        try {
                            // Quick bbox check before centroid calculation
                            const canopyBbox = turf.bbox(canopy);
                            const canopyCenter = [
                                (canopyBbox[0] + canopyBbox[2]) / 2,
                                (canopyBbox[1] + canopyBbox[3]) / 2
                            ];
                            
                            // Check if center is in expanded viewport
                            if (canopyCenter[0] >= expandedBbox[0] && canopyCenter[0] <= expandedBbox[2] &&
                                canopyCenter[1] >= expandedBbox[1] && canopyCenter[1] <= expandedBbox[3]) {
                                
                                const center = turf.centroid(canopy);
                                visibleCentroids.push({
                                    type: 'Feature',
                                    geometry: center.geometry,
                                    properties: {
                                        id: canopy.properties.id,
                                        height: canopy.properties.height,
                                        base: canopy.properties.base
                                    }
                                });
                            }
                        } catch (error) {
                            // Skip this canopy if error
                            continue;
                        }
                        
                        processed++;
                        
                        // For very large datasets, process in smaller batches
                        // Note: We can't use await in non-async function, so we'll process all at once
                        // but limit the total number processed
                        if (visibleCentroids.length >= MAX_BILLBOARD_TREES) {
                            break;
                        }
                    }
                    
                    centroids = visibleCentroids;
                    console.log(`Billboard LOD: ${centroids.length} of ${totalCanopies} trees (viewport-based)`);
                } catch (error) {
                    console.warn('Error in viewport filtering for billboards, using simple sampling:', error);
                    // Fallback: simple sampling
                    const sampleRate = Math.ceil(totalCanopies / MAX_BILLBOARD_TREES);
                    centroids = canopies
                        .filter((_, i) => i % sampleRate === 0)
                        .slice(0, MAX_BILLBOARD_TREES)
                        .map(canopy => {
                            try {
                                const center = turf.centroid(canopy);
                                return {
                                    type: 'Feature',
                                    geometry: center.geometry,
                                    properties: {
                                        id: canopy.properties.id,
                                        height: canopy.properties.height,
                                        base: canopy.properties.base
                                    }
                                };
                            } catch (error) {
                                return null;
                            }
                        })
                        .filter(c => c !== null);
                }
            } else {
                // For smaller datasets, process all canopies
                centroids = canopies.map(canopy => {
                    try {
                        const center = turf.centroid(canopy);
                        return {
                            type: 'Feature',
                            geometry: center.geometry,
                            properties: {
                                id: canopy.properties.id,
                                height: canopy.properties.height,
                                base: canopy.properties.base
                            }
                        };
                    } catch (error) {
                        return null;
                    }
                }).filter(c => c !== null);
            }
            
            const sourceId = 'tree-canopies-billboard-source';
            if (map.getSource(sourceId)) {
                map.getSource(sourceId).setData({
                    type: 'FeatureCollection',
                    features: centroids
                });
            } else {
                map.addSource(sourceId, {
                    type: 'geojson',
                    data: {
                        type: 'FeatureCollection',
                        features: centroids
                    }
                });
            }
        } catch (error) {
            console.warn('Error updating canopy centroids source:', error);
            // Create empty source to prevent errors
            const sourceId = 'tree-canopies-billboard-source';
            if (!map.getSource(sourceId)) {
                map.addSource(sourceId, {
                    type: 'geojson',
                    data: {
                        type: 'FeatureCollection',
                        features: []
                    }
                });
            }
        }
    }

    /**
     * Toggle trees visibility on/off
     */
    toggleTreesVisibility() {
        const map = this.core.getMap();
        if (!map || !map.isStyleLoaded()) {
            console.warn('Map not ready, cannot toggle tree visibility');
            return;
        }

        // Toggle visibility state
        this.treesVisible = !this.treesVisible;
        const visibility = this.treesVisible ? 'visible' : 'none';

        // Update all tree layers visibility
        const treeLayers = [
            'tree-trunks-layer',
            'tree-canopies-layer',
            'tree-canopies-billboard-layer'
        ];

        let layersUpdated = 0;
        treeLayers.forEach(layerId => {
            if (map.getLayer(layerId)) {
                try {
                    map.setLayoutProperty(layerId, 'visibility', visibility);
                    layersUpdated++;
                } catch (error) {
                    console.warn(`Could not set visibility for layer ${layerId}:`, error);
                }
            }
        });

        // Only update button if at least one layer was updated
        if (layersUpdated > 0) {
            // Update button text
            const toggleButton = document.getElementById('tree-visibility-toggle');
            if (toggleButton) {
                const buttonSpan = toggleButton.querySelector('span');
                if (buttonSpan) {
                    if (this.treesVisible) {
                        buttonSpan.textContent = '👁️ Show Trees';
                        toggleButton.classList.remove('secondary');
                    } else {
                        buttonSpan.textContent = '🚫 Hide Trees';
                        toggleButton.classList.add('secondary');
                    }
                }
            }
            console.log(`Trees visibility: ${visibility} (${layersUpdated} layers updated)`);
        } else {
            // Revert state if no layers were found
            this.treesVisible = !this.treesVisible;
            console.warn('No tree layers found to toggle visibility');
        }
    }
}

// Export for use in other modules
window.TreeModule = TreeModule;
