/**
 * Dashboard Frontend Controller
 * Connects UI interactions with backend REST APIs and map components.
 */

// Selected Destination Coordinates
let selectedDest = null;
let currentActiveJourney = null;

document.addEventListener('DOMContentLoaded', () => {
    // 1. Initialize Map with default view
    initTrackingMap();

    // 2. Check Browser Notifications
    checkNotificationPermission();

    // 3. Prompt user for voluntary initial position
    if ("geolocation" in navigator) {
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                const lat = pos.coords.latitude;
                const lng = pos.coords.longitude;
                lastKnownPosition = { lat, lng, accuracy: pos.coords.accuracy, speed: 0 };
                renderUserOnMap(lat, lng, pos.coords.accuracy);
                if (mapInstance) mapInstance.setView([lat, lng], 15);
                updateTelemetryUI(lat, lng, pos.coords.accuracy, 0);
            },
            (err) => console.log("Initial position prompt dismissed or not yet granted:", err.message),
            { timeout: 8000 }
        );
    }

    // 4. Load initial data from APIs
    loadActiveJourney();
    loadActiveShareSession();
    loadTrustedContacts();
    checkActiveSos();
    loadJourneyHistory();

    // Setup input search debouncing
    const searchInput = document.getElementById('destSearchInput');
    if (searchInput) {
        let debounceTimer;
        searchInput.addEventListener('input', () => {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                triggerGeocodeSearch();
            }, 450);
        });
    }

    // Auto-calculate suggested ETA (+30 mins from now)
    const etaInput = document.getElementById('expectedArrivalTime');
    if (etaInput) {
        const d = new Date(Date.now() + 30 * 60000);
        const hours = String(d.getHours()).padStart(2, '0');
        const minutes = String(d.getMinutes()).padStart(2, '0');
        etaInput.value = `${hours}:${minutes}`;
    }
});

// ----------------- DESTINATION GEOCODING & SELECTION ----------------- //

/**
 * Handle direct map click to set destination
 */
function handleMapClickDestination(lat, lng) {
    selectedDest = {
        name: `Location (${lat.toFixed(4)}, ${lng.toFixed(4)})`,
        lat: lat,
        lng: lng
    };

    const destInput = document.getElementById('destSearchInput');
    if (destInput) destInput.value = selectedDest.name;

    const radius = parseInt(document.getElementById('geofenceRadius').value) || 100;
    setDestinationOnMap(lat, lng, selectedDest.name, radius);
    showToast(`Destination pinned at [${lat.toFixed(4)}, ${lng.toFixed(4)}]`, "info");
}

/**
 * Search location via OpenStreetMap Nominatim proxy
 */
async function triggerGeocodeSearch() {
    const input = document.getElementById('destSearchInput');
    const dropdown = document.getElementById('searchSuggestions');
    if (!input || !dropdown) return;

    const query = input.value.trim();
    if (query.length < 3) {
        dropdown.classList.add('hidden');
        return;
    }

    try {
        const resp = await fetch(`/api/geo/search?q=${encodeURIComponent(query)}`);
        if (!resp.ok) return;

        const results = await resp.json();
        dropdown.innerHTML = '';

        if (results.length === 0) {
            dropdown.innerHTML = '<div class="search-item">No matches found. Try another query or click directly on map.</div>';
            dropdown.classList.remove('hidden');
            return;
        }

        results.forEach(item => {
            const div = document.createElement('div');
            div.className = 'search-item';
            div.innerHTML = `<i class="fa-solid fa-location-dot"></i> <div><strong>${item.display_name.split(',')[0]}</strong><br><small style="color:#64748b;">${item.display_name}</small></div>`;
            div.onclick = () => {
                selectedDest = {
                    name: item.display_name.split(',')[0],
                    lat: parseFloat(item.lat),
                    lng: parseFloat(item.lon)
                };
                input.value = selectedDest.name;
                dropdown.classList.add('hidden');

                const radius = parseInt(document.getElementById('geofenceRadius').value) || 100;
                setDestinationOnMap(selectedDest.lat, selectedDest.lng, selectedDest.name, radius);
            };
            dropdown.appendChild(div);
        });

        dropdown.classList.remove('hidden');
    } catch (e) {
        console.warn("Geocoding failed:", e);
    }
}

// Close suggestions on outside click
document.addEventListener('click', (e) => {
    const dropdown = document.getElementById('searchSuggestions');
    const input = document.getElementById('destSearchInput');
    if (dropdown && !dropdown.contains(e.target) && e.target !== input) {
        dropdown.classList.add('hidden');
    }
});

