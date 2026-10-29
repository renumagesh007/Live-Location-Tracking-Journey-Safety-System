import os

BASE_DIR = os.path.abspath(os.path.dirname(__file__))

class Config:
    SECRET_KEY = os.environ.get('SECRET_KEY', 'college-journey-safety-secure-key-2026')
    DATABASE_PATH = os.path.join(BASE_DIR, 'journey_safety.db')
    
    # Firebase Configuration
    # To enable Firebase Admin SDK for backend verification and Realtime DB sync,
    # set FIREBASE_CONFIG_PATH or place firebase-credentials.json in the project root.
    FIREBASE_CREDENTIALS_PATH = os.environ.get(
        'FIREBASE_CREDENTIALS_PATH', 
        os.path.join(BASE_DIR, 'firebase-credentials.json')
    )
    FIREBASE_DATABASE_URL = os.environ.get(
        'FIREBASE_DATABASE_URL', 
        'https://journey-safety-default-rtdb.firebaseio.com'
    )
    
    # Geofence settings
    DEFAULT_GEOFENCE_RADIUS_METERS = 100
    DELAY_THRESHOLD_MINUTES = 10
    LOCATION_HISTORY_MAX_POINTS = 500
