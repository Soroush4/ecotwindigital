/**
 * Data Module - GeoJSON data management and building data handling
 * Handles data loading, processing, and management for buildings and trees
 */

class DataModule {
    constructor(coreModule) {
        this.core = coreModule;
        this.buildingData = { type: 'FeatureCollection', features: [] };
        this.treeTrunkData = { type: 'FeatureCollection', features: [] };
        this.treeCanopyData = { type: 'FeatureCollection', features: [] };
        this.roadData = { type: 'FeatureCollection', features: [] }; // LineString features (roads)
        this.treeIdCounter = 0;
        this.energyStats = { min: 0, max: 100, hasEnergyData: false };
        this.energyStatsModule = null;
        this.selectedEnergyColumn = 'Energy_UrbanWWR_kWh'; // Default energy column
        this.selectedColorScale = 'energy'; // Default color scale
        this.heightUnit = 'meters'; // feet | meters (default: meters)
        this.heightMultiplier = 1; // meters → meters (no conversion needed)
        this.defaultHeightFeet = 10;
        this.defaultHeightMeters = 10;
    }

    /**
     * Ensure new tree IDs won't collide with loaded data.
     * Many parts of the app assume `properties.id` is a stable tree identifier used to pair trunk/canopy.
     * If we load a file that already contains `tree-<n>` IDs but keep `treeIdCounter` at 0,
     * newly created trees will reuse existing IDs and "tree count" by unique ID will appear capped.
     */
    syncTreeIdCounterFromLoadedData() {
        let maxNumericId = -1;

        const scan = (features) => {
            for (const f of features) {
                const id = f?.properties?.id;
                if (typeof id !== 'string') continue;
                const m = /^tree-(\d+)$/.exec(id);
                if (!m) continue;
                const n = Number(m[1]);
                if (Number.isFinite(n)) maxNumericId = Math.max(maxNumericId, n);
            }
        };

        scan(this.treeTrunkData.features);
        scan(this.treeCanopyData.features);

        if (maxNumericId >= 0) {
            const next = maxNumericId + 1;
            if (this.treeIdCounter < next) {
                console.log(`Syncing treeIdCounter from ${this.treeIdCounter} to ${next} (loaded max id: tree-${maxNumericId})`);
                this.treeIdCounter = next;
            }
        }
    }

    /**
     * Set energy statistics module reference
     * @param {EnergyStatsModule} energyStatsModule - Energy statistics module instance
     */
    setEnergyStatsModule(energyStatsModule) {
        this.energyStatsModule = energyStatsModule;
    }

    /**
     * Set height unit and update map extrusion
     * @param {'feet'|'meters'} unit
     */
    setHeightUnit(unit) {
        this.heightUnit = unit === 'meters' ? 'meters' : 'feet';
        this.heightMultiplier = this.heightUnit === 'meters' ? 1 : 0.3048;
        this.updateBuildingHeightPaint();
    }

    getHeightUnit() {
        return this.heightUnit;
    }

    /**
     * Build fill-extrusion height expression based on selected unit
     * @returns {Array} Mapbox expression
     */
    getFillExtrusionHeightExpression() {
        const multiplier = this.heightMultiplier;
        const defaultHeight = this.heightUnit === 'meters'
            ? this.defaultHeightMeters
            : this.defaultHeightFeet * multiplier;

        return [
            'case',
            ['has', 'Height'], ['*', ['get', 'Height'], multiplier],
            ['has', 'height'], ['*', ['get', 'height'], multiplier],
            ['has', 'HEIGHT'], ['*', ['get', 'HEIGHT'], multiplier],
            ['has', 'building_height'], ['*', ['get', 'building_height'], multiplier],
            ['has', 'buildingHeight'], ['*', ['get', 'buildingHeight'], multiplier],
            ['has', 'elevation'], ['*', ['get', 'elevation'], multiplier],
            ['has', 'Elevation'], ['*', ['get', 'Elevation'], multiplier],
            ['has', 'ELEVATION'], ['*', ['get', 'ELEVATION'], multiplier],
            defaultHeight // Default height in meters
        ];
    }

    /**
     * Update extrusion height paint property to respect selected unit
     */
    updateBuildingHeightPaint() {
        const map = this.core.getMap();
        const layer = map.getLayer('geojson-layer');
        if (!layer) return;

        map.setPaintProperty('geojson-layer', 'fill-extrusion-height', this.getFillExtrusionHeightExpression());
    }

