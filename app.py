import os
import secrets
from datetime import datetime
from functools import wraps
from flask import Flask, render_template, request, jsonify, session, redirect, url_for
from flask_cors import CORS
import requests

from config import Config
import models
import firebase_service

app = Flask(__name__)
app.config.from_object(Config)
CORS(app)

# Initialize Database and Firebase
models.init_db()
firebase_service.init_firebase()

# ----------------- AUTH DECORATOR ----------------- #
def login_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        user_id = session.get('user_id')
        if not user_id:
            if request.is_json or request.path.startswith('/api/'):
                return jsonify({'error': 'Unauthorized', 'message': 'Authentication required'}), 401
            return redirect(url_for('index', login=1))
        user = models.get_user_by_id(user_id)
        if not user:
            session.pop('user_id', None)
            return jsonify({'error': 'User not found'}), 401
        return f(*args, **kwargs)
    return decorated_function

# ----------------- PAGE ROUTES ----------------- #
@app.route('/')
def index():
    if session.get('user_id'):
        return redirect(url_for('dashboard'))
    return render_template('index.html')

@app.route('/dashboard')
@login_required
def dashboard():
    user = models.get_user_by_id(session['user_id'])
    return render_template('dashboard.html', user=user)

@app.route('/track/<token>')
def track_viewer(token):
    session_data = models.get_sharing_session_by_token(token)
    if not session_data or not session_data.get('is_active'):
        return render_template('error.html', 
                               title="Sharing Link Expired or Invalid", 
                               message="This live tracking session is either expired, revoked by the user, or invalid."), 404
    
    user = models.get_user_by_id(session_data['user_id'])
    return render_template('track.html', token=token, shared_user=user)

# ----------------- AUTHENTICATION APIS ----------------- #
@app.route('/api/auth/register', methods=['POST'])
def register():
    data = request.get_json() or {}
    email = data.get('email', '').strip()
    password = data.get('password', '')
    name = data.get('name', '').strip()
    phone = data.get('phone', '').strip()

    if not email or not password or not name:
        return jsonify({'error': 'Name, email, and password are required'}), 400
    
    if len(password) < 6:
        return jsonify({'error': 'Password must be at least 6 characters'}), 400

    existing = models.get_user_by_email(email)
    if existing:
        return jsonify({'error': 'An account with this email already exists'}), 409

    user = models.create_user(email=email, name=name, password=password, phone=phone)
    if not user:
        return jsonify({'error': 'Failed to create account'}), 500

    session['user_id'] = user['id']
    return jsonify({
        'message': 'Registration successful',
        'user': {'id': user['id'], 'name': user['name'], 'email': user['email'], 'phone': user.get('phone')}
    }), 201

@app.route('/api/auth/login', methods=['POST'])
def login():
    data = request.get_json() or {}
    email = data.get('email', '').strip()
    password = data.get('password', '')

    if not email or not password:
        return jsonify({'error': 'Email and password are required'}), 400

    user = models.verify_user_login(email, password)
    if not user:
        return jsonify({'error': 'Invalid email or password'}), 401

    session['user_id'] = user['id']
    return jsonify({
        'message': 'Login successful',
        'user': {'id': user['id'], 'name': user['name'], 'email': user['email'], 'phone': user.get('phone')}
    })

@app.route('/api/auth/firebase-login', methods=['POST'])
def firebase_login():
    """
    Allows seamless login from Firebase Web SDK.
    Verifies token with Firebase Admin if configured, or links/registers user.
    """
    data = request.get_json() or {}
    id_token = data.get('idToken')
    email = data.get('email')
    name = data.get('name', 'Firebase User')
    uid = data.get('uid')

    if not email or not uid:
        return jsonify({'error': 'Email and UID required'}), 400

    # If backend firebase-admin is loaded, verify token
    if firebase_service.is_firebase_active() and id_token:
        decoded = firebase_service.verify_firebase_id_token(id_token)
        if not decoded:
            return jsonify({'error': 'Invalid Firebase ID token'}), 401
        email = decoded.get('email', email)
        uid = decoded.get('uid', uid)
        name = decoded.get('name', name)

    # Find or create user
    user = models.get_user_by_firebase_uid(uid)
    if not user:
        user = models.get_user_by_email(email)
        if not user:
            user = models.create_user(email=email, name=name, firebase_uid=uid)
    
    if user:
        session['user_id'] = user['id']
        return jsonify({
            'message': 'Firebase authentication successful',
            'user': {'id': user['id'], 'name': user['name'], 'email': user['email']}
        })
    return jsonify({'error': 'Could not process Firebase user'}), 500

