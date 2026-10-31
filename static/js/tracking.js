/**
 * Live Tracking & Map Engine
 * Manages Leaflet.js interactive map, Geolocation API watchers,
 * OSRM routing visualizer, geofencing, and lab demo simulation.
 */

// Global State
let mapInstance = null;
let currentTileLayer = null;
let isSatellite = false;

// Markers & Layers
let userMarker = null;
let accuracyCircle = null;
let destinationMarker = null;
let geofenceCircle = null;
let routePolyline = null;
let breadcrumbLayer = null;

// Geolocation Watcher ID & Status
let geoWatchId = null;
let isTrackingActive = false;
let lastKnownPosition = null;
let hasCenteredOnce = false;

// Simulation State (for classroom / lab demonstrations)
let simulationInterval = null;
let simulationRoutePoints = [];
let simulationIndex = 0;

/**
 * Initialize Leaflet Map
 */
function initTrackingMap(initialLat = 37.7749, initialLng = -122.4194) {
    if (mapInstance) return;

    mapInstance = L.map('map', {
        zoomControl: false,
        attributionControl: false
    }).setView([initialLat, initialLng], 14);

    // Add zoom control to bottom right
    L.control.zoom({ position: 'bottomright' }).addTo(mapInstance);

    // Standard OpenStreetMap Tile Layer
    currentTileLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap contributors'
    }).addTo(mapInstance);

    // Layer for breadcrumbs
    breadcrumbLayer = L.layerGroup().addTo(mapInstance);

    // Map click handler to easily set destination
    mapInstance.on('click', function(e) {
        handleMapClickDestination(e.latlng.lat, e.latlng.lng);
    });

    console.log("Leaflet map initialized successfully.");
}

/**
 * Toggle Satellite / OpenStreetMap Street view
 */
function toggleMapTileLayer() {
    if (!mapInstance) return;

    mapInstance.removeLayer(currentTileLayer);
    if (!isSatellite) {
        currentTileLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
            maxZoom: 19
        }).addTo(mapInstance);
        isSatellite = true;
        showToast("Switched to Satellite View", "info");
    } else {
        currentTileLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19
        }).addTo(mapInstance);
        isSatellite = false;
        showToast("Switched to Street Map View", "info");
    }
}

/**
 * Start Live GPS Tracking & Sharing
 * Prompts user for voluntary permission and registers watchPosition
 */
function startTrackingAndSharing() {
    if (!("geolocation" in navigator)) {
        showToast("Geolocation is not supported by your browser.", "error");
        return;
    }

    const gpsPill = document.getElementById('gpsStatusPill');
    const badge = document.getElementById('sharingStatusBadge');
    const badgeText = document.getElementById('sharingBadgeText');
    const btnStart = document.getElementById('btnStartTracking');
    const btnStop = document.getElementById('btnStopTracking');

    if (gpsPill) {
        gpsPill.className = "pill pill-online";
        gpsPill.innerText = "GPS Seeking...";
    }

    const options = {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 0
    };

    // Begin watcher
    geoWatchId = navigator.geolocation.watchPosition(
        onLocationSuccess,
        onLocationError,
        options
    );

    isTrackingActive = true;
    if (btnStart) btnStart.classList.add('hidden');
    if (btnStop) btnStop.classList.remove('hidden');

    if (badge) {
        badge.className = "status-badge badge-active";
        badgeText.innerText = "Live Location Active";
    }

    // Notify backend
    fetch('/api/location/toggle-sharing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_sharing: true })
    }).catch(e => console.warn(e));

    showToast("Voluntary live GPS tracking started.", "success");
}

/**
 * Stop Tracking and Clear Watcher
 * Guarantees zero background location tracking
 */