    /**
     * Add GeoJSON data to the map
     * @param {Object} data - GeoJSON data object
     */
    addGeoJsonToMap(data) {
        const map = this.core.getMap();
        const center = turf.center(data).geometry.coordinates;
        map.flyTo({ center, zoom: 16 });

        // Clear existing data
        this.buildingData.features = [];
        this.treeTrunkData.features = [];
        this.treeCanopyData.features = [];
        this.roadData.features = [];

        // Separate features into buildings and trees
        // Logic: 
        // - If feature has isCanopy property → Tree canopy
        // - If feature has isTrunk property → Tree trunk
        // - Otherwise (Polygon without isCanopy/isTrunk) → Building
        console.log('=== Processing GeoJSON features ===');
        console.log('Total features in file:', data.features.length);
        
        let buildingCount = 0;
        let treeTrunkCount = 0;
        let treeCanopyCount = 0;
        let pointCount = 0;
        let roadCount = 0;
        let otherCount = 0;
        
        for (let i = 0; i < data.features.length; i++) {
            const feature = data.features[i];
            
            if (feature.geometry.type === 'Polygon' || feature.geometry.type === 'MultiPolygon') {
                if (feature.properties.isCanopy) {
                    this.treeCanopyData.features.push(feature);
                    treeCanopyCount++;
                    if (i < 5) console.log(`Feature ${i}: Tree canopy (isCanopy=true)`);
                } else if (feature.properties.isTrunk) {
                    this.treeTrunkData.features.push(feature);
                    treeTrunkCount++;
                    if (i < 5) console.log(`Feature ${i}: Tree trunk (isTrunk=true)`);
                } else {
                    // This is a building (Polygon without isCanopy/isTrunk properties)
                    this.buildingData.features.push(feature);
                    buildingCount++;
                    if (i < 5) {
                        console.log(`Feature ${i}: Building detected`);
                        console.log(`  - Properties:`, Object.keys(feature.properties));
                        console.log(`  - Has isCanopy:`, feature.properties.isCanopy);
                        console.log(`  - Has isTrunk:`, feature.properties.isTrunk);
                    }
                }
            } else if (feature.geometry.type === 'LineString' || feature.geometry.type === 'MultiLineString') {
                // Roads/streets - convert LineString to Polygon for fill-extrusion rendering
                try {
                    // Buffer the LineString to create a polygon (road width)
                    // Road width varies by zoom level, but we'll use a fixed width for simplicity
                    // Typical road width: 3-5 meters for residential, 5-10 meters for main roads
                    const roadWidth = 3; // meters - will be adjusted by zoom level in paint properties
                    const buffered = turf.buffer(feature, roadWidth, { units: 'meters' });
                    
                    // Create a new feature with Polygon geometry
                    const roadPolygon = {
                        type: 'Feature',
                        geometry: buffered.geometry,
                        properties: {
                            ...feature.properties,
                            originalType: feature.geometry.type // Keep track of original type
                        }
                    };
                    
                    this.roadData.features.push(roadPolygon);
                    roadCount++;
                    if (i < 5) {
                        console.log(`Feature ${i}: Road/LineString detected and converted to Polygon`);
                        console.log(`  - Highway type:`, feature.properties.highway);
                        console.log(`  - Name:`, feature.properties.name);
                    }
                } catch (error) {
                    console.warn(`Failed to buffer road feature ${i}:`, error);
                    // Fallback: add original feature (will need line layer)
                    this.roadData.features.push(feature);
                    roadCount++;
                }
            } else if (feature.geometry.type === 'Point') {
                // Legacy support for old tree format (convert to new format)
                this.placeTree(feature.geometry.coordinates, feature.properties.height);
                pointCount++;
                if (i < 5) console.log(`Feature ${i}: Point (legacy tree)`);
            } else {
                otherCount++;
                if (i < 5) console.log(`Feature ${i}: Other type (${feature.geometry.type})`);
            }
        }
        
        console.log('=== Feature Classification Summary ===');
        console.log(`Buildings: ${buildingCount}`);
        console.log(`Tree Trunks: ${treeTrunkCount}`);
        console.log(`Tree Canopies: ${treeCanopyCount}`);
        console.log(`Roads (LineString): ${roadCount}`);
        console.log(`Points (legacy trees): ${pointCount}`);
        console.log(`Other types: ${otherCount}`);
        console.log(`Total processed: ${buildingCount + treeTrunkCount + treeCanopyCount + roadCount + pointCount + otherCount}`);

        // Calculate energy statistics for buildings (will be empty)
        this.energyStats = UtilsModule.calculateEnergyStats(this.buildingData.features, this.selectedEnergyColumn);

        // Update the sources
        console.log('=== Updating Map Sources ===');
        console.log('Building data to set:', {
            type: this.buildingData.type,
            featureCount: this.buildingData.features.length
        });
        
        const buildingSource = map.getSource('geojson-data');
        if (buildingSource) {
            console.log('✓ geojson-data source exists');
            console.log('Current source data:', {
                type: buildingSource._data?.type,
                featureCount: buildingSource._data?.features?.length || 0
            });
            
            buildingSource.setData(this.buildingData);
            
            console.log('Source data after setData:', {
                type: buildingSource._data?.type,
                featureCount: buildingSource._data?.features?.length || 0
            });
        } else {
            console.error('❌ geojson-data source not found!');
        }
        
        // Apply current height unit to extrusion
        this.updateBuildingHeightPaint();
        
        // Update road source
        this.updateRoadSource(map);
        
        this.updateTreeSources(map);

        // Update the building layer with new color scheme
        console.log('=== Updating Building Layer ===');
        const buildingLayer = map.getLayer('geojson-layer');
        if (buildingLayer) {
            console.log('✓ geojson-layer found');
            console.log('Layer source:', buildingLayer.source);
        } else {
            console.warn('⚠ geojson-layer not found');
        }
        
        this.updateBuildingColors();
        console.log('✓ Building colors updated');

        // Update tree counter if tree module is available
        if (window.app && window.app.tree) {
            window.app.tree.updateTreeCounter();
        }

        // Update building counter
        this.updateBuildingCounter();

        // Log loading information
        const loadedBuildingsCount = this.buildingData.features.length;
        const loadedTreesCount = this.treeTrunkData.features.length;
        const loadedCanopiesCount = this.treeCanopyData.features.length;
        const loadedRoadsCount = this.roadData.features.length;
        
        console.log(`✓ GeoJSON loaded: ${loadedBuildingsCount} buildings, ${loadedTreesCount} trees, ${loadedRoadsCount} roads`);
        console.log(`  - Buildings: Polygon features without isCanopy/isTrunk properties`);
        console.log(`  - Trees: Features with isCanopy or isTrunk properties`);
        console.log(`  - Roads: LineString features`);
        
        if (loadedTreesCount > 0) {
            console.log(`✓ Tree data: ${loadedTreesCount} trunks, ${loadedCanopiesCount} canopies`);
        }

        // Prevent ID collisions when adding more trees after loading a file
        this.syncTreeIdCounterFromLoadedData();
        
        if (loadedRoadsCount > 0) {
            console.log(`✓ Road data: ${loadedRoadsCount} road segments loaded`);
        }

        // Notify energy statistics module
        if (this.energyStatsModule) {
            this.energyStatsModule.updateStats();
        }
    }

    /**
     * Update building colors based on energy statistics
     */
    updateBuildingColors() {
        const map = this.core.getMap();
        const layer = map.getLayer('geojson-layer');
        
        if (!layer) {
            console.warn('updateBuildingColors: geojson-layer not found');
            return;
        }
        
        console.log('updateBuildingColors: Layer found, updating colors...');
        console.log('Current building count:', this.buildingData.features.length);

        if (this.energyStats.hasEnergyData) {
            // Use dynamic color scheme based on actual data range
            const minEnergy = this.energyStats.min;
            const maxEnergy = this.energyStats.max;
            const energyRange = maxEnergy - minEnergy;
            
            // Create more granular color stops for better visualization
            const colorStops = this.createColorStops(minEnergy, maxEnergy, energyRange);
            
            console.log(`Color range: ${minEnergy.toFixed(2)} to ${maxEnergy.toFixed(2)} (Range: ${energyRange.toFixed(2)})`);
            console.log('Color stops:', colorStops);

            map.setPaintProperty('geojson-layer', 'fill-extrusion-color', [
                'interpolate', ['linear'], ['get', this.selectedEnergyColumn],
                ...colorStops
            ]);
        } else {
            // Use default color scheme when no energy data is available
            map.setPaintProperty('geojson-layer', 'fill-extrusion-color', '#808080'); // Gray
        }
    }

