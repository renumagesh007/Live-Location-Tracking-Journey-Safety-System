/**
 * Public Authorized Tracking Viewer Controller
 * Polls authorized location feed, renders live traveler coordinates,
 * breadcrumbs path, destination, and emergency alert banners in real-time.
 */

let viewerMap = null;
let travelerMarker = null;
let destMarker = null;
let breadcrumbPolyline = null;
let viewerPollTimer = null;
let hasCenteredViewer = false;
let previousSosState = false;

document.addEventListener('DOMContentLoaded', () => {
    initViewerMap();
    startViewerPolling();
});

/**
 * Initialize Leaflet Map for viewer
 */
function initViewerMap() {
    viewerMap = L.map('viewerMap', {
        zoomControl: false,
        attributionControl: false
    }).setView([37.7749, -122.4194], 14);

    L.control.zoom({ position: 'bottomright' }).addTo(viewerMap);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap contributors'
    }).addTo(viewerMap);
}

/**
 * Poll live telemetry every 3.5 seconds
 */
function startViewerPolling() {
    fetchViewerTelemetry();
    viewerPollTimer = setInterval(fetchViewerTelemetry, 3500);
}

async function fetchViewerTelemetry() {
    const token = document.getElementById('shareToken').value;
    if (!token) return;

    try {
        const resp = await fetch(`/api/public/track/${token}`);
        if (!resp.ok) {
            // Token expired or invalid
            handleExpiredViewerSession();
            return;
        }

        const data = await resp.json();
        updateViewerUI(data);
    } catch (e) {
        console.warn("Telemetry fetch error:", e);
    }
}