function stopTrackingAndSharing() {
    if (geoWatchId !== null) {
        navigator.geolocation.clearWatch(geoWatchId);
        geoWatchId = null;
    }

    stopRouteSimulation();
    isTrackingActive = false;

    const gpsPill = document.getElementById('gpsStatusPill');
    const badge = document.getElementById('sharingStatusBadge');
    const badgeText = document.getElementById('sharingBadgeText');
    const btnStart = document.getElementById('btnStartTracking');
    const btnStop = document.getElementById('btnStopTracking');

    if (gpsPill) {
        gpsPill.className = "pill pill-offline";
        gpsPill.innerText = "GPS Inactive";
    }

    if (badge) {
        badge.className = "status-badge badge-idle";
        badgeText.innerText = "Tracking Inactive";
    }

    if (btnStart) btnStart.classList.remove('hidden');
    if (btnStop) btnStop.classList.add('hidden');

    // Notify backend to halt public live sharing
    fetch('/api/location/toggle-sharing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_sharing: false })
    }).catch(e => console.warn(e));

    showToast("Location sharing stopped immediately.", "info");
}

/**
 * Location Success Callback
 */
function onLocationSuccess(position) {
    const lat = position.coords.latitude;
    const lng = position.coords.longitude;
    const accuracy = position.coords.accuracy || 15;
    const speed = position.coords.speed ? (position.coords.speed * 3.6).toFixed(1) : 0;
    const heading = position.coords.heading || null;

    lastKnownPosition = { lat, lng, accuracy, speed, heading };

    // Update UI telemetry metrics
    updateTelemetryUI(lat, lng, accuracy, speed);

    // Update Map Elements
    renderUserOnMap(lat, lng, accuracy);

    if (!hasCenteredOnce && mapInstance) {
        mapInstance.setView([lat, lng], 15);
        hasCenteredOnce = true;
    }

    // Send update to Backend API
    sendLocationToServer(lat, lng, accuracy, speed, heading);
}

/**
 * Location Error Callback
 */
function onLocationError(error) {
    console.warn("Geolocation error code " + error.code + ": " + error.message);
    const gpsPill = document.getElementById('gpsStatusPill');
    
    let msg = "Could not retrieve GPS location.";
    if (error.code === error.PERMISSION_DENIED) {
        msg = "Location access was denied. Please allow location permissions in your browser.";
        stopTrackingAndSharing();
    } else if (error.code === error.TIMEOUT) {
        msg = "GPS location request timed out.";
    }

    if (gpsPill) {
        gpsPill.className = "pill pill-offline";
        gpsPill.innerText = "GPS Error";
    }
    showToast(msg, "error");
}

/**
 * Send coordinates to Flask API
 */
async function sendLocationToServer(lat, lng, accuracy, speed, heading) {
    try {
        const resp = await fetch('/api/location/update', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                latitude: lat,
                longitude: lng,
                accuracy: accuracy,
                speed: speed,
                heading: heading,
                is_sharing: isTrackingActive
            })
        });

        if (resp.ok) {
            const data = await resp.json();
            
            // Check if backend detected arrival or delay events!
            if (data.journey_event) {
                handleJourneyEvent(data.journey_event);
            }

            // Update remaining distance in widget if present
            if (data.distance_to_dest_meters !== null) {
                updateDistanceRemainingUI(data.distance_to_dest_meters);
            }
        }
    } catch (err) {
        console.error("Failed to sync location to server:", err);
    }
}

/**
 * Render pulsing user marker and accuracy ring on Leaflet map
 */
function renderUserOnMap(lat, lng, accuracy) {
    if (!mapInstance) return;

    // Custom pulsing radar HTML DivIcon
    const pulseIcon = L.divIcon({
        className: 'user-pulse-marker',
        html: '<div class="pulse-wave"></div><div class="pulse-core"></div>',
        iconSize: [20, 20],
        iconAnchor: [10, 10]
    });

    if (!userMarker) {
        userMarker = L.marker([lat, lng], { icon: pulseIcon }).addTo(mapInstance);
        userMarker.bindPopup("<strong>You are here</strong><br>Sharing active");
    } else {
        userMarker.setLatLng([lat, lng]);
    }

    // Accuracy Circle
    if (!accuracyCircle) {
        accuracyCircle = L.circle([lat, lng], {
            radius: Math.min(accuracy, 250),
            color: '#3b82f6',
            fillColor: '#93c5fd',
            fillOpacity: 0.15,
            weight: 1
        }).addTo(mapInstance);
    } else {
        accuracyCircle.setLatLng([lat, lng]);
        accuracyCircle.setRadius(Math.min(accuracy, 250));
    }
}

/**
 * Update Telemetry Panel UI
 */