    /**
     * Create color stops for energy visualization
     * @param {number} minEnergy - Minimum energy value
     * @param {number} maxEnergy - Maximum energy value
     * @param {number} energyRange - Energy range (max - min)
     * @returns {Array} Array of color stops for Mapbox
     */
    createColorStops(minEnergy, maxEnergy, energyRange) {
        const colorStops = [];
        const colors = this.getColorScheme(this.selectedColorScale);
        
        try {
            // Analyze building distribution to find the densest range
            const distribution = this.analyzeBuildingDistribution(minEnergy, maxEnergy);
            
            console.log(`Building distribution analysis:`, distribution);
            
        // Create color stops based on building density
        for (let i = 0; i < colors.length; i++) {
            let energyValue;
            if (i < 6) {
                // First 6 levels: distribute across the densest range
                const denseRange = distribution.denseEnd - distribution.denseStart;
                if (denseRange > 0) {
                    energyValue = distribution.denseStart + (denseRange * i / 5);
                } else {
                    // Fallback to uniform distribution if dense range is zero
                    energyValue = minEnergy + (energyRange * i / 5);
                }
            } else {
                // Last level: covers the sparse range (ensure it's different from previous)
                const denseEnd = distribution.denseEnd > distribution.denseStart ? distribution.denseEnd : maxEnergy;
                energyValue = Math.max(denseEnd + (energyRange * 0.01), maxEnergy); // Add small offset to ensure ascending order
            }
            colorStops.push(energyValue, colors[i]);
        }
        } catch (error) {
            console.warn('Error in distribution analysis, using uniform distribution:', error);
            // Fallback to uniform distribution
            for (let i = 0; i < colors.length; i++) {
                const energyValue = minEnergy + (energyRange * i / (colors.length - 1));
                colorStops.push(energyValue, colors[i]);
            }
        }
        
        // Ensure ascending order for Mapbox interpolate expression
        const sortedColorStops = this.ensureAscendingOrder(colorStops);
        
        return sortedColorStops;
    }

    /**
     * Ensure color stops are in ascending order for Mapbox interpolate expression
     * @param {Array} colorStops - Array of color stops
     * @returns {Array} Sorted color stops
     */
    ensureAscendingOrder(colorStops) {
        const pairs = [];
        
        // Group into value-color pairs
        for (let i = 0; i < colorStops.length; i += 2) {
            pairs.push({
                value: colorStops[i],
                color: colorStops[i + 1]
            });
        }
        
        // Sort by value
        pairs.sort((a, b) => a.value - b.value);
        
        // Remove duplicates and ensure minimum difference
        const uniquePairs = [];
        let lastValue = -Infinity;
        
        for (const pair of pairs) {
            if (pair.value > lastValue) {
                uniquePairs.push(pair);
                lastValue = pair.value;
            } else {
                // Add small increment to ensure ascending order
                const adjustedValue = lastValue + 0.001;
                uniquePairs.push({
                    value: adjustedValue,
                    color: pair.color
                });
                lastValue = adjustedValue;
            }
        }
        
        // Flatten back to array
        const result = [];
        for (const pair of uniquePairs) {
            result.push(pair.value, pair.color);
        }
        
        return result;
    }

    /**
     * Analyze building distribution to find the densest energy range
     * @param {number} minEnergy - Minimum energy value
     * @param {number} maxEnergy - Maximum energy value
     * @returns {Object} Distribution analysis result
     */
    analyzeBuildingDistribution(minEnergy, maxEnergy) {
        const buildingData = this.buildingData.features;
        const energyValues = buildingData
            .map(feature => parseFloat(feature.properties[this.selectedEnergyColumn]))
            .filter(energy => !isNaN(energy))
            .sort((a, b) => a - b);
        
        if (energyValues.length === 0) {
            return {
                denseStart: minEnergy,
                denseEnd: maxEnergy,
                denseCount: 0,
                sparseCount: 0,
                totalCount: 0
            };
        }
        
        const energyRange = maxEnergy - minEnergy;
        const numBins = 20; // Divide range into 20 bins
        const binSize = energyRange / numBins;
        const bins = new Array(numBins).fill(0);
        
        // Count buildings in each bin
        energyValues.forEach(energy => {
            const binIndex = Math.min(Math.floor((energy - minEnergy) / binSize), numBins - 1);
            bins[binIndex]++;
        });
        
        // Find the range with maximum density
        let maxDensity = 0;
        let maxDensityStart = minEnergy;
        let maxDensityEnd = maxEnergy;
        
        // Check different range sizes (10%, 20%, 30%, 40%, 50% of total range)
        const rangeSizes = [0.1, 0.2, 0.3, 0.4, 0.5];
        
        rangeSizes.forEach(rangeSize => {
            const rangeBinCount = Math.max(1, Math.floor(numBins * rangeSize));
            
            for (let start = 0; start <= numBins - rangeBinCount; start++) {
                const end = start + rangeBinCount;
                const rangeCount = bins.slice(start, end).reduce((sum, count) => sum + count, 0);
                const density = rangeCount / rangeBinCount; // Average density per bin
                
                if (density > maxDensity) {
                    maxDensity = density;
                    maxDensityStart = minEnergy + (start * binSize);
                    maxDensityEnd = minEnergy + (end * binSize);
                }
            }
        });
        
        // Ensure we have a valid range
        if (maxDensityStart >= maxDensityEnd) {
            maxDensityStart = minEnergy;
            maxDensityEnd = minEnergy + (energyRange * 0.1); // Default to 10% of range
        }
        
        // Calculate counts
        const denseCount = energyValues.filter(energy => 
            energy >= maxDensityStart && energy <= maxDensityEnd
        ).length;
        
        const sparseCount = energyValues.length - denseCount;
        
        return {
            denseStart: maxDensityStart,
            denseEnd: maxDensityEnd,
            denseCount: denseCount,
            sparseCount: sparseCount,
            totalCount: energyValues.length,
            densePercentage: (denseCount / energyValues.length * 100).toFixed(1),
            sparsePercentage: (sparseCount / energyValues.length * 100).toFixed(1)
        };
    }

    /**
     * Get color scheme based on selected scale
     * @param {string} scaleType - Type of color scale
     * @returns {Array} Array of colors
     */
    getColorScheme(scaleType) {
        const colorSchemes = {
            'energy': [
                '#10b981', // Green (lowest)
                '#84cc16', // Light green
                '#eab308', // Yellow
                '#f59e0b', // Orange
                '#f97316', // Dark orange
                '#ef4444', // Red (highest)
                '#dc2626'  // Dark red
            ],
            'temperature': [
                '#3b82f6', // Blue (coldest)
                '#06b6d4', // Cyan
                '#10b981', // Green
                '#eab308', // Yellow
                '#f59e0b', // Orange
                '#ef4444', // Red (hottest)
                '#dc2626'  // Dark red
            ],
            'traffic': [
                '#10b981', // Green (good)
                '#84cc16', // Light green
                '#eab308', // Yellow
                '#f59e0b', // Orange
                '#f97316', // Dark orange
                '#ef4444', // Red (bad)
                '#dc2626'  // Dark red
            ],
            'rainbow': [
                '#ef4444', // Red
                '#f97316', // Orange
                '#eab308', // Yellow
                '#84cc16', // Green
                '#06b6d4', // Cyan
                '#3b82f6', // Blue
                '#8b5cf6'  // Purple
            ]
        };
        
        return colorSchemes[scaleType] || colorSchemes['energy'];
    }

