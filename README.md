# Live Location Tracking and Journey Safety System
**Academic / Final-Year College Project**

---

## 📌 1. Project Overview & Objective

The **Live Location Tracking and Journey Safety System** is a full-stack web application designed to empower individuals (such as college students, daily commuters, and solo travelers) to voluntarily monitor and share their journeys with designated trusted contacts in real time.

The system incorporates:
- **Voluntary Live GPS Streaming**: Real-time position updates via the browser HTML5 Geolocation API with clear start/stop controls.
- **Smart Geofenced Destination Tracking**: Dynamic route calculation, distance/duration telemetry via OSRM, and automatic arrival detection upon crossing a configurable geofence boundary (50m – 500m).
- **Proactive Journey Delay Warnings**: Automated detection and alerting if arrival exceeds the expected estimated window.
- **Deliberate SOS Emergency Broadcast**: A two-step confirmed emergency trigger that dispatches the user's exact coordinates, timestamp, and interactive map links to trusted emergency contacts.
- **Revocable & Time-Expiring Sharing Links**: Secure token-based links for authorized viewers that can be revoked on-demand with zero plaintext privacy leaks.
- **Realtime Sync & Cloud Integration**: Ready for Firebase Realtime Database synchronization and Firebase Authentication, with automatic standalone SQLite local storage fallback.

---

## 🛠️ 2. Technology Stack

