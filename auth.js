/**
 * Authentication Controller
 * Handles modal tabs, register/login submissions, validation, and session redirection.
 */

function openAuthModal(defaultTab = 'login') {
    const modal = document.getElementById('authModal');
    if (modal) {
        modal.classList.remove('hidden');
        switchAuthTab(defaultTab);
    }
}

function closeAuthModal() {
    const modal = document.getElementById('authModal');
    if (modal) modal.classList.add('hidden');
}

function switchAuthTab(tab) {
    const tabLogin = document.getElementById('tabLogin');
    const tabRegister = document.getElementById('tabRegister');
    const formLogin = document.getElementById('loginForm');
    const formRegister = document.getElementById('registerForm');
    const errorLogin = document.getElementById('loginError');
    const errorRegister = document.getElementById('registerError');

    if (errorLogin) errorLogin.classList.add('hidden');
    if (errorRegister) errorRegister.classList.add('hidden');

    if (tab === 'login') {
        tabLogin.classList.add('active');
        tabRegister.classList.remove('active');
        formLogin.classList.remove('hidden');
        formRegister.classList.add('hidden');
    } else {
        tabRegister.classList.add('active');
        tabLogin.classList.remove('active');
        formRegister.classList.remove('hidden');
        formLogin.classList.add('hidden');
    }
}

async function handleLogin(event) {
    event.preventDefault();
    const email = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value;
    const errorBox = document.getElementById('loginError');

    errorBox.classList.add('hidden');

    try {
        const resp = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });

        const data = await resp.json();
        if (resp.ok) {
            window.location.href = '/dashboard';
        } else {
            errorBox.innerText = data.error || "Login failed. Please check your credentials.";
            errorBox.classList.remove('hidden');
        }
    } catch (err) {
        errorBox.innerText = "Network error. Please try again.";
        errorBox.classList.remove('hidden');
    }
}

async function handleRegister(event) {
    event.preventDefault();
    const name = document.getElementById('regName').value.trim();
    const email = document.getElementById('regEmail').value.trim();
    const phone = document.getElementById('regPhone').value.trim();
    const password = document.getElementById('regPassword').value;
    const errorBox = document.getElementById('registerError');

    errorBox.classList.add('hidden');

    if (password.length < 6) {
        errorBox.innerText = "Password must be at least 6 characters long.";
        errorBox.classList.remove('hidden');
        return;
    }

    try {
        const resp = await fetch('/api/auth/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, email, phone, password })
        });

        const data = await resp.json();
        if (resp.ok) {
            window.location.href = '/dashboard';
        } else {
            errorBox.innerText = data.error || "Registration failed.";
            errorBox.classList.remove('hidden');
        }
    } catch (err) {
        errorBox.innerText = "Network error. Please try again.";
        errorBox.classList.remove('hidden');
    }
}

// Close modal if user clicks outside modal card
window.addEventListener('click', (e) => {
    const modal = document.getElementById('authModal');
    if (e.target === modal) {
        closeAuthModal();
    }
});