    /**
     * Create a square polygon around a point
     * @param {Array} center - [lng, lat] coordinates
     * @param {number} size - Size in meters (half side length)
     * @returns {Object} Turf polygon feature
     */
    createSquare(center, size) {
        const [lng, lat] = center;
        const halfSize = size / 2;
        // Convert meters to degrees (approximate)
        const latOffset = halfSize / 111320; // 1 degree latitude ≈ 111320 meters
        const lngOffset = halfSize / (111320 * Math.cos(lat * Math.PI / 180));
        
        const bbox = [
            lng - lngOffset, // min longitude
            lat - latOffset, // min latitude
            lng + lngOffset, // max longitude
            lat + latOffset  // max latitude
        ];
        return turf.bboxPolygon(bbox);
    }

    /**
     * Create a triangle polygon around a point
     * @param {Array} center - [lng, lat] coordinates
     * @param {number} radius - Radius in meters (distance from center to vertices)
     * @returns {Object} Turf polygon feature
     */
    createTriangle(center, radius) {
        const [lng, lat] = center;
        // Convert meters to degrees
        const latOffset = radius / 111320;
        const lngOffset = radius / (111320 * Math.cos(lat * Math.PI / 180));
        
        // Create equilateral triangle (3 vertices)
        const vertices = [];
        for (let i = 0; i < 3; i++) {
            const angle = (i * 2 * Math.PI / 3) - (Math.PI / 2); // Start from top
            const vertexLng = lng + lngOffset * Math.cos(angle);
            const vertexLat = lat + latOffset * Math.sin(angle);
            vertices.push([vertexLng, vertexLat]);
        }
        // Close the triangle
        vertices.push(vertices[0]);
        
        return turf.polygon([vertices]);
    }

    /**
     * Place a tree at the specified location
     * @param {Array|Object} lngLat - Longitude and latitude coordinates
     * @param {number} legacyHeight - Optional legacy height value
     */
    placeTree(lngLat, legacyHeight) {
        const totalHeight = legacyHeight || (() => {
            const min = Number(document.getElementById('tree-min-height').value);
            const max = Number(document.getElementById('tree-max-height').value);
            return Math.random() * (max - min) + min;
        })();

        const treeType = document.getElementById('tree-type')?.value || 'circle';
        const trunkHeight = totalHeight * 0.4;
        const canopyHeight = totalHeight * 0.6;
        
        // Calculate trunk size based on tree height (2.5% of total height)
        // With min 0.15m and max 0.8m for realistic proportions
        const trunkSize = Math.max(0.15, Math.min(0.8, totalHeight * 0.025));
        
        // Calculate canopy size based on tree height (18% of total height)
        // With min 1.0m and max 6.0m for realistic proportions
        const canopySize = Math.max(1.0, Math.min(6.0, totalHeight * 0.18));
        
        const treeId = `tree-${this.treeIdCounter++}`;
        const pointCoords = Array.isArray(lngLat) ? lngLat : [lngLat.lng, lngLat.lat];
        const point = turf.point(pointCoords);

        // Create Trunk based on tree type
        let trunkFeature;
        if (treeType === 'circle') {
            const trunkBuffer = turf.buffer(point, trunkSize, { units: 'meters' });
            trunkFeature = {
                ...trunkBuffer,
                properties: {
                    id: treeId,
                    isTrunk: true,
                    height: trunkHeight,
                    base: 0
                }
            };
        } else if (treeType === 'square' || treeType === 'square-trunk-only') {
            const trunkSquare = this.createSquare(pointCoords, trunkSize * 2);
            trunkFeature = {
                ...trunkSquare,
                properties: {
                    id: treeId,
                    isTrunk: true,
                    height: trunkHeight,
                    base: 0
                }
            };
        } else if (treeType === 'triangle' || treeType === 'triangle-trunk-only') {
            const trunkTriangle = this.createTriangle(pointCoords, trunkSize);
            trunkFeature = {
                ...trunkTriangle,
                properties: {
                    id: treeId,
                    isTrunk: true,
                    height: trunkHeight,
                    base: 0
                }
            };
        }
        
        this.treeTrunkData.features.push(trunkFeature);

        // Create Canopy (only if not trunk-only types)
        if (treeType !== 'square-trunk-only' && treeType !== 'triangle-trunk-only') {
            let canopyFeature;
            if (treeType === 'circle') {
                const canopyBuffer = turf.buffer(point, canopySize, { units: 'meters' });
                canopyFeature = {
                    ...canopyBuffer,
                    properties: {
                        id: treeId,
                        isCanopy: true,
                        height: canopyHeight,
                        base: trunkHeight
                    }
                };
            } else if (treeType === 'square') {
                const canopySquare = this.createSquare(pointCoords, canopySize * 2);
                canopyFeature = {
                    ...canopySquare,
                    properties: {
                        id: treeId,
                        isCanopy: true,
                        height: canopyHeight,
                        base: trunkHeight
                    }
                };
            } else if (treeType === 'triangle') {
                const canopyTriangle = this.createTriangle(pointCoords, canopySize);
                canopyFeature = {
                    ...canopyTriangle,
                    properties: {
                        id: treeId,
                        isCanopy: true,
                        height: canopyHeight,
                        base: trunkHeight
                    }
                };
            }
            
            if (canopyFeature) {
                this.treeCanopyData.features.push(canopyFeature);
            }
        }

        // Update both sources with viewport-based rendering for large datasets
        const map = this.core.getMap();
        this.updateTreeSources(map);
        
        // Update billboard source for LOD
        if (window.app && window.app.tree) {
            window.app.tree.updateCanopyCentroidsSource(map);
        }

        // Update tree counter if tree module is available
        if (window.app && window.app.tree) {
            window.app.tree.updateTreeCounter();
        }
    }

    /**
     * Place multiple trees within a shape (brush tool)
     * @param {Array|Object} centerLngLat - Center coordinates
     * @param {string} shapeType - Shape type: 'circle' or 'square'
     * @param {number} size - Size (radius for circle, side length for square) in meters
     * @param {number} count - Number of trees to place
     */
    placeTreesInShape(centerLngLat, shapeType, size, count) {
        const centerCoords = Array.isArray(centerLngLat) ? centerLngLat : [centerLngLat.lng, centerLngLat.lat];
        const centerPoint = turf.point(centerCoords);
        
        let shape;
        if (shapeType === 'circle') {
            shape = turf.circle(centerPoint, size, { units: 'meters', steps: 64 });
        } else if (shapeType === 'square') {
            // Create square: half size in each direction
            const halfSize = size / 2;
            // Convert meters to degrees (approximate)
            const latOffset = halfSize / 111320; // 1 degree latitude ≈ 111320 meters
            const lngOffset = halfSize / (111320 * Math.cos(centerCoords[1] * Math.PI / 180));
            
            const bbox = [
                centerCoords[0] - lngOffset, // min longitude
                centerCoords[1] - latOffset, // min latitude
                centerCoords[0] + lngOffset, // max longitude
                centerCoords[1] + latOffset  // max latitude
            ];
            shape = turf.bboxPolygon(bbox);
        } else {
            console.error('Unknown shape type:', shapeType);
            return 0;
        }
        
        return this.placeTreesInPolygon(shape, count);
    }