// ----------------- JOURNEY MANAGEMENT ----------------- //

/**
 * Start a new monitored journey
 */
async function handleStartJourney(event) {
    event.preventDefault();

    if (!selectedDest) {
        showToast("Please search for a destination or click on the map.", "error");
        return;
    }

    const radius = parseInt(document.getElementById('geofenceRadius').value) || 100;
    const timeVal = document.getElementById('expectedArrivalTime').value;

    // Convert time to full today's datetime string: 'YYYY-MM-DD HH:MM:00'
    const today = new Date().toISOString().split('T')[0];
    const expectedArrivalStr = timeVal ? `${today} ${timeVal}:00` : null;

    const payload = {
        dest_name: selectedDest.name,
        dest_lat: selectedDest.lat,
        dest_lng: selectedDest.lng,
        origin_lat: lastKnownPosition ? lastKnownPosition.lat : null,
        origin_lng: lastKnownPosition ? lastKnownPosition.lng : null,
        geofence_radius: radius,
        expected_arrival: expectedArrivalStr
    };

    try {
        const resp = await fetch('/api/journey/start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await resp.json();
        if (resp.ok) {
            showToast("Journey started! Real-time safety monitoring active.", "success");
            
            // Automatically ensure tracking is active
            if (!isTrackingActive) {
                startTrackingAndSharing();
            }

            // Update UI with active journey
            displayActiveJourneyWidget(data.journey);
            loadActiveShareSession();
            loadJourneyHistory();
        } else {
            showToast(data.error || "Failed to start journey", "error");
        }
    } catch (err) {
        console.error("Error starting journey:", err);
        showToast("Network error starting journey.", "error");
    }
}

/**
 * Load Active Journey
 */
async function loadActiveJourney() {
    try {
        const resp = await fetch('/api/journey/active');
        if (!resp.ok) return;

        const data = await resp.json();
        if (data.journey) {
            currentActiveJourney = data.journey;
            selectedDest = {
                name: data.journey.dest_name,
                lat: data.journey.dest_lat,
                lng: data.journey.dest_lng
            };
            setDestinationOnMap(data.journey.dest_lat, data.journey.dest_lng, data.journey.dest_name, data.journey.geofence_radius);
            displayActiveJourneyWidget(data.journey);
        } else {
            hideActiveJourneyWidget();
        }
    } catch (err) {
        console.warn("Could not check active journey:", err);
    }
}

function displayActiveJourneyWidget(journey) {
    const widget = document.getElementById('floatingJourneyWidget');
    const title = document.getElementById('widgetDestName');
    const badge = document.getElementById('widgetStatusBadge');
    const eta = document.getElementById('widgetEta');

    if (!widget) return;

    if (title) title.innerText = journey.dest_name;
    if (badge) {
        badge.className = `badge-status status-${journey.status.toLowerCase().replace(' ', '-')}`;
        badge.innerText = journey.status;
    }
    if (eta && journey.expected_arrival) {
        const timePart = journey.expected_arrival.split(' ')[1] || journey.expected_arrival;
        eta.innerText = timePart.substring(0, 5);
    }

    widget.classList.remove('hidden');
}

function hideActiveJourneyWidget() {
    const widget = document.getElementById('floatingJourneyWidget');
    if (widget) widget.classList.add('hidden');
}

/**
 * Complete Journey Manually
 */
async function markJourneyCompleted() {
    try {
        const resp = await fetch('/api/journey/complete', { method: 'POST' });
        if (resp.ok) {
            showToast("Journey marked as completed. Thank you for traveling safely!", "success");
            playChimeSound('arrival');
            hideActiveJourneyWidget();
            loadJourneyHistory();
        }
    } catch (e) {
        console.error(e);
    }
}

/**
 * Cancel Journey
 */
async function cancelCurrentJourney() {
    if (!confirm("Are you sure you want to cancel the current journey?")) return;
    try {
        const resp = await fetch('/api/journey/cancel', { method: 'POST' });
        if (resp.ok) {
            showToast("Journey cancelled.", "info");
            hideActiveJourneyWidget();
            loadJourneyHistory();
        }
    } catch (e) {
        console.error(e);
    }
}

// ----------------- SHARING SESSIONS ----------------- //

async function generateShareSession() {
    try {
        const resp = await fetch('/api/sharing/create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ duration_hours: 4 })
        });
        const data = await resp.json();
        if (resp.ok) {
            showToast("New temporary sharing link generated!", "success");
            displayShareSession(data.share_url, data.session.expires_at);
        }
    } catch (e) {
        showToast("Error generating sharing link", "error");
    }
}