@app.route('/api/auth/logout', methods=['POST', 'GET'])
def logout():
    session.pop('user_id', None)
    if request.is_json:
        return jsonify({'message': 'Logged out successfully'})
    return redirect(url_for('index'))

@app.route('/api/auth/me', methods=['GET'])
@login_required
def me():
    user = models.get_user_by_id(session['user_id'])
    return jsonify({
        'id': user['id'],
        'name': user['name'],
        'email': user['email'],
        'phone': user.get('phone')
    })

# ----------------- LOCATION TRACKING APIS ----------------- #
@app.route('/api/location/update', methods=['POST'])
@login_required
def update_location():
    user_id = session['user_id']
    data = request.get_json() or {}
    
    lat = data.get('latitude')
    lng = data.get('longitude')
    accuracy = data.get('accuracy')
    speed = data.get('speed')
    heading = data.get('heading')
    is_sharing = 1 if data.get('is_sharing', True) else 0

    if lat is None or lng is None:
        return jsonify({'error': 'Latitude and longitude are required'}), 400

    try:
        lat = float(lat)
        lng = float(lng)
    except (ValueError, TypeError):
        return jsonify({'error': 'Invalid coordinates'}), 400

    active_journey = models.get_active_journey(user_id)
    journey_id = active_journey['id'] if active_journey else None

    # Save to SQLite database
    loc = models.save_location(
        user_id=user_id,
        lat=lat,
        lng=lng,
        accuracy=accuracy,
        speed=speed,
        heading=heading,
        is_sharing=is_sharing,
        journey_id=journey_id
    )

    # Sync to Firebase Realtime Database if active
    firebase_service.sync_location_to_firebase(user_id, {
        'latitude': lat,
        'longitude': lng,
        'accuracy': accuracy,
        'speed': speed,
        'heading': heading,
        'is_sharing': is_sharing,
        'journey_id': journey_id,
        'updated_at': datetime.utcnow().isoformat()
    })

    # Journey checks: Geofencing Arrival & Delay check
    journey_event = None
    distance_to_dest = None

    if active_journey and active_journey['status'] in ('In Progress', 'Delayed'):
        dest_lat = float(active_journey['dest_lat'])
        dest_lng = float(active_journey['dest_lng'])
        radius = float(active_journey.get('geofence_radius') or 100)

        # Distance calculation
        distance_to_dest = models.calculate_distance_meters(lat, lng, dest_lat, dest_lng)
        
        # Check arrival
        if distance_to_dest <= radius and not active_journey.get('arrival_notified'):
            models.mark_arrival_notified(journey_id)
            journey_event = {
                'type': 'ARRIVAL',
                'title': 'Destination Reached!',
                'message': f"You have arrived safely at {active_journey['dest_name']}.",
                'journey_id': journey_id
            }
        else:
            # Check expected arrival delay
            exp_arr = active_journey.get('expected_arrival')
            if exp_arr and not active_journey.get('delay_notified'):
                try:
                    exp_dt = datetime.strptime(exp_arr, '%Y-%m-%d %H:%M:%S')
                    if datetime.utcnow() > exp_dt:
                        models.mark_delay_notified(journey_id)
                        journey_event = {
                            'type': 'DELAY',
                            'title': 'Journey Delay Detected',
                            'message': f"Expected arrival was {exp_arr}. Your contacts will be alerted of the delay.",
                            'journey_id': journey_id
                        }
                except Exception:
                    pass

    return jsonify({
        'success': True,
        'location': loc,
        'distance_to_dest_meters': round(distance_to_dest, 1) if distance_to_dest is not None else None,
        'journey_event': journey_event
    })

@app.route('/api/location/toggle-sharing', methods=['POST'])
@login_required
def toggle_sharing():
    user_id = session['user_id']
    data = request.get_json() or {}
    is_sharing = 1 if data.get('is_sharing', True) else 0

    loc = models.set_sharing_status(user_id, is_sharing)
    firebase_service.sync_location_to_firebase(user_id, {'is_sharing': is_sharing})
    
    return jsonify({
        'success': True,
        'is_sharing': bool(is_sharing),
        'location': loc
    })