    /**
     * Place multiple trees within a polygon
     * @param {Object} polygon - Turf polygon feature
     * @param {number} count - Number of trees to place
     */
    placeTreesInPolygon(polygon, count) {
        const minHeight = Number(document.getElementById('tree-min-height').value);
        const maxHeight = Number(document.getElementById('tree-max-height').value);
        const requestedTreeDistance = Number(document.getElementById('brush-tree-distance')?.value || 3); // Minimum distance between trees in meters
        
        // Calculate polygon area in square meters
        const polygonArea = turf.area(polygon); // Returns area in square meters
        
        // Calculate max possible trees based on polygon area and minimum distance between tree centers.
        // This is a rough packing estimate (not exact), but helps prevent impossible requests.
        const capacityForDistance = (distanceMeters) => {
            const d = Math.max(0.0001, distanceMeters);
            const areaPerTree = Math.PI * Math.pow(d / 2, 2);
            return Math.floor(polygonArea / areaPerTree);
        };
        
        let treeDistance = requestedTreeDistance;
        let maxPossibleTrees = capacityForDistance(treeDistance);
        let actualCount = count;
        
        // If the requested count exceeds estimated capacity, reduce distance to make it feasible
        // instead of silently capping the output. This keeps "export/save" consistent with the user's request.
        if (count > maxPossibleTrees) {
            const requiredDistance = Math.sqrt((4 * polygonArea) / (Math.PI * count)); // derived from capacity formula
            const adjustedDistance = Math.min(requestedTreeDistance, requiredDistance);
            const clampedDistance = Math.max(0.25, adjustedDistance); // avoid extreme/degenerate values
            
            treeDistance = clampedDistance;
            maxPossibleTrees = capacityForDistance(treeDistance);
            
            console.warn(
                `⚠ Requested ${count} trees exceeds estimated capacity at distance ${requestedTreeDistance}m (capacity≈${capacityForDistance(requestedTreeDistance)}). ` +
                `Auto-adjusting distance to ${treeDistance.toFixed(3)}m (new capacity≈${maxPossibleTrees}).`
            );
        } else {
            console.log(
                `Placing ${actualCount} trees in polygon (area: ${polygonArea.toFixed(2)} m², distance: ${treeDistance}m, estimated capacity: ${maxPossibleTrees})`
            );
        }
        
        // Use grid-based spatial indexing for efficient distance checking
        const gridSize = treeDistance * 2; // Grid cell size in meters (slightly larger than min distance)
        const grid = new Map(); // Grid: "lng,lat" -> array of tree points in that cell
        
        // Helper function to convert meters to degrees at given latitude
        const metersToDegrees = (meters, lat) => {
            const latDegrees = meters / 111320;
            const lngDegrees = meters / (111320 * Math.cos(lat * Math.PI / 180));
            return { lat: latDegrees, lng: lngDegrees };
        };
        
        // Helper function to get grid key for a point
        const getGridKey = (lng, lat) => {
            const deg = metersToDegrees(gridSize, lat);
            const gridLng = Math.floor(lng / deg.lng);
            const gridLat = Math.floor(lat / deg.lat);
            return `${gridLng},${gridLat}`;
        };
        
        // Helper function to get neighboring grid cells
        const getNeighborKeys = (lng, lat) => {
            const deg = metersToDegrees(gridSize, lat);
            const gridLng = Math.floor(lng / deg.lng);
            const gridLat = Math.floor(lat / deg.lat);
            const keys = [];
            for (let dlng = -1; dlng <= 1; dlng++) {
                for (let dlat = -1; dlat <= 1; dlat++) {
                    keys.push(`${gridLng + dlng},${gridLat + dlat}`);
                }
            }
            return keys;
        };
        
        // Use async batch processing for large counts to prevent UI blocking
        if (actualCount > 1000) {
            return this.placeTreesInPolygonAsync(polygon, actualCount, minHeight, maxHeight, treeDistance, grid, getGridKey, getNeighborKeys, maxPossibleTrees);
        }
        
        // Synchronous processing for smaller counts
        return this.placeTreesInPolygonSync(polygon, actualCount, minHeight, maxHeight, treeDistance, grid, getGridKey, getNeighborKeys, maxPossibleTrees);
    }

    /**
     * Synchronous tree placement (for counts <= 1000)
     */
    placeTreesInPolygonSync(polygon, count, minHeight, maxHeight, treeDistance, grid, getGridKey, getNeighborKeys, maxPossibleTrees) {
        const treesPlaced = [];
        let attempts = 0;
        const maxAttempts = Math.min(count * 100, maxPossibleTrees * 150); // Limit attempts based on capacity
        
        const bbox = turf.bbox(polygon);
        let consecutiveFailures = 0;
        const maxConsecutiveFailures = 1000; // Stop if we can't place trees after many attempts
        
        while (treesPlaced.length < count && attempts < maxAttempts && consecutiveFailures < maxConsecutiveFailures) {
            attempts++;
            
            const randomLng = bbox[0] + Math.random() * (bbox[2] - bbox[0]);
            const randomLat = bbox[1] + Math.random() * (bbox[3] - bbox[1]);
            const randomPoint = turf.point([randomLng, randomLat]);
            
            if (turf.booleanPointInPolygon(randomPoint, polygon)) {
                let tooClose = false;
                const neighborKeys = getNeighborKeys(randomLng, randomLat);
                
                for (const key of neighborKeys) {
                    const cellTrees = grid.get(key);
                    if (cellTrees) {
                        for (const placedTree of cellTrees) {
                            const distance = turf.distance(randomPoint, turf.point(placedTree), { units: 'meters' });
                            if (distance < treeDistance) {
                                tooClose = true;
                                break;
                            }
                        }
                        if (tooClose) break;
                    }
                }
                
                if (!tooClose) {
                    const randomHeight = Math.random() * (maxHeight - minHeight) + minHeight;
                    this.placeTree([randomLng, randomLat], randomHeight);
                    treesPlaced.push([randomLng, randomLat]);
                    
                    const gridKey = getGridKey(randomLng, randomLat);
                    if (!grid.has(gridKey)) {
                        grid.set(gridKey, []);
                    }
                    grid.get(gridKey).push([randomLng, randomLat]);
                    consecutiveFailures = 0; // Reset failure counter
                } else {
                    consecutiveFailures++;
                }
            } else {
                consecutiveFailures++;
            }
        }
        
        // Check if we stopped because area is full
        if (treesPlaced.length < count && consecutiveFailures >= maxConsecutiveFailures) {
            console.log(`✓ Area is full. Placed ${treesPlaced.length} trees (${count} requested, max capacity: ${maxPossibleTrees}, min distance: ${treeDistance}m)`);
        } else {
            console.log(`✓ Placed ${treesPlaced.length} trees (${count} requested, min distance: ${treeDistance}m, attempts: ${attempts})`);
        }
        
        // Update tree counter
        if (window.app && window.app.tree) {
            window.app.tree.updateTreeCounter();
        }
        
        return treesPlaced.length;
    }

