/**
 * Browser Notifications & Audio Chime Manager
 * Handles HTML5 Notification API permission and Web Audio synthesizers for alerts.
 */

// Request Notification Permission
async function requestNotificationAccess() {
    if (!("Notification" in window)) {
        showToast("Browser notifications are not supported on this browser.", "info");
        return false;
    }

    try {
        const permission = await Notification.requestPermission();
        const banner = document.getElementById('notifBanner');
        if (permission === "granted") {
            if (banner) banner.classList.add('hidden');
            showToast("Notifications enabled! You will receive arrival and safety alerts.", "success");
            playChimeSound('arrival');
            return true;
        } else {
            showToast("Notification permission was denied. You will still see in-app alerts.", "info");
            return false;
        }
    } catch (err) {
        console.error("Error requesting notification permission:", err);
        return false;
    }
}

// Check Notification Status on Load
function checkNotificationPermission() {
    if ("Notification" in window) {
        const banner = document.getElementById('notifBanner');
        if (Notification.permission === "default" && banner) {
            banner.classList.remove('hidden');
        } else if (banner) {
            banner.classList.add('hidden');
        }
    }
}

// Dispatch Browser Notification
function showBrowserNotification(title, message, options = {}) {
    if ("Notification" in window && Notification.permission === "granted") {
        try {
            const notif = new Notification(title, {
                body: message,
                icon: '/static/img/icon.png',
                badge: '/static/img/icon.png',
                tag: options.tag || 'safety-notification',
                renotify: true,
                ...options
            });

            notif.onclick = function() {
                window.focus();
                this.close();
            };
        } catch (e) {
            console.warn("Could not dispatch native notification:", e);
        }
    }

    // Always show in-app toast as well
    showToast(`${title}: ${message}`, options.type || 'info');
}

// In-App Toast Manager
function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    
    let iconClass = 'fa-info-circle';
    if (type === 'success') iconClass = 'fa-circle-check';
    if (type === 'error') iconClass = 'fa-triangle-exclamation';

    toast.innerHTML = `<i class="fa-solid ${iconClass}"></i> <span>${message}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(10px)';
        toast.style.transition = 'all 0.3s ease';
        setTimeout(() => toast.remove(), 300);
    }, 4500);
}

// Synthesize pleasant tones using Web Audio API (Zero external assets needed!)
function playChimeSound(type = 'arrival') {
    try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!AudioContext) return;
        const ctx = new AudioContext();

        if (type === 'arrival') {
            // Two-tone cheerful chime (C5 -> G5)
            const now = ctx.currentTime;
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();

            osc.type = 'sine';
            osc.frequency.setValueAtTime(523.25, now); // C5
            osc.frequency.exponentialRampToValueAtTime(783.99, now + 0.15); // G5

            gain.gain.setValueAtTime(0.3, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.6);

            osc.connect(gain);
            gain.connect(ctx.destination);

            osc.start(now);
            osc.stop(now + 0.6);
        } else if (type === 'sos') {
            // Urgent dual siren tone
            const now = ctx.currentTime;
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();

            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(880, now); // A5
            osc.frequency.linearRampToValueAtTime(440, now + 0.2);
            osc.frequency.linearRampToValueAtTime(880, now + 0.4);

            gain.gain.setValueAtTime(0.4, now);
            gain.gain.exponentialRampToValueAtTime(0.01, now + 0.7);

            osc.connect(gain);
            gain.connect(ctx.destination);

            osc.start(now);
            osc.stop(now + 0.7);
        }
    } catch (e) {
        console.warn("Audio chime playback error:", e);
    }
}