function updateTelemetryUI(lat, lng, accuracy, speed) {
    const teleLat = document.getElementById('teleLat');
    const teleLng = document.getElementById('teleLng');
    const teleAcc = document.getElementById('teleAcc');
    const teleSpeed = document.getElementById('teleSpeed');
    const teleTimestamp = document.getElementById('teleTimestamp');
    const gpsPill = document.getElementById('gpsStatusPill');

    if (teleLat) teleLat.innerText = lat.toFixed(5);
    if (teleLng) teleLng.innerText = lng.toFixed(5);
    if (teleAcc) teleAcc.innerText = Math.round(accuracy) + ' m';
    if (teleSpeed) teleSpeed.innerText = speed + ' km/h';
    if (teleTimestamp) teleTimestamp.innerText = new Date().toLocaleTimeString();
    
    if (gpsPill) {
        gpsPill.className = "pill pill-online";
        gpsPill.innerText = "GPS Live";
    }
}

/**
 * Center map on user location
 */
function centerOnUserLocation() {
    if (lastKnownPosition && mapInstance) {
        mapInstance.setView([lastKnownPosition.lat, lastKnownPosition.lng], 16);
    } else {
        showToast("Waiting for GPS coordinates...", "info");
    }
}

/**
 * Fit bounds of route & markers
 */
function fitRouteBounds() {
    if (!mapInstance) return;
    const group = [];
    if (userMarker) group.push(userMarker);
    if (destinationMarker) group.push(destinationMarker);
    if (routePolyline) group.push(routePolyline);

    if (group.length > 0) {
        const featureGroup = L.featureGroup(group);
        mapInstance.fitBounds(featureGroup.getBounds(), { padding: [50, 50] });
    }
}

/**
 * Render Destination Marker and Geofence Circle on Map
 */
function setDestinationOnMap(destLat, destLng, destName, radiusMeters = 100) {
    if (!mapInstance) return;

    // Remove existing destination elements
    if (destinationMarker) mapInstance.removeLayer(destinationMarker);
    if (geofenceCircle) mapInstance.removeLayer(geofenceCircle);

    // Custom Destination Pin Icon
    const destIcon = L.icon({
        iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-red.png',
        shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
        iconSize: [25, 41],
        iconAnchor: [12, 41],
        popupAnchor: [1, -34],
        shadowSize: [41, 41]
    });

    destinationMarker = L.marker([destLat, destLng], { icon: destIcon }).addTo(mapInstance);
    destinationMarker.bindPopup(`<strong>Destination:</strong><br>${destName}`).openPopup();

    // Geofence Circle
    geofenceCircle = L.circle([destLat, destLng], {
        radius: radiusMeters,
        color: '#10b981',
        fillColor: '#a7f3d0',
        fillOpacity: 0.25,
        weight: 2,
        dashArray: '5, 5'
    }).addTo(mapInstance);

    // If we have user coordinates, calculate and draw route
    if (lastKnownPosition) {
        fetchAndDrawRoute(lastKnownPosition.lat, lastKnownPosition.lng, destLat, destLng);
    }
}

/**
 * Fetch and draw OSRM route polyline
 */
async function fetchAndDrawRoute(startLat, startLng, destLat, destLng) {
    try {
        const url = `/api/geo/route?start_lat=${startLat}&start_lng=${startLng}&dest_lat=${destLat}&dest_lng=${destLng}`;
        const resp = await fetch(url);
        if (!resp.ok) return;

        const data = await resp.json();
        if (data.coordinates && data.coordinates.length > 0) {
            // Leaflet expects [lat, lng], OSRM returns [lng, lat]
            const latLngs = data.coordinates.map(pt => [pt[1], pt[0]]);
            
            // Save for simulation
            simulationRoutePoints = latLngs;

            if (routePolyline && mapInstance) {
                mapInstance.removeLayer(routePolyline);
            }

            routePolyline = L.polyline(latLngs, {
                color: '#3b82f6',
                weight: 5,
                opacity: 0.8,
                smoothFactor: 1
            }).addTo(mapInstance);

            // Update preview stats
            const prevDist = document.getElementById('previewDistance');
            const prevDur = document.getElementById('previewDuration');
            if (prevDist && data.distance_meters) {
                prevDist.innerText = (data.distance_meters / 1000).toFixed(1) + ' km';
            }
            if (prevDur && data.duration_seconds) {
                prevDur.innerText = Math.round(data.duration_seconds / 60) + ' min';
            }

            fitRouteBounds();
        }
    } catch (e) {
        console.warn("Could not calculate road route:", e);
    }
}