    /**
     * Async batch processing for large counts (prevents UI blocking)
     */
    async placeTreesInPolygonAsync(polygon, count, minHeight, maxHeight, treeDistance, grid, getGridKey, getNeighborKeys, maxPossibleTrees) {
        const treesPlaced = [];
        let attempts = 0;
        const maxAttempts = Math.min(count * 150, maxPossibleTrees * 200); // Limit attempts based on capacity
        const batchSize = 100; // Process 100 trees per batch for smoother updates
        const bbox = turf.bbox(polygon);
        let consecutiveFailures = 0;
        const maxConsecutiveFailures = 2000; // Stop if we can't place trees after many attempts
        
        console.log(`Starting async placement of ${count} trees (max capacity: ${maxPossibleTrees})...`);
        
        return new Promise((resolve) => {
            const processBatch = () => {
                const batchStart = treesPlaced.length;
                
                while (treesPlaced.length < batchStart + batchSize && treesPlaced.length < count && attempts < maxAttempts && consecutiveFailures < maxConsecutiveFailures) {
                    attempts++;
                    
                    const randomLng = bbox[0] + Math.random() * (bbox[2] - bbox[0]);
                    const randomLat = bbox[1] + Math.random() * (bbox[3] - bbox[1]);
                    const randomPoint = turf.point([randomLng, randomLat]);
                    
                    if (turf.booleanPointInPolygon(randomPoint, polygon)) {
                        let tooClose = false;
                        const neighborKeys = getNeighborKeys(randomLng, randomLat);
                        
                        for (const key of neighborKeys) {
                            const cellTrees = grid.get(key);
                            if (cellTrees) {
                                for (const placedTree of cellTrees) {
                                    const distance = turf.distance(randomPoint, turf.point(placedTree), { units: 'meters' });
                                    if (distance < treeDistance) {
                                        tooClose = true;
                                        break;
                                    }
                                }
                                if (tooClose) break;
                            }
                        }
                        
                        if (!tooClose) {
                            const randomHeight = Math.random() * (maxHeight - minHeight) + minHeight;
                            this.placeTree([randomLng, randomLat], randomHeight);
                            treesPlaced.push([randomLng, randomLat]);
                            
                            const gridKey = getGridKey(randomLng, randomLat);
                            if (!grid.has(gridKey)) {
                                grid.set(gridKey, []);
                            }
                            grid.get(gridKey).push([randomLng, randomLat]);
                            consecutiveFailures = 0; // Reset failure counter
                        } else {
                            consecutiveFailures++;
                        }
                    } else {
                        consecutiveFailures++;
                    }
                }
                
                // Update map sources and tree counter after each batch (for real-time updates)
                if (treesPlaced.length > batchStart) {
                    const map = this.core.getMap();
                    if (map && map.getSource('tree-trunks-source') && map.getSource('tree-canopies-source')) {
                        // Update sources with current data
                        map.getSource('tree-trunks-source').setData(this.treeTrunkData);
                        map.getSource('tree-canopies-source').setData(this.treeCanopyData);
                    }
                    
                    // Update tree counter in real-time after each batch
                    if (window.app && window.app.tree) {
                        window.app.tree.updateTreeCounter();
                    }
                }
                
                // Progress update every 500 trees
                if (treesPlaced.length > 0 && treesPlaced.length % 500 === 0) {
                    const progress = ((treesPlaced.length / count) * 100).toFixed(1);
                    console.log(`Progress: ${treesPlaced.length}/${count} trees (${progress}%) - ${attempts} attempts`);
                }
                
                // Continue processing or finish
                if (treesPlaced.length >= count || attempts >= maxAttempts || consecutiveFailures >= maxConsecutiveFailures) {
                    // Check if we stopped because area is full
                    if (treesPlaced.length < count && consecutiveFailures >= maxConsecutiveFailures) {
                        console.log(`✓ Area is full. Placed ${treesPlaced.length} trees (${count} requested, max capacity: ${maxPossibleTrees}, min distance: ${treeDistance}m)`);
                    } else if (treesPlaced.length < count) {
                        console.warn(`⚠ Could only place ${treesPlaced.length} out of ${count} requested trees. Try reducing tree count, increasing brush size, or decreasing tree distance.`);
                    } else {
                        console.log(`✓ Placed ${treesPlaced.length} trees (${count} requested, min distance: ${treeDistance}m, attempts: ${attempts})`);
                    }
                    
                    // Update tree counter
                    if (window.app && window.app.tree) {
                        window.app.tree.updateTreeCounter();
                    }
                    
                    resolve(treesPlaced.length);
                } else {
                    // Process next batch asynchronously
                    setTimeout(processBatch, 0);
                }
            };
            
            // Start processing
            processBatch();
        });
    }

    /**
     * Delete trees at the specified point
     * @param {Object} point - Point coordinates
     */
    deleteTreesAtPoint(point) {
        const map = this.core.getMap();
        const features = map.queryRenderedFeatures(point, { layers: ['tree-trunks-layer', 'tree-canopies-layer'] });
        if (!features.length) return;

        const idToDelete = features[0].properties.id;
        this.treeTrunkData.features = this.treeTrunkData.features.filter(f => f.properties.id !== idToDelete);
        this.treeCanopyData.features = this.treeCanopyData.features.filter(f => f.properties.id !== idToDelete);

        this.updateTreeSources(map);

        // Update tree counter if tree module is available
        if (window.app && window.app.tree) {
            window.app.tree.updateTreeCounter();
        }
    }

