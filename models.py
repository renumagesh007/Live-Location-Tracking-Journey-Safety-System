import sqlite3
import secrets
import math
from datetime import datetime, timedelta
from werkzeug.security import generate_password_hash, check_password_hash
from config import Config

def get_db():
    conn = sqlite3.connect(Config.DATABASE_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")
    return conn

def init_db():
    conn = get_db()
    cursor = conn.cursor()
    
    # Users table
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        firebase_uid TEXT UNIQUE,
        email TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        password_hash TEXT,
        phone TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
    ''')
    
    # Trusted contacts table
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS trusted_contacts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        phone TEXT NOT NULL,
        email TEXT NOT NULL,
        relationship TEXT DEFAULT 'Family',
        notify_sos INTEGER DEFAULT 1,
        notify_delay INTEGER DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
    ''')
    
    # Journeys table
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS journeys (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        origin_name TEXT,
        origin_lat REAL,
        origin_lng REAL,
        dest_name TEXT NOT NULL,
        dest_lat REAL NOT NULL,
        dest_lng REAL NOT NULL,
        geofence_radius INTEGER DEFAULT 100,
        distance_km REAL,
        expected_arrival TEXT,
        status TEXT DEFAULT 'In Progress',
        started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        completed_at TIMESTAMP,
        arrival_notified INTEGER DEFAULT 0,
        delay_notified INTEGER DEFAULT 0,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
    ''')
    
    # Active latest location for each user
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS active_locations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER UNIQUE NOT NULL,
        journey_id INTEGER,
        latitude REAL NOT NULL,
        longitude REAL NOT NULL,
        accuracy REAL,
        speed REAL,
        heading REAL,
        is_sharing INTEGER DEFAULT 1,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (journey_id) REFERENCES journeys(id) ON DELETE SET NULL
    )
    ''')
    
    # Location history breadcrumbs
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS location_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        journey_id INTEGER,
        latitude REAL NOT NULL,
        longitude REAL NOT NULL,
        accuracy REAL,
        speed REAL,
        recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (journey_id) REFERENCES journeys(id) ON DELETE SET NULL
    )
    ''')
    
    # Secure temporary sharing links
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS sharing_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        journey_id INTEGER,
        token TEXT UNIQUE NOT NULL,
        is_active INTEGER DEFAULT 1,
        expires_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (journey_id) REFERENCES journeys(id) ON DELETE SET NULL
    )
    ''')
    
    # Emergency SOS alerts
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS emergency_alerts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        journey_id INTEGER,
        latitude REAL NOT NULL,
        longitude REAL NOT NULL,
        accuracy REAL,
        message TEXT,
        map_link TEXT,
        status TEXT DEFAULT 'ACTIVE',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        resolved_at TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (journey_id) REFERENCES journeys(id) ON DELETE SET NULL
    )
    ''')
    
    conn.commit()
    conn.close()

# Distance helper (Haversine formula in meters)
def calculate_distance_meters(lat1, lon1, lat2, lon2):
    R = 6371000  # Earth's radius in meters
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)
    
    a = math.sin(delta_phi / 2.0)**2 + \
        math.cos(phi1) * math.cos(phi2) * \
        math.sin(delta_lambda / 2.0)**2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return R * c

# User Operations
def create_user(email, name, password=None, phone=None, firebase_uid=None):
    conn = get_db()
    cursor = conn.cursor()
    password_hash = generate_password_hash(password) if password else None
    try:
        cursor.execute(
            'INSERT INTO users (email, name, password_hash, phone, firebase_uid) VALUES (?, ?, ?, ?, ?)',
            (email.strip().lower(), name.strip(), password_hash, phone, firebase_uid)
        )
        conn.commit()
        user_id = cursor.lastrowid
        return get_user_by_id(user_id)
    except sqlite3.IntegrityError:
        return None
    finally:
        conn.close()

def get_user_by_email(email):
    conn = get_db()
    user = conn.execute('SELECT * FROM users WHERE LOWER(email) = ?', (email.strip().lower(),)).fetchone()
    conn.close()
    return dict(user) if user else None

def get_user_by_id(user_id):
    conn = get_db()
    user = conn.execute('SELECT * FROM users WHERE id = ?', (user_id,)).fetchone()
    conn.close()
    return dict(user) if user else None

def get_user_by_firebase_uid(uid):
    conn = get_db()
    user = conn.execute('SELECT * FROM users WHERE firebase_uid = ?', (uid,)).fetchone()
    conn.close()
    return dict(user) if user else None

def verify_user_login(email, password):
    user = get_user_by_email(email)
    if user and user.get('password_hash'):
        if check_password_hash(user['password_hash'], password):
            return user
    return None

# Contacts Operations
def add_contact(user_id, name, phone, email, relationship='Family', notify_sos=1, notify_delay=1):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('''
        INSERT INTO trusted_contacts (user_id, name, phone, email, relationship, notify_sos, notify_delay)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    ''', (user_id, name.strip(), phone.strip(), email.strip(), relationship.strip(), notify_sos, notify_delay))
    conn.commit()
    contact_id = cursor.lastrowid
    conn.close()
    return get_contact_by_id(contact_id)

def get_contacts_by_user(user_id):
    conn = get_db()
    rows = conn.execute('SELECT * FROM trusted_contacts WHERE user_id = ? ORDER BY id DESC', (user_id,)).fetchall()
    conn.close()
    return [dict(r) for r in rows]

def get_contact_by_id(contact_id):
    conn = get_db()
    row = conn.execute('SELECT * FROM trusted_contacts WHERE id = ?', (contact_id,)).fetchone()
    conn.close()
    return dict(row) if row else None

def delete_contact(contact_id, user_id):
    conn = get_db()
    conn.execute('DELETE FROM trusted_contacts WHERE id = ? AND user_id = ?', (contact_id, user_id))
    conn.commit()
    conn.close()
    return True

# Journey Operations
def start_journey(user_id, dest_name, dest_lat, dest_lng, origin_name=None, origin_lat=None, origin_lng=None, geofence_radius=100, distance_km=None, expected_arrival=None):
    conn = get_db()
    cursor = conn.cursor()
    # Cancel previous active journeys for this user to keep state clean
    cursor.execute('''
        UPDATE journeys SET status = 'Cancelled' WHERE user_id = ? AND status IN ('In Progress', 'Not Started', 'Delayed')
    ''', (user_id,))
    
    cursor.execute('''
        INSERT INTO journeys (user_id, origin_name, origin_lat, origin_lng, dest_name, dest_lat, dest_lng, geofence_radius, distance_km, expected_arrival, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'In Progress')
    ''', (user_id, origin_name, origin_lat, origin_lng, dest_name, dest_lat, dest_lng, geofence_radius, distance_km, expected_arrival))
    conn.commit()
    journey_id = cursor.lastrowid
    conn.close()
    return get_journey_by_id(journey_id)

def get_journey_by_id(journey_id):
    conn = get_db()
    row = conn.execute('SELECT * FROM journeys WHERE id = ?', (journey_id,)).fetchone()
    conn.close()
    return dict(row) if row else None

def get_active_journey(user_id):
    conn = get_db()
    row = conn.execute('''
        SELECT * FROM journeys 
        WHERE user_id = ? AND status IN ('In Progress', 'Delayed')
        ORDER BY id DESC LIMIT 1
    ''', (user_id,)).fetchone()
    conn.close()
    return dict(row) if row else None

def get_journey_history(user_id, limit=10):
    conn = get_db()
    rows = conn.execute('''
        SELECT * FROM journeys WHERE user_id = ? ORDER BY id DESC LIMIT ?
    ''', (user_id, limit)).fetchall()
    conn.close()
    return [dict(r) for r in rows]

def update_journey_status(journey_id, status, completed=False):
    conn = get_db()
    now_str = datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S')
    if completed:
        conn.execute('''
            UPDATE journeys SET status = ?, completed_at = ? WHERE id = ?
        ''', (status, now_str, journey_id))
    else:
        conn.execute('UPDATE journeys SET status = ? WHERE id = ?', (status, journey_id))
    conn.commit()
    conn.close()
    return get_journey_by_id(journey_id)

def mark_arrival_notified(journey_id):
    conn = get_db()
    conn.execute('UPDATE journeys SET arrival_notified = 1, status = "Completed", completed_at = CURRENT_TIMESTAMP WHERE id = ?', (journey_id,))
    conn.commit()
    conn.close()

def mark_delay_notified(journey_id):
    conn = get_db()
    conn.execute('UPDATE journeys SET delay_notified = 1, status = "Delayed" WHERE id = ?', (journey_id,))
    conn.commit()
    conn.close()

# Location Updates Operations
def save_location(user_id, lat, lng, accuracy=None, speed=None, heading=None, is_sharing=1, journey_id=None):
    conn = get_db()
    now_str = datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S')
    
    # Update active location table
    cursor = conn.cursor()
    cursor.execute('''
        INSERT INTO active_locations (user_id, journey_id, latitude, longitude, accuracy, speed, heading, is_sharing, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET
            journey_id = excluded.journey_id,
            latitude = excluded.latitude,
            longitude = excluded.longitude,
            accuracy = excluded.accuracy,
            speed = excluded.speed,
            heading = excluded.heading,
            is_sharing = excluded.is_sharing,
            updated_at = excluded.updated_at
    ''', (user_id, journey_id, lat, lng, accuracy, speed, heading, is_sharing, now_str))
    
    # Append to location history for breadcrumb trace
    if is_sharing:
        cursor.execute('''
            INSERT INTO location_history (user_id, journey_id, latitude, longitude, accuracy, speed, recorded_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        ''', (user_id, journey_id, lat, lng, accuracy, speed, now_str))
        
    conn.commit()
    conn.close()
    return get_active_location(user_id)

def set_sharing_status(user_id, is_sharing):
    conn = get_db()
    now_str = datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S')
    conn.execute('''
        UPDATE active_locations SET is_sharing = ?, updated_at = ? WHERE user_id = ?
    ''', (1 if is_sharing else 0, now_str, user_id))
    conn.commit()
    conn.close()
    return get_active_location(user_id)

def get_active_location(user_id):
    conn = get_db()
    row = conn.execute('SELECT * FROM active_locations WHERE user_id = ?', (user_id,)).fetchone()
    conn.close()
    return dict(row) if row else None

def get_location_history(user_id, journey_id=None, limit=100):
    conn = get_db()
    if journey_id:
        rows = conn.execute('''
            SELECT latitude, longitude, accuracy, speed, recorded_at 
            FROM location_history 
            WHERE user_id = ? AND journey_id = ? 
            ORDER BY id ASC LIMIT ?
        ''', (user_id, journey_id, limit)).fetchall()
    else:
        rows = conn.execute('''
            SELECT latitude, longitude, accuracy, speed, recorded_at 
            FROM location_history 
            WHERE user_id = ? 
            ORDER BY id DESC LIMIT ?
        ''', (user_id, limit)).fetchall()
    conn.close()
    return [dict(r) for r in rows]

# Sharing Sessions
def create_sharing_session(user_id, journey_id=None, duration_hours=4):
    conn = get_db()
    token = secrets.token_urlsafe(16)
    expires_at = (datetime.utcnow() + timedelta(hours=duration_hours)).strftime('%Y-%m-%d %H:%M:%S')
    
    # Deactivate existing sessions
    conn.execute('UPDATE sharing_sessions SET is_active = 0 WHERE user_id = ?', (user_id,))
    
    cursor = conn.cursor()
    cursor.execute('''
        INSERT INTO sharing_sessions (user_id, journey_id, token, is_active, expires_at)
        VALUES (?, ?, ?, 1, ?)
    ''', (user_id, journey_id, token, expires_at))
    conn.commit()
    session_id = cursor.lastrowid
    conn.close()
    return get_sharing_session_by_token(token)

def get_sharing_session_by_token(token):
    conn = get_db()
    row = conn.execute('SELECT * FROM sharing_sessions WHERE token = ?', (token,)).fetchone()
    conn.close()
    if not row:
        return None
    session_dict = dict(row)
    # Check expiration
    if session_dict.get('expires_at'):
        expires = datetime.strptime(session_dict['expires_at'], '%Y-%m-%d %H:%M:%S')
        if datetime.utcnow() > expires:
            session_dict['is_active'] = 0
    return session_dict

def get_active_sharing_session(user_id):
    conn = get_db()
    row = conn.execute('''
        SELECT * FROM sharing_sessions 
        WHERE user_id = ? AND is_active = 1
        ORDER BY id DESC LIMIT 1
    ''', (user_id,)).fetchone()
    conn.close()
    if not row:
        return None
    session_dict = dict(row)
    if session_dict.get('expires_at'):
        expires = datetime.strptime(session_dict['expires_at'], '%Y-%m-%d %H:%M:%S')
        if datetime.utcnow() > expires:
            revoke_sharing_session(session_dict['token'], user_id)
            return None
    return session_dict

def revoke_sharing_session(token, user_id=None):
    conn = get_db()
    if user_id:
        conn.execute('UPDATE sharing_sessions SET is_active = 0 WHERE token = ? AND user_id = ?', (token, user_id))
    else:
        conn.execute('UPDATE sharing_sessions SET is_active = 0 WHERE token = ?', (token,))
    conn.commit()
    conn.close()
    return True

# Emergency SOS Alerts
def trigger_emergency_alert(user_id, lat, lng, accuracy=None, journey_id=None, message="EMERGENCY! I need immediate help."):
    conn = get_db()
    cursor = conn.cursor()
    now_str = datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S')
    map_link = f"https://www.google.com/maps/search/?api=1&query={lat},{lng}"
    
    cursor.execute('''
        INSERT INTO emergency_alerts (user_id, journey_id, latitude, longitude, accuracy, message, map_link, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?)
    ''', (user_id, journey_id, lat, lng, accuracy, message, map_link, now_str))
    conn.commit()
    alert_id = cursor.lastrowid
    conn.close()
    return get_emergency_alert(alert_id)

def get_emergency_alert(alert_id):
    conn = get_db()
    row = conn.execute('SELECT * FROM emergency_alerts WHERE id = ?', (alert_id,)).fetchone()
    conn.close()
    return dict(row) if row else None

def get_active_emergency_alert(user_id):
    conn = get_db()
    row = conn.execute('''
        SELECT * FROM emergency_alerts 
        WHERE user_id = ? AND status = 'ACTIVE' 
        ORDER BY id DESC LIMIT 1
    ''', (user_id,)).fetchone()
    conn.close()
    return dict(row) if row else None

def resolve_emergency_alert(alert_id, user_id):
    conn = get_db()
    now_str = datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S')
    conn.execute('''
        UPDATE emergency_alerts 
        SET status = 'RESOLVED', resolved_at = ? 
        WHERE id = ? AND user_id = ?
    ''', (now_str, alert_id, user_id))
    conn.commit()
    conn.close()
    return True