@app.route('/api/location/current', methods=['GET'])
@login_required
def get_current_location():
    user_id = session['user_id']
    loc = models.get_active_location(user_id)
    return jsonify({'location': loc})

# ----------------- JOURNEY TRACKING APIS ----------------- #
@app.route('/api/journey/start', methods=['POST'])
@login_required
def start_new_journey():
    user_id = session['user_id']
    data = request.get_json() or {}

    dest_name = data.get('dest_name', '').strip()
    dest_lat = data.get('dest_lat')
    dest_lng = data.get('dest_lng')
    origin_name = data.get('origin_name', 'Current Location')
    origin_lat = data.get('origin_lat')
    origin_lng = data.get('origin_lng')
    geofence_radius = int(data.get('geofence_radius', 100))
    distance_km = data.get('distance_km')
    expected_arrival = data.get('expected_arrival') # 'YYYY-MM-DD HH:MM:SS'

    if not dest_name or dest_lat is None or dest_lng is None:
        return jsonify({'error': 'Destination name and coordinates are required'}), 400

    journey = models.start_journey(
        user_id=user_id,
        dest_name=dest_name,
        dest_lat=float(dest_lat),
        dest_lng=float(dest_lng),
        origin_name=origin_name,
        origin_lat=float(origin_lat) if origin_lat else None,
        origin_lng=float(origin_lng) if origin_lng else None,
        geofence_radius=geofence_radius,
        distance_km=float(distance_km) if distance_km else None,
        expected_arrival=expected_arrival
    )

    # Ensure a sharing session exists or is refreshed for this journey
    sharing = models.get_active_sharing_session(user_id)
    if not sharing:
        sharing = models.create_sharing_session(user_id, journey_id=journey['id'], duration_hours=6)

    return jsonify({
        'message': 'Journey started successfully',
        'journey': journey,
        'share_token': sharing['token'],
        'share_url': url_for('track_viewer', token=sharing['token'], _external=True)
    }), 201

@app.route('/api/journey/active', methods=['GET'])
@login_required
def get_user_active_journey():
    user_id = session['user_id']
    journey = models.get_active_journey(user_id)
    sharing = models.get_active_sharing_session(user_id)
    active_loc = models.get_active_location(user_id)
    
    distance_remaining = None
    if journey and active_loc:
        distance_remaining = models.calculate_distance_meters(
            active_loc['latitude'], active_loc['longitude'],
            journey['dest_lat'], journey['dest_lng']
        )

    return jsonify({
        'journey': journey,
        'share_token': sharing['token'] if sharing else None,
        'share_url': url_for('track_viewer', token=sharing['token'], _external=True) if sharing else None,
        'distance_remaining_meters': round(distance_remaining, 1) if distance_remaining is not None else None
    })

@app.route('/api/journey/complete', methods=['POST'])
@login_required
def complete_active_journey():
    user_id = session['user_id']
    journey = models.get_active_journey(user_id)
    if not journey:
        return jsonify({'error': 'No active journey found'}), 404

    updated = models.update_journey_status(journey['id'], 'Completed', completed=True)
    return jsonify({'message': 'Journey marked as completed', 'journey': updated})

@app.route('/api/journey/cancel', methods=['POST'])
@login_required
def cancel_active_journey():
    user_id = session['user_id']
    journey = models.get_active_journey(user_id)
    if not journey:
        return jsonify({'error': 'No active journey found'}), 404

    updated = models.update_journey_status(journey['id'], 'Cancelled', completed=True)
    return jsonify({'message': 'Journey cancelled', 'journey': updated})

@app.route('/api/journey/history', methods=['GET'])
@login_required
def journey_history():
    user_id = session['user_id']
    history = models.get_journey_history(user_id, limit=20)
    return jsonify({'history': history})