    /**
     * Delete trees within a shape (delete brush tool)
     * @param {Array|Object} centerLngLat - Center coordinates
     * @param {string} shapeType - Shape type: 'circle' or 'square'
     * @param {number} size - Size (radius for circle, side length for square) in meters
     */
    deleteTreesInShape(centerLngLat, shapeType, size) {
        const centerCoords = Array.isArray(centerLngLat) ? centerLngLat : [centerLngLat.lng, centerLngLat.lat];
        const centerPoint = turf.point(centerCoords);
        
        let shape;
        if (shapeType === 'circle') {
            shape = turf.circle(centerPoint, size, { units: 'meters', steps: 64 });
        } else if (shapeType === 'square') {
            const halfSize = size / 2;
            const latOffset = halfSize / 111320;
            const lngOffset = halfSize / (111320 * Math.cos(centerCoords[1] * Math.PI / 180));
            
            const bbox = [
                centerCoords[0] - lngOffset,
                centerCoords[1] - latOffset,
                centerCoords[0] + lngOffset,
                centerCoords[1] + latOffset
            ];
            shape = turf.bboxPolygon(bbox);
        } else {
            console.error('Unknown shape type:', shapeType);
            return 0;
        }
        
        return this.deleteTreesInPolygon(shape);
    }

    /**
     * Delete trees within a polygon
     * @param {Object} polygon - Turf polygon feature
     */
    deleteTreesInPolygon(polygon) {
        const map = this.core.getMap();
        let deletedCount = 0;
        const idsToDelete = new Set();
        
        // Check all tree trunks to see if they're inside the polygon
        this.treeTrunkData.features.forEach(trunk => {
            const trunkCenter = turf.centroid(trunk);
            if (turf.booleanPointInPolygon(trunkCenter, polygon)) {
                idsToDelete.add(trunk.properties.id);
            }
        });
        
        // Remove trees with matching IDs
        this.treeTrunkData.features = this.treeTrunkData.features.filter(f => {
            if (idsToDelete.has(f.properties.id)) {
                deletedCount++;
                return false;
            }
            return true;
        });
        
        this.treeCanopyData.features = this.treeCanopyData.features.filter(f => {
            return !idsToDelete.has(f.properties.id);
        });
        
        // Update map sources
        this.updateTreeSources(map);
        
        // Update tree counter
        if (window.app && window.app.tree) {
            window.app.tree.updateTreeCounter();
        }
        
        console.log(`✓ Deleted ${deletedCount} trees in ${polygon.geometry.type}`);
        return deletedCount;
    }

    /**
     * Delete all buildings (keep trees)
     */
    deleteAllBuildings() {
        console.log('=== deleteAllBuildings START ===');
        console.log('Current building count:', this.buildingData.features.length);
        console.log('Building data before delete:', this.buildingData);
        
        // Store count for verification
        const beforeCount = this.buildingData.features.length;
        
        // Clear building data
        this.buildingData = { type: 'FeatureCollection', features: [] };
        this.energyStats = { min: 0, max: 100, hasEnergyData: false };
        
        console.log('Building data after clear:', this.buildingData);
        console.log('Building count after clear:', this.buildingData.features.length);

        const map = this.core.getMap();
        if (!map) {
            console.error('❌ Map not available');
            return;
        }
        console.log('✓ Map is available');
        
        // Check if source exists
        const source = map.getSource('geojson-data');
        if (source) {
            console.log('✓ geojson-data source found');
            console.log('Source data before update:', source._data);
            
            // Update source
            source.setData(this.buildingData);
            
            console.log('Source data after update:', source._data);
            console.log('Source features count:', source._data?.features?.length || 0);
            
            // Verify layer exists
            const layer = map.getLayer('geojson-layer');
            if (layer) {
                console.log('✓ geojson-layer found');
                console.log('Layer source:', layer.source);
            } else {
                console.warn('⚠ geojson-layer not found');
            }
        } else {
            console.error('❌ geojson-data source not found');
            console.log('Available sources:', Object.keys(map.getStyle().sources || {}));
        }
        
        // Update building colors
        console.log('Updating building colors...');
        this.updateBuildingColors();
        console.log('✓ Building colors updated');

        // Update building counter
        console.log('Updating building counter...');
        this.updateBuildingCounter();
        console.log('✓ Building counter updated');

        // Notify energy statistics module
        if (this.energyStatsModule) {
            console.log('Notifying energy stats module...');
            this.energyStatsModule.updateStats();
            console.log('✓ Energy stats module notified');
        } else {
            console.warn('⚠ Energy stats module not available');
        }
        
        // Final verification
        const afterCount = this.buildingData.features.length;
        console.log(`=== deleteAllBuildings END ===`);
        console.log(`Buildings before: ${beforeCount}, after: ${afterCount}`);
        
        if (afterCount === 0) {
            console.log('✅ All buildings deleted successfully');
        } else {
            console.error(`❌ Error: ${afterCount} buildings still remain!`);
        }
    }

    /**
     * Reset all data
     */
    reset() {
        this.buildingData = { type: 'FeatureCollection', features: [] };
        this.treeTrunkData = { type: 'FeatureCollection', features: [] };
        this.treeCanopyData = { type: 'FeatureCollection', features: [] };
        this.roadData = { type: 'FeatureCollection', features: [] };
        this.energyStats = { min: 0, max: 100, hasEnergyData: false };
        this.treeIdCounter = 0;

        const map = this.core.getMap();
        map.getSource('geojson-data').setData(this.buildingData);
        this.updateRoadSource(map);
        this.updateTreeSources(map);
        this.updateBuildingColors();

        // Update tree counter if tree module is available
        if (window.app && window.app.tree) {
            window.app.tree.updateTreeCounter();
        }

        // Update building counter
        this.updateBuildingCounter();

        // Notify energy statistics module
        if (this.energyStatsModule) {
            this.energyStatsModule.updateStats();
        }
    }

    /**
     * Save current data as GeoJSON
     * @returns {Object} Combined GeoJSON data
     */
    saveData() {
        const buildings = this.buildingData.features;
        const trunks = this.treeTrunkData.features;
        const canopies = this.treeCanopyData.features;
        const roads = this.roadData.features;

        if (buildings.length || trunks.length || roads.length) {
            // For large datasets, combine features more efficiently
            const totalFeatures = buildings.length + trunks.length + canopies.length + roads.length;
            
            if (totalFeatures > 100000) {
                console.log(`Large dataset detected: ${totalFeatures} features. Using optimized combination...`);
            }
            
            // Use Array.concat for better performance with large arrays
            const allFeatures = buildings.concat(trunks, canopies, roads);
            
            return {
                type: 'FeatureCollection',
                features: allFeatures
            };
        }
        return null;
    }

    /**
     * Get building data
     * @returns {Object} Building data
     */
    getBuildingData() {
        return this.buildingData;
    }

    /**
     * Get road data
     * @returns {Object} Road data (LineString features)
     */
    getRoadData() {
        return this.roadData;
    }

    /**
     * Update road source on map
     * @param {Object} map - Mapbox map instance
     */
    updateRoadSource(map) {
        if (!map) return;
        
        const roadSourceId = 'roads-source';
        if (map.getSource(roadSourceId)) {
            map.getSource(roadSourceId).setData(this.roadData);
        } else {
            // Source will be created by UI module when layer is added
            console.log('Road source not found, will be created by UI module');
        }
    }