async function loadActiveShareSession() {
    try {
        const resp = await fetch('/api/sharing/active');
        if (!resp.ok) return;
        const data = await resp.json();
        if (data.session && data.share_url) {
            displayShareSession(data.share_url, data.session.expires_at);
        } else {
            hideShareSession();
        }
    } catch (e) {
        console.warn(e);
    }
}

function displayShareSession(url, expiresAt) {
    const inactive = document.getElementById('sharingInactiveState');
    const active = document.getElementById('sharingActiveState');
    const input = document.getElementById('shareUrlInput');
    const expires = document.getElementById('shareExpiresVal');

    if (inactive) inactive.classList.add('hidden');
    if (active) active.classList.remove('hidden');
    if (input) input.value = url;
    if (expires && expiresAt) {
        expires.innerText = new Date(expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
}

function hideShareSession() {
    const inactive = document.getElementById('sharingInactiveState');
    const active = document.getElementById('sharingActiveState');
    if (inactive) inactive.classList.remove('hidden');
    if (active) active.classList.add('hidden');
}

function copyShareLink() {
    const input = document.getElementById('shareUrlInput');
    if (input && input.value) {
        navigator.clipboard.writeText(input.value).then(() => {
            showToast("Share link copied to clipboard!", "success");
        }).catch(() => {
            input.select();
            document.execCommand('copy');
            showToast("Share link copied!", "success");
        });
    }
}

async function revokeShareSession() {
    if (!confirm("Are you sure you want to revoke this sharing link? Anyone with the link will instantly lose access.")) return;
    try {
        const resp = await fetch('/api/sharing/revoke', { method: 'POST' });
        if (resp.ok) {
            showToast("Sharing access revoked.", "info");
            hideShareSession();
        }
    } catch (e) {
        showToast("Error revoking link", "error");
    }
}

// ----------------- TRUSTED CONTACTS ----------------- //

async function loadTrustedContacts() {
    const list = document.getElementById('contactsList');
    if (!list) return;

    try {
        const resp = await fetch('/api/contacts');
        if (!resp.ok) return;

        const data = await resp.json();
        const contacts = data.contacts || [];

        if (contacts.length === 0) {
            list.innerHTML = `<div class="loading-spinner"><i class="fa-solid fa-user-plus"></i> No trusted contacts added yet. Add family or friends to notify them during journeys or emergency.</div>`;
            return;
        }

        list.innerHTML = '';
        contacts.forEach(c => {
            const div = document.createElement('div');
            div.className = 'contact-card';
            div.innerHTML = `
                <div class="contact-info">
                    <h5>${c.name} <small style="color:#64748b; font-weight:normal;">(${c.relationship})</small></h5>
                    <div class="contact-details">
                        <span><i class="fa-solid fa-phone"></i> ${c.phone}</span>
                        <span><i class="fa-solid fa-envelope"></i> ${c.email}</span>
                    </div>
                    <div class="contact-badges">
                        ${c.notify_sos ? '<span class="badge-micro badge-sos"><i class="fa-solid fa-triangle-exclamation"></i> SOS Alerts</span>' : ''}
                        ${c.notify_delay ? '<span class="badge-micro badge-delay"><i class="fa-solid fa-clock"></i> Delay Alerts</span>' : ''}
                    </div>
                </div>
                <button class="btn-delete-contact" onclick="deleteContact(${c.id})" title="Delete Contact">
                    <i class="fa-solid fa-trash-can"></i>
                </button>
            `;
            list.appendChild(div);
        });
    } catch (e) {
        console.warn("Error loading contacts:", e);
    }
}

function openAddContactModal() {
    const modal = document.getElementById('contactModal');
    if (modal) modal.classList.remove('hidden');
}

function closeContactModal() {
    const modal = document.getElementById('contactModal');
    if (modal) modal.classList.add('hidden');
}

async function handleAddContact(event) {
    event.preventDefault();
    const name = document.getElementById('contactName').value;
    const phone = document.getElementById('contactPhone').value;
    const email = document.getElementById('contactEmail').value;
    const relationship = document.getElementById('contactRelation').value;
    const notifySos = document.getElementById('contactNotifySos').checked;
    const notifyDelay = document.getElementById('contactNotifyDelay').checked;

    try {
        const resp = await fetch('/api/contacts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name, phone, email, relationship,
                notify_sos: notifySos,
                notify_delay: notifyDelay
            })
        });

        if (resp.ok) {
            showToast("Trusted contact added successfully!", "success");
            closeContactModal();
            document.getElementById('addContactForm').reset();
            loadTrustedContacts();
        } else {
            const data = await resp.json();
            showToast(data.error || "Failed to add contact", "error");
        }
    } catch (e) {
        showToast("Error adding contact", "error");
    }
}