function updateViewerUI(data) {
    const subjectName = document.getElementById('subjectName');
    const badge = document.getElementById('viewerSharingBadge');
    const badgeText = document.getElementById('viewerBadgeText');
    const destName = document.getElementById('viewerDestName');
    const journeyBadge = document.getElementById('viewerJourneyBadge');
    const distanceRem = document.getElementById('viewerDistanceRemaining');
    const eta = document.getElementById('viewerEta');
    const speed = document.getElementById('viewerSpeed');
    const lastPing = document.getElementById('viewerLastPing');
    const expiry = document.getElementById('viewerExpiryText');

    if (subjectName && data.user_name) subjectName.innerText = data.user_name;
    if (expiry && data.expires_at) {
        expiry.innerText = new Date(data.expires_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    // 1. Live Sharing Status
    if (data.is_sharing && data.current_location) {
        if (badge) {
            badge.className = "status-badge badge-active";
            badgeText.innerText = "Live Tracking Active";
        }
    } else {
        if (badge) {
            badge.className = "status-badge badge-idle";
            badgeText.innerText = "Location Paused";
        }
    }

    // 2. Journey Details
    if (data.journey) {
        if (destName) destName.innerText = data.journey.dest_name;
        if (journeyBadge) {
            journeyBadge.className = `badge-status status-${data.journey.status.toLowerCase().replace(' ', '-')}`;
            journeyBadge.innerText = data.journey.status;
        }
        if (eta && data.journey.expected_arrival) {
            const timePart = data.journey.expected_arrival.split(' ')[1] || data.journey.expected_arrival;
            eta.innerText = timePart.substring(0, 5);
        }

        // Render destination pin if not yet present
        renderDestinationPin(data.journey.dest_lat, data.journey.dest_lng, data.journey.dest_name);
    }

    // 3. Location & Map Telemetry
    if (data.current_location) {
        const lat = data.current_location.latitude;
        const lng = data.current_location.longitude;
        const spd = data.current_location.speed ? Math.round(data.current_location.speed) : 0;
        
        if (speed) speed.innerText = spd + ' km/h';
        if (lastPing) lastPing.innerText = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

        renderTravelerOnMap(lat, lng, data.user_name);

        if (!hasCenteredViewer && viewerMap) {
            viewerMap.setView([lat, lng], 15);
            hasCenteredViewer = true;
        }

        // Calculate straight line or road distance remaining if destination available
        if (data.journey) {
            const dist = calculateHaversineMeters(lat, lng, data.journey.dest_lat, data.journey.dest_lng);
            if (distanceRem) {
                distanceRem.innerText = dist < 1000 ? Math.round(dist) + ' m' : (dist / 1000).toFixed(1) + ' km';
            }
        }
    }

    // 4. Breadcrumb trail
    if (data.breadcrumbs && data.breadcrumbs.length > 0) {
        renderBreadcrumbs(data.breadcrumbs);
    }

    // 5. Emergency SOS Status
    const sosBanner = document.getElementById('viewerSosAlert');
    const sosMsg = document.getElementById('sosAlertMessage');
    const sosTime = document.getElementById('sosAlertTime');
    const sosLink = document.getElementById('sosGoogleMapsLink');

    if (data.emergency_alert && data.emergency_alert.status === 'ACTIVE') {
        if (sosBanner) sosBanner.classList.remove('hidden');
        if (sosMsg) sosMsg.innerText = data.emergency_alert.message || "EMERGENCY ALERT TRIGGERED BY TRAVELER!";
        if (sosTime) sosTime.innerText = "Reported at: " + (data.emergency_alert.created_at || "Just now");
        if (sosLink) sosLink.href = data.emergency_alert.map_link;

        // Play audio chime once when alert first pops up
        if (!previousSosState) {
            playViewerAlarm();
            previousSosState = true;
        }
    } else {
        if (sosBanner) sosBanner.classList.add('hidden');
        previousSosState = false;
    }
}

function renderTravelerOnMap(lat, lng, name) {
    if (!viewerMap) return;

    const pulseIcon = L.divIcon({
        className: 'user-pulse-marker',
        html: '<div class="pulse-wave"></div><div class="pulse-core"></div>',
        iconSize: [20, 20],
        iconAnchor: [10, 10]
    });

    if (!travelerMarker) {
        travelerMarker = L.marker([lat, lng], { icon: pulseIcon }).addTo(viewerMap);
        travelerMarker.bindPopup(`<strong>${name}</strong><br>Live GPS Signal`).openPopup();
    } else {
        travelerMarker.setLatLng([lat, lng]);
    }
}

function renderDestinationPin(lat, lng, name) {
    if (!viewerMap || destMarker) return;

    const destIcon = L.icon({
        iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-red.png',
        shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
        iconSize: [25, 41],
        iconAnchor: [12, 41],
        popupAnchor: [1, -34],
        shadowSize: [41, 41]
    });

    destMarker = L.marker([lat, lng], { icon: destIcon }).addTo(viewerMap);
    destMarker.bindPopup(`<strong>Destination:</strong><br>${name}`);
}

function renderBreadcrumbs(crumbs) {
    if (!viewerMap) return;
    const latLngs = crumbs.map(c => [c.latitude, c.longitude]);
    if (!breadcrumbPolyline) {
        breadcrumbPolyline = L.polyline(latLngs, {
            color: '#3b82f6',
            weight: 4,
            opacity: 0.6,
            dashArray: '4, 4'
        }).addTo(viewerMap);
    } else {
        breadcrumbPolyline.setLatLngs(latLngs);
    }
}

function recenterViewerMap() {
    if (travelerMarker && viewerMap) {
        viewerMap.setView(travelerMarker.getLatLng(), 16);
    }
}

function fitViewerRoute() {
    if (!viewerMap) return;
    const group = [];
    if (travelerMarker) group.push(travelerMarker);
    if (destMarker) group.push(destMarker);
    if (breadcrumbPolyline) group.push(breadcrumbPolyline);

    if (group.length > 0) {
        viewerMap.fitBounds(L.featureGroup(group).getBounds(), { padding: [60, 60] });
    }
}

function handleExpiredViewerSession() {
    if (viewerPollTimer) clearInterval(viewerPollTimer);
    window.location.reload();
}

function calculateHaversineMeters(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = 
        Math.sin(dLat/2) * Math.sin(dLat/2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
        Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}

function playViewerAlarm() {
    try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!AudioContext) return;
        const ctx = new AudioContext();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(800, ctx.currentTime);
        osc.frequency.linearRampToValueAtTime(400, ctx.currentTime + 0.3);

        gain.gain.setValueAtTime(0.4, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.6);

        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.6);
    } catch (e) {
        console.warn(e);
    }
}