# ----------------- SHARING SESSIONS ----------------- #
@app.route('/api/sharing/create', methods=['POST'])
@login_required
def create_share_link():
    user_id = session['user_id']
    data = request.get_json() or {}
    duration_hours = int(data.get('duration_hours', 4))
    
    active_journey = models.get_active_journey(user_id)
    journey_id = active_journey['id'] if active_journey else None

    session_info = models.create_sharing_session(user_id, journey_id, duration_hours)
    share_url = url_for('track_viewer', token=session_info['token'], _external=True)
    
    return jsonify({
        'message': 'Share link generated',
        'session': session_info,
        'share_url': share_url
    })

@app.route('/api/sharing/active', methods=['GET'])
@login_required
def get_user_sharing_session():
    user_id = session['user_id']
    session_info = models.get_active_sharing_session(user_id)
    if session_info:
        share_url = url_for('track_viewer', token=session_info['token'], _external=True)
        return jsonify({'session': session_info, 'share_url': share_url})
    return jsonify({'session': None})

@app.route('/api/sharing/revoke', methods=['POST'])
@login_required
def revoke_share():
    user_id = session['user_id']
    session_info = models.get_active_sharing_session(user_id)
    if session_info:
        models.revoke_sharing_session(session_info['token'], user_id)
        return jsonify({'message': 'Share access revoked successfully'})
    return jsonify({'message': 'No active share session found'})

# ----------------- AUTHORIZED VIEWER TRACKING API ----------------- #
@app.route('/api/public/track/<token>', methods=['GET'])
def get_public_tracking_data(token):
    session_info = models.get_sharing_session_by_token(token)
    if not session_info or not session_info.get('is_active'):
        return jsonify({'error': 'Tracking link is invalid or expired'}), 404

    target_user_id = session_info['user_id']
    user = models.get_user_by_id(target_user_id)
    active_loc = models.get_active_location(target_user_id)
    active_journey = models.get_active_journey(target_user_id)
    active_alert = models.get_active_emergency_alert(target_user_id)
    breadcrumbs = models.get_location_history(target_user_id, journey_id=active_journey['id'] if active_journey else None, limit=100)

    # Privacy safety: Only first name & last initial exposed to viewer
    user_display = "Anonymous"
    if user:
        parts = user['name'].split()
        user_display = parts[0] + (f" {parts[1][0]}." if len(parts) > 1 else "")

    return jsonify({
        'valid': True,
        'user_name': user_display,
        'is_sharing': bool(active_loc['is_sharing']) if active_loc else False,
        'current_location': active_loc if (active_loc and active_loc['is_sharing']) else None,
        'journey': active_journey,
        'emergency_alert': active_alert,
        'breadcrumbs': breadcrumbs if (active_loc and active_loc['is_sharing']) else [],
        'expires_at': session_info['expires_at']
    })

# ----------------- TRUSTED CONTACTS ----------------- #
@app.route('/api/contacts', methods=['GET'])
@login_required
def list_contacts():
    user_id = session['user_id']
    contacts = models.get_contacts_by_user(user_id)
    return jsonify({'contacts': contacts})

@app.route('/api/contacts', methods=['POST'])
@login_required
def create_contact():
    user_id = session['user_id']
    data = request.get_json() or {}

    name = data.get('name', '').strip()
    phone = data.get('phone', '').strip()
    email = data.get('email', '').strip()
    relationship = data.get('relationship', 'Family').strip()
    notify_sos = 1 if data.get('notify_sos', True) else 0
    notify_delay = 1 if data.get('notify_delay', True) else 0

    if not name or not phone or not email:
        return jsonify({'error': 'Name, phone, and email are required'}), 400

    contact = models.add_contact(
        user_id=user_id,
        name=name,
        phone=phone,
        email=email,
        relationship=relationship,
        notify_sos=notify_sos,
        notify_delay=notify_delay
    )
    return jsonify({'message': 'Trusted contact added', 'contact': contact}), 201

@app.route('/api/contacts/<int:contact_id>', methods=['DELETE'])
@login_required
def remove_contact(contact_id):
    user_id = session['user_id']
    models.delete_contact(contact_id, user_id)
    return jsonify({'message': 'Contact deleted successfully'})