async function deleteContact(id) {
    if (!confirm("Remove this trusted contact?")) return;
    try {
        const resp = await fetch(`/api/contacts/${id}`, { method: 'DELETE' });
        if (resp.ok) {
            showToast("Contact removed.", "info");
            loadTrustedContacts();
        }
    } catch (e) {
        showToast("Error deleting contact", "error");
    }
}

// ----------------- EMERGENCY SOS ----------------- //

function openSosModal() {
    const modal = document.getElementById('sosModal');
    if (modal) modal.classList.remove('hidden');
}

function closeSosModal() {
    const modal = document.getElementById('sosModal');
    if (modal) modal.classList.add('hidden');
}

/**
 * Execute deliberate confirmed SOS dispatch
 */
async function executeSosTrigger() {
    closeSosModal();
    playChimeSound('sos');

    const msg = document.getElementById('sosCustomMessage').value || "EMERGENCY! I need immediate help.";

    const payload = {
        latitude: lastKnownPosition ? lastKnownPosition.lat : null,
        longitude: lastKnownPosition ? lastKnownPosition.lng : null,
        accuracy: lastKnownPosition ? lastKnownPosition.accuracy : null,
        message: msg
    };

    try {
        const resp = await fetch('/api/sos/trigger', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await resp.json();
        if (resp.ok) {
            showToast("🚨 EMERGENCY SOS BROADCASTED TO CONTACTS!", "error");
            showBrowserNotification("🚨 EMERGENCY SOS ACTIVE", "Dispatched to registered contacts: " + (data.dispatched_to.join(', ') || 'No contacts registered!'), { type: 'error' });
            
            // Show prominent active SOS banner
            const banner = document.getElementById('activeSosBanner');
            if (banner) banner.classList.remove('hidden');
        } else {
            showToast(data.error || "Failed to trigger SOS", "error");
        }
    } catch (e) {
        showToast("Error triggering SOS", "error");
    }
}

async function checkActiveSos() {
    try {
        const resp = await fetch('/api/sos/active');
        if (!resp.ok) return;
        const data = await resp.json();
        const banner = document.getElementById('activeSosBanner');
        if (data.active_alert && banner) {
            banner.classList.remove('hidden');
        } else if (banner) {
            banner.classList.add('hidden');
        }
    } catch (e) {
        console.warn(e);
    }
}

async function resolveActiveSos() {
    if (!confirm("Are you safe now? This will mark the active SOS emergency as resolved.")) return;
    try {
        const resp = await fetch('/api/sos/resolve', { method: 'POST' });
        if (resp.ok) {
            showToast("Emergency alert resolved. Glad you are safe!", "success");
            const banner = document.getElementById('activeSosBanner');
            if (banner) banner.classList.add('hidden');
        }
    } catch (e) {
        showToast("Error resolving SOS", "error");
    }
}

// ----------------- JOURNEY HISTORY ----------------- //

async function loadJourneyHistory() {
    const list = document.getElementById('journeyHistoryList');
    if (!list) return;

    try {
        const resp = await fetch('/api/journey/history');
        if (!resp.ok) return;

        const data = await resp.json();
        const history = data.history || [];

        if (history.length === 0) {
            list.innerHTML = `<div class="loading-spinner">No completed journeys recorded yet.</div>`;
            return;
        }

        list.innerHTML = '';
        history.forEach(j => {
            const div = document.createElement('div');
            div.className = 'history-item';
            div.innerHTML = `
                <div>
                    <div class="hist-dest"><i class="fa-solid fa-location-dot"></i> ${j.dest_name}</div>
                    <div class="hist-time">${j.started_at ? j.started_at.substring(0, 16) : 'Recent'}</div>
                </div>
                <span class="badge-status status-${j.status.toLowerCase().replace(' ', '-')}">${j.status}</span>
            `;
            list.appendChild(div);
        });
    } catch (e) {
        console.warn(e);
    }
}