    /**
     * Update tree sources with viewport-based rendering for performance
     * Limits the number of trees rendered to prevent Out of Memory errors
     * @param {Object} map - Mapbox map instance
     */
    updateTreeSources(map) {
        const MAX_RENDERED_TREES = 50000; // Maximum trees to render at once
        const totalTrees = this.treeTrunkData.features.length;
        
        let trunksToRender = this.treeTrunkData.features;
        let canopiesToRender = this.treeCanopyData.features;
        
        // If we have too many trees, use viewport-based filtering
        if (totalTrees > MAX_RENDERED_TREES) {
            try {
                // Get current viewport bounds
                const bounds = map.getBounds();
                const bbox = [
                    bounds.getWest(),
                    bounds.getSouth(),
                    bounds.getEast(),
                    bounds.getNorth()
                ];
                
                // Filter trees within viewport
                const viewportPolygon = turf.bboxPolygon(bbox);
                const visibleTrunkIds = new Set();
                
                // Sample trees: take every Nth tree to stay within limit
                const sampleRate = Math.ceil(totalTrees / MAX_RENDERED_TREES);
                let sampledCount = 0;
                
                for (let i = 0; i < trunksToRender.length && sampledCount < MAX_RENDERED_TREES; i += sampleRate) {
                    const trunk = trunksToRender[i];
                    const trunkCenter = turf.centroid(trunk);
                    
                    // Check if tree is in viewport or close to it
                    if (turf.booleanPointInPolygon(trunkCenter, viewportPolygon)) {
                        visibleTrunkIds.add(trunk.properties.id);
                        sampledCount++;
                    }
                }
                
                // If we still have space, add trees near viewport
                if (sampledCount < MAX_RENDERED_TREES) {
                    const expandedBbox = turf.bbox(turf.buffer(viewportPolygon, 0.01, { units: 'degrees' }));
                    const expandedPolygon = turf.bboxPolygon(expandedBbox);
                    
                    for (let i = 0; i < trunksToRender.length && sampledCount < MAX_RENDERED_TREES; i++) {
                        if (visibleTrunkIds.has(trunksToRender[i].properties.id)) continue;
                        
                        const trunk = trunksToRender[i];
                        const trunkCenter = turf.centroid(trunk);
                        
                        if (turf.booleanPointInPolygon(trunkCenter, expandedPolygon)) {
                            visibleTrunkIds.add(trunk.properties.id);
                            sampledCount++;
                        }
                    }
                }
                
                // Filter trunks and canopies based on visible IDs
                trunksToRender = trunksToRender.filter(t => visibleTrunkIds.has(t.properties.id));
                canopiesToRender = canopiesToRender.filter(c => visibleTrunkIds.has(c.properties.id));
                
                console.log(`Rendering ${trunksToRender.length} of ${totalTrees} trees (viewport-based optimization)`);
            } catch (error) {
                console.warn('Error in viewport filtering, using simple sampling:', error);
                // Fallback: simple sampling
                const sampleRate = Math.ceil(totalTrees / MAX_RENDERED_TREES);
                trunksToRender = trunksToRender.filter((_, i) => i % sampleRate === 0);
                const visibleIds = new Set(trunksToRender.map(t => t.properties.id));
                canopiesToRender = canopiesToRender.filter(c => visibleIds.has(c.properties.id));
            }
        }
        
        // Update sources with filtered data
        if (map.getSource('tree-trunks-source')) {
            map.getSource('tree-trunks-source').setData({
                type: 'FeatureCollection',
                features: trunksToRender
            });
        }
        
        if (map.getSource('tree-canopies-source')) {
            map.getSource('tree-canopies-source').setData({
                type: 'FeatureCollection',
                features: canopiesToRender
            });
        }
        
        // Update billboard source if tree module is available
        if (window.app && window.app.tree) {
            window.app.tree.updateCanopyCentroidsSource(map);
        }
    }
    
    /**
     * Get tree trunk data
     * @returns {Object} Tree trunk GeoJSON data
     */
    getTreeTrunkData() {
        return this.treeTrunkData;
    }
    
    /**
     * Get tree canopy data
     * @returns {Object} Tree canopy GeoJSON data
     */
    getTreeCanopyData() {
        return this.treeCanopyData;
    }

    /**
     * Get tree trunk data
     * @returns {Object} Tree trunk data
     */
    getTreeTrunkData() {
        return this.treeTrunkData;
    }

    /**
     * Get tree canopy data
     * @returns {Object} Tree canopy data
     */
    getTreeCanopyData() {
        return this.treeCanopyData;
    }

    /**
     * Get energy statistics
     * @returns {Object} Energy statistics
     */
    getEnergyStats() {
        return this.energyStats;
    }

    /**
     * Update a building feature
     * @param {number} featureId - Feature ID to update
     * @param {Object} newProperties - New properties for the feature
     */
    updateBuildingFeature(featureId, newProperties) {
        const featureToUpdate = this.buildingData.features.find(f => f.properties.ID === featureId);
        if (featureToUpdate) {
            featureToUpdate.properties = newProperties;
            const map = this.core.getMap();
            map.getSource('geojson-data').setData(this.buildingData);
            return true;
        }
        return false;
    }

    /**
     * Set the selected energy column
     * @param {string} energyColumn - Name of the energy column to use
     */
    setEnergyColumn(energyColumn) {
        this.selectedEnergyColumn = energyColumn;
        
        // Recalculate energy statistics with new column
        this.energyStats = UtilsModule.calculateEnergyStats(this.buildingData.features, this.selectedEnergyColumn);
        
        // Update building colors
        this.updateBuildingColors();
        
        // Notify energy statistics module
        if (this.energyStatsModule) {
            this.energyStatsModule.updateStats();
        }
    }

    /**
     * Get the currently selected energy column
     * @returns {string} Currently selected energy column
     */
    getSelectedEnergyColumn() {
        return this.selectedEnergyColumn;
    }

    /**
     * Set the selected color scale
     * @param {string} colorScale - Name of the color scale to use
     */
    setColorScale(colorScale) {
        this.selectedColorScale = colorScale;
        
        // Update building colors with new scale
        this.updateBuildingColors();
        
        console.log(`✓ Color scale changed to: ${colorScale}`);
    }

    /**
     * Get the currently selected color scale
     * @returns {string} Currently selected color scale
     */
    getSelectedColorScale() {
        return this.selectedColorScale;
    }

    /**
     * Update building counter display
     * Note: Counter removed from Data Management section, only used in Energy Statistics
     */
    updateBuildingCounter() {
        // Counter removed from Data Management section
        // Energy Statistics section has its own counter (building-count)
        // This function is kept for compatibility but does nothing
    }
}

// Export for use in other modules
window.DataModule = DataModule;