# ----------------- SOS EMERGENCY ALERTS ----------------- #
@app.route('/api/sos/trigger', methods=['POST'])
@login_required
def trigger_sos():
    user_id = session['user_id']
    data = request.get_json() or {}

    lat = data.get('latitude')
    lng = data.get('longitude')
    accuracy = data.get('accuracy')
    message = data.get('message', 'EMERGENCY! I need immediate help. Here is my live location.')

    if lat is None or lng is None:
        loc = models.get_active_location(user_id)
        if loc:
            lat = loc['latitude']
            lng = loc['longitude']
            accuracy = loc.get('accuracy')
        else:
            return jsonify({'error': 'Current location is unavailable for SOS'}), 400

    active_journey = models.get_active_journey(user_id)
    journey_id = active_journey['id'] if active_journey else None

    alert = models.trigger_emergency_alert(
        user_id=user_id,
        lat=float(lat),
        lng=float(lng),
        accuracy=accuracy,
        journey_id=journey_id,
        message=message
    )

    # Sync to Firebase Realtime Database
    firebase_service.sync_emergency_alert_to_firebase(alert['id'], alert)

    # Fetch contacts to simulate dispatch
    contacts = models.get_contacts_by_user(user_id)
    notified_contacts = [c['name'] for c in contacts if c['notify_sos']]

    return jsonify({
        'success': True,
        'message': 'SOS alert triggered and registered successfully',
        'alert': alert,
        'dispatched_to': notified_contacts,
        'disclaimer': 'Notice: Alerts dispatched to your registered trusted contacts. Emergency government services (911/police) have NOT been called.'
    }), 201

@app.route('/api/sos/active', methods=['GET'])
@login_required
def get_active_sos():
    user_id = session['user_id']
    alert = models.get_active_emergency_alert(user_id)
    return jsonify({'active_alert': alert})

@app.route('/api/sos/resolve', methods=['POST'])
@login_required
def resolve_sos():
    user_id = session['user_id']
    data = request.get_json() or {}
    alert_id = data.get('alert_id')
    
    if not alert_id:
        active = models.get_active_emergency_alert(user_id)
        if active:
            alert_id = active['id']
            
    if alert_id:
        models.resolve_emergency_alert(alert_id, user_id)
        return jsonify({'message': 'Emergency alert marked as resolved'})
    return jsonify({'error': 'No active alert found to resolve'}), 404

# ----------------- GEOCODING & ROUTING PROXY ----------------- #
@app.route('/api/geo/search', methods=['GET'])
def search_location():
    query = request.args.get('q', '').strip()
    if not query:
        return jsonify([])
    try:
        url = "https://nominatim.openstreetmap.org/search"
        headers = {'User-Agent': 'LiveLocationSafetySystem/1.0 (CollegeProjectDemo)'}
        params = {'q': query, 'format': 'json', 'limit': 5, 'addressdetails': 1}
        resp = requests.get(url, headers=headers, params=params, timeout=5)
        if resp.status_code == 200:
            return jsonify(resp.json())
    except Exception as e:
        app.logger.error(f"Geocoding error: {e}")
    return jsonify([])

@app.route('/api/geo/route', methods=['GET'])
def get_route():
    try:
        start_lat = request.args.get('start_lat')
        start_lng = request.args.get('start_lng')
        dest_lat = request.args.get('dest_lat')
        dest_lng = request.args.get('dest_lng')

        if not all([start_lat, start_lng, dest_lat, dest_lng]):
            return jsonify({'error': 'Missing coordinates'}), 400

        # Call public OSRM routing server
        osrm_url = f"https://router.project-osrm.org/route/v1/driving/{start_lng},{start_lat};{dest_lng},{dest_lat}?overview=full&geometries=geojson"
        resp = requests.get(osrm_url, timeout=5)
        if resp.status_code == 200:
            data = resp.json()
            if data.get('routes') and len(data['routes']) > 0:
                route = data['routes'][0]
                return jsonify({
                    'coordinates': route['geometry']['coordinates'], # [[lng, lat], ...]
                    'distance_meters': route['distance'],
                    'duration_seconds': route['duration']
                })
    except Exception as e:
        app.logger.error(f"Routing error: {e}")
    return jsonify({'coordinates': [], 'distance_meters': None, 'duration_seconds': None})

if __name__ == '__main__':
    print("=" * 60)
    print(" Live Location Tracking and Journey Safety System ")
    print(" Server running on http://127.0.0.1:5000")
    print("=" * 60)
    app.run(debug=True, host='0.0.0.0', port=5000)
