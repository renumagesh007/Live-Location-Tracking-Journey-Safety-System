/**
 * Firebase Client SDK Configuration & Initialization
 * 
 * Replace with your project credentials from Firebase Console:
 * Project Settings -> General -> Your Apps -> Web App
 */
const firebaseConfig = {
    apiKey: "AIzaSyDEMO-KEY-REPLACE-WITH-YOUR-KEY",
    authDomain: "journey-safety-college-demo.firebaseapp.com",
    databaseURL: "https://journey-safety-college-demo-default-rtdb.firebaseio.com",
    projectId: "journey-safety-college-demo",
    storageBucket: "journey-safety-college-demo.appspot.com",
    messagingSenderId: "123456789012",
    appId: "1:123456789012:web:abcdef1234567890"
};

// State flag
let isFirebaseConfigured = false;
let firebaseAuth = null;
let firebaseDatabase = null;

// Initialize if Firebase library is available and key is configured
(function initFirebaseWeb() {
    if (typeof firebase !== 'undefined' && firebaseConfig.apiKey && !firebaseConfig.apiKey.includes('DEMO-KEY')) {
        try {
            firebase.initializeApp(firebaseConfig);
            firebaseAuth = firebase.auth();
            firebaseDatabase = firebase.database();
            isFirebaseConfigured = true;
            console.log("Firebase Web SDK successfully initialized.");
        } catch (e) {
            console.warn("Firebase initialization skipped or error:", e);
        }
    } else {
        // Standalone local mode is active (Flask backend + SQLite fallback)
        // No error thrown, fully operational!
        console.log("Running in Standalone Flask API mode (Firebase optional).");
    }
})();