| Layer | Technologies |
|---|---|
| **Frontend** | Semantic HTML5, CSS3 (Modern Glassmorphism & Responsive Grid), Vanilla JavaScript (ES6+) |
| **Mapping & GIS** | [Leaflet.js](https://leafletjs.com/) v1.9.4 with OpenStreetMap tiles & OSRM (Open Source Routing Machine) |
| **Backend** | Python Flask (REST API, Session Security, Geocoding Proxy) |
| **Database** | SQLite3 (Built-in, zero-config local engine) + Firebase Realtime Database (Cloud Sync) |
| **Authentication** | Passwords hashed using `werkzeug.security` (PBKDF2/SHA256) + Firebase Auth integration |
| **Sensors & APIs** | Browser Geolocation API (`watchPosition`), HTML5 Notification API, Web Audio API |

---

## 🏗️ 3. Architecture & Database Design

### Database Entities (Relational Schema)
1. **`users`**:
   - `id`, `firebase_uid`, `email`, `name`, `password_hash`, `phone`, `created_at`
2. **`trusted_contacts`**:
   - `id`, `user_id` (FK), `name`, `phone`, `email`, `relationship`, `notify_sos`, `notify_delay`, `created_at`
3. **`journeys`**:
   - `id`, `user_id` (FK), `origin_name`, `origin_lat`, `origin_lng`, `dest_name`, `dest_lat`, `dest_lng`, `geofence_radius`, `distance_km`, `expected_arrival`, `status`, `started_at`, `completed_at`, `arrival_notified`, `delay_notified`
4. **`active_locations`**:
   - `id`, `user_id` (Unique FK), `journey_id`, `latitude`, `longitude`, `accuracy`, `speed`, `heading`, `is_sharing`, `updated_at`
5. **`location_history`**:
   - `id`, `user_id` (FK), `journey_id`, `latitude`, `longitude`, `accuracy`, `speed`, `recorded_at`
6. **`sharing_sessions`**:
   - `id`, `user_id` (FK), `journey_id`, `token` (Unique URL-safe), `is_active`, `expires_at`, `created_at`
7. **`emergency_alerts`**:
   - `id`, `user_id` (FK), `journey_id`, `latitude`, `longitude`, `accuracy`, `message`, `map_link`, `status` (`ACTIVE`/`RESOLVED`), `created_at`, `resolved_at`

### Firebase Realtime Database Security Rules (`database.rules.json`)
The application implements strict Firebase security rules:
- Users can only read and write their own profile and private contacts.
- Location feeds are only readable by the owner or authorized holders of an active sharing token.
- Emergency alerts can be written only by authenticated users and read by trusted viewers.

---

## 🚀 4. Quick Start & Setup Instructions

### Prerequisites
- Python 3.9+ installed on your system.

### Option A: One-Click Startup (Windows)
Double-click `run.bat` in the project root directory. It will install all dependencies and launch the server automatically.

### Option B: Manual Command Line Startup

1. **Navigate to the project directory:**
   ```bash
   cd live_location_safety_system
   ```

2. **Install Python dependencies:**
   ```bash
   pip install -r requirements.txt
   ```

3. **Run the Flask server:**
   ```bash
   python app.py
   ```

4. **Access the Web Application:**
   Open your browser and navigate to:
   ```
   http://127.0.0.1:5000
   ```

---

## 🔒 5. Privacy, Ethics & Security Features

1. **Voluntary Tracking**: Location updates are never initiated silently. Tracking only starts when the user clicks **Start Sharing** and approves the browser's permission dialog.
2. **Instant Revocation**: Clicking **Stop Sharing** immediately executes `navigator.geolocation.clearWatch()`, halting GPS polls and setting backend sharing status to inactive.
3. **Authorized Viewers Only**: Public tracking links (`/track/<token>`) use cryptographically strong, 128-bit URL-safe tokens with expiration windows. Passwords and contact lists are never exposed to viewers.
4. **Deliberate SOS**: Emergency SOS activation requires a deliberate confirmation modal to avoid false alarms.
5. **Clear Legal Disclaimers**: The app explicitly informs users that the SOS system dispatches notifications to personal trusted contacts and does not automatically dial 911 or government dispatch.

---

## 🧪 6. Testing & Demonstration Guide (For College Evaluation)

When demonstrating in an indoor college lab or classroom where physical GPS movement is not practical, use the built-in **Lab Demo & Testing Utility**:

1. **Register / Login**: Register a new user account (e.g. `student@college.edu`).
2. **Add a Trusted Contact**: Click **Add Contact** in the dashboard to register a family member or peer.
3. **Set a Destination**:
   - Search for a landmark (e.g., "Library", "Central Park", or any campus building), or **click directly on the Leaflet map** to pin a destination.
   - Set an expected arrival time.
   - Click **Start Monitored Journey**. The road route polyline and geofence circle will render instantly.
4. **Test Live Sharing Link**:
   - Click **Generate Sharing Link** in the Live Sharing Session card.
   - Copy the generated URL and open it in an **Incognito Window** or on a mobile phone.
   - Notice the viewer map displays the traveler's coordinates, breadcrumbs, destination, and ETA in real time.
5. **Run the Route Movement Simulation**:
   - In the **Lab Demo & Testing Utility** card on the dashboard, click **Simulate Movement Along Route**.
   - Watch the pulsing marker advance automatically along the road route.
   - Alternatively, click **Simulate Geofence Arrival** to immediately position within 10 meters of the destination.
   - Observe the **Destination Reached!** browser notification, pleasant chime sound, and journey completion status change!
6. **Test the Emergency SOS Feature**:
   - Click the prominent red **SOS EMERGENCY** button in the top navigation bar.
   - Confirm the deliberate modal.
   - Notice the urgent alarm sound, the dashboard emergency warning banner, and the viewer page instantly flashing a high-priority red alert banner with a Google Maps coordinate link!
   - Click **Mark Safe / Resolve SOS** to return to normal status.

---

## 📂 7. Project Structure

```
live_location_safety_system/
├── app.py                      # Flask REST API server, session management, and routing
├── config.py                   # App configuration, database paths & constants
├── models.py                   # SQLite relational database layer & Haversine distance engine
├── firebase_service.py         # Firebase Admin SDK & Realtime Database sync helper
├── database.rules.json         # Firebase Realtime Database Security Rules
├── requirements.txt            # Python dependencies
├── run.bat                     # Windows one-click launcher
├── run.sh                      # Linux/Mac launcher
├── README.md                   # Project documentation
│
├── static/
│   ├── css/
│   │   └── style.css           # Modern CSS3 stylesheet, animations, and responsive layouts
│   └── js/
│       ├── app.js              # Dashboard controller & API integrations
│       ├── tracking.js         # Leaflet map manager, Geolocation API, & route simulator
│       ├── viewer.js           # Authorized viewer tracking controller
│       ├── notifications.js    # Browser notifications & Web Audio synthesizers
│       ├── firebase_config.js  # Firebase Web SDK initialization
│       └── auth.js             # Authentication modal & validation logic
│
└── templates/
    ├── index.html              # Landing page with project highlights & auth modal
    ├── dashboard.html          # Main User Dashboard
    ├── track.html              # Authorized Shared Viewer page
    └── error.html              # Expired/invalid link error page
```

---

*Developed for Academic Final-Year Project Presentation & Safety Innovation.*
