import os
import json
import logging
from config import Config

logger = logging.getLogger(__name__)

# Track if Firebase is initialized
_firebase_initialized = False
_db_ref = None

def init_firebase():
    """
    Initializes Firebase Admin SDK if service account JSON exists.
    Otherwise runs in local mode.
    """
    global _firebase_initialized, _db_ref
    
    if _firebase_initialized:
        return True
        
    cred_path = Config.FIREBASE_CREDENTIALS_PATH
    if not os.path.exists(cred_path):
        logger.info(f"Firebase credentials not found at {cred_path}. Operating in standalone local database mode.")
        return False
        
    try:
        import firebase_admin
        from firebase_admin import credentials, db
        
        cred = credentials.Certificate(cred_path)
        firebase_admin.initialize_app(cred, {
            'databaseURL': Config.FIREBASE_DATABASE_URL
        })
        _firebase_initialized = True
        logger.info("Firebase Admin SDK successfully initialized.")
        return True
    except Exception as e:
        logger.warning(f"Could not initialize Firebase Admin SDK: {e}. Falling back to local mode.")
        return False

def is_firebase_active():
    return _firebase_initialized

def sync_location_to_firebase(user_id, location_data):
    """
    Syncs live coordinates to Firebase Realtime Database at /active_locations/{user_id}
    """
    if not _firebase_initialized:
        return False
        
    try:
        from firebase_admin import db
        ref = db.reference(f'active_locations/{user_id}')
        ref.set(location_data)
        return True
    except Exception as e:
        logger.error(f"Failed to push location to Firebase Realtime Database: {e}")
        return False

def sync_emergency_alert_to_firebase(alert_id, alert_data):
    """
    Syncs SOS emergency alert to /emergency_alerts/{alert_id}
    """
    if not _firebase_initialized:
        return False
        
    try:
        from firebase_admin import db
        ref = db.reference(f'emergency_alerts/{alert_id}')
        ref.set(alert_data)
        return True
    except Exception as e:
        logger.error(f"Failed to push emergency alert to Firebase Realtime Database: {e}")
        return False

def verify_firebase_id_token(id_token):
    """
    Verifies Firebase client JWT id_token from frontend Firebase Auth.
    """
    if not _firebase_initialized:
        return None
        
    try:
        from firebase_admin import auth
        decoded_token = auth.verify_id_token(id_token)
        return decoded_token
    except Exception as e:
        logger.warning(f"Firebase token verification failed: {e}")
        return None