/**
 * Handle Arrival & Delay Events dispatched by Backend
 */
function handleJourneyEvent(event) {
    if (event.type === 'ARRIVAL') {
        playChimeSound('arrival');
        showBrowserNotification("Destination Reached! 🎉", event.message, { type: 'success' });
        
        const badge = document.getElementById('widgetStatusBadge');
        if (badge) {
            badge.className = "badge-status status-completed";
            badge.innerText = "Completed";
        }
    } else if (event.type === 'DELAY') {
        playChimeSound('sos');
        showBrowserNotification("Journey Delayed Warning ⚠️", event.message, { type: 'error' });
        
        const badge = document.getElementById('widgetStatusBadge');
        if (badge) {
            badge.className = "badge-status status-delayed";
            badge.innerText = "Delayed";
        }
    }
}

function updateDistanceRemainingUI(meters) {
    const el = document.getElementById('widgetDistance');
    if (el) {
        if (meters < 1000) {
            el.innerText = Math.round(meters) + ' m';
        } else {
            el.innerText = (meters / 1000).toFixed(1) + ' km';
        }
    }
}

/**
 * College Lab Simulation Mode
 * Simulates movement step-by-step along the route for classroom evaluation
 */
function toggleRouteSimulation() {
    if (simulationInterval) {
        stopRouteSimulation();
        showToast("Route simulation stopped.", "info");
        return;
    }

    if (!simulationRoutePoints || simulationRoutePoints.length === 0) {
        showToast("Please select a destination to generate a route before simulating.", "info");
        return;
    }

    simulationIndex = 0;
    const btn = document.getElementById('btnSimulateMovement');
    if (btn) {
        btn.innerHTML = '<i class="fa-solid fa-pause"></i> Pause Simulation';
        btn.className = "btn btn-danger btn-sm";
    }

    showToast("Starting route simulation (1 step every 2 seconds)...", "success");

    simulationInterval = setInterval(() => {
        if (simulationIndex >= simulationRoutePoints.length) {
            stopRouteSimulation();
            showToast("Simulation reached destination point!", "success");
            return;
        }

        const point = simulationRoutePoints[simulationIndex];
        const lat = point[0];
        const lng = point[1];
        const accuracy = 8;
        const speed = 35.0; // km/h

        lastKnownPosition = { lat, lng, accuracy, speed, heading: 0 };
        renderUserOnMap(lat, lng, accuracy);
        updateTelemetryUI(lat, lng, accuracy, speed);
        sendLocationToServer(lat, lng, accuracy, speed, 0);

        simulationIndex += Math.max(1, Math.floor(simulationRoutePoints.length / 15));
    }, 2000);
}

function stopRouteSimulation() {
    if (simulationInterval) {
        clearInterval(simulationInterval);
        simulationInterval = null;
    }
    const btn = document.getElementById('btnSimulateMovement');
    if (btn) {
        btn.innerHTML = '<i class="fa-solid fa-person-walking"></i> Simulate Movement Along Route';
        btn.className = "btn btn-secondary btn-sm";
    }
}

/**
 * Simulate Arrival Directly into Geofence
 */
function simulateArrivalDirectly() {
    if (!destinationMarker) {
        showToast("Set a destination first to test geofence arrival.", "info");
        return;
    }
    const destLatLng = destinationMarker.getLatLng();
    // Position 10 meters away from destination
    const lat = destLatLng.lat + 0.00005;
    const lng = destLatLng.lng + 0.00005;
    
    lastKnownPosition = { lat, lng, accuracy: 5, speed: 2.0, heading: 0 };
    renderUserOnMap(lat, lng, 5);
    updateTelemetryUI(lat, lng, 5, 2.0);
    sendLocationToServer(lat, lng, 5, 2.0, 0);
    showToast("Dispatched simulated coordinates inside destination geofence!", "success");
}
