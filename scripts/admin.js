// Admin Panel - Doctor Management System
import { db, auth } from './firebase.js';
import { checkAuth, login, logout } from './auth.js';
import {
    ref, set, push, onValue, update, remove, get
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";
import {
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword,
    signOut
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

// Initialize Auth Check
checkAuth('admin');

// DOM Elements
const loginForm = document.getElementById('login-form');
const logoutBtn = document.getElementById('logout-btn');
const doctorList = document.getElementById('doctor-list');
const doctorModal = document.getElementById('doctor-modal');
const addDoctorBtn = document.getElementById('add-doctor-btn');
const closeModal = document.getElementById('close-modal');
const addDoctorForm = document.getElementById('add-doctor-form');

const statTotal = document.getElementById('stat-total');
const statActive = document.getElementById('stat-active');
const statOnline = document.getElementById('stat-online');
const statEmergency = document.getElementById('stat-emergency');

// Login Handler
loginForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type="submit"]');
    const originalText = btn.innerText;

    try {
        btn.disabled = true;
        btn.innerText = 'Logging in...';

        const email = document.getElementById('email').value;
        const password = document.getElementById('password').value;

        await login(email, password, 'admin');

    } catch (error) {
        alert(error.message);
        btn.disabled = false;
        btn.innerText = originalText;
    }
});

// Logout Handler
logoutBtn?.addEventListener('click', logout);

// Modal Handlers
addDoctorBtn?.addEventListener('click', () => {
    doctorModal?.classList.remove('hidden');
});

closeModal?.addEventListener('click', () => {
    doctorModal?.classList.add('hidden');
    addDoctorForm?.reset();
});

// Close modal on outside click
doctorModal?.addEventListener('click', (e) => {
    if (e.target === doctorModal) {
        doctorModal.classList.add('hidden');
        addDoctorForm?.reset();
    }
});

// Add Doctor Form Handler
addDoctorForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type="submit"]');
    const originalText = btn.innerText;

    try {
        btn.disabled = true;
        btn.innerText = 'Registering...';

        const name = document.getElementById('doc-name').value.trim();
        const email = document.getElementById('doc-email').value.trim();
        const password = document.getElementById('doc-password').value;
        const specialty = document.getElementById('doc-specialty')?.value.trim() || 'General Physician';

        // Store current admin user
        const currentUser = auth.currentUser;
        const adminEmail = currentUser.email;

        // Create doctor account
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        const doctorUid = userCredential.user.uid;

        // Save doctor data to database
        await set(ref(db, `users/doctors/${doctorUid}`), {
            name,
            email,
            specialty,
            role: 'doctor',
            approved: false,
            blocked: false,
            status: 'INACTIVE',
            busy: false,
            createdAt: Date.now()
        });

        // Sign out from doctor account and sign back in as admin
        await signOut(auth);

        // We need admin to sign back in - show message
        alert(`Doctor "${name}" registered successfully!\n\nPlease login again as admin.`);
        window.location.reload();

    } catch (error) {
        console.error('Add doctor error:', error);

        let message = error.message;
        if (error.code === 'auth/email-already-in-use') {
            message = 'This email is already registered.';
        } else if (error.code === 'auth/weak-password') {
            message = 'Password should be at least 6 characters.';
        }

        alert('Error: ' + message);
        btn.disabled = false;
        btn.innerText = originalText;
    }
});

// Real-time Monitoring
function initMonitoring() {
    console.log('Initializing admin monitoring...');

    // Watch Doctors
    onValue(ref(db, 'users/doctors'), (snapshot) => {
        const doctors = snapshot.val() || {};
        console.log('Doctors data:', doctors);
        renderDoctors(doctors);
        updateDoctorStats(doctors);
    }, (error) => {
        console.error('Error watching doctors:', error);
    });

    // Watch Sessions
    onValue(ref(db, 'sessions'), (snapshot) => {
        const sessions = snapshot.val() || {};
        renderSessions(sessions);
    }, (error) => {
        console.error('Error watching sessions:', error);
    });
}

function renderDoctors(doctors) {
    if (!doctorList) return;

    doctorList.innerHTML = '';

    const doctorEntries = Object.entries(doctors);

    if (doctorEntries.length === 0) {
        doctorList.innerHTML = `
            <tr>
                <td colspan="5" style="text-align:center;color:#64748b;padding:2rem;">
                    No doctors registered yet. Click "+ Add Doctor" to register one.
                </td>
            </tr>
        `;
        return;
    }

    doctorEntries.forEach(([uid, doc]) => {
        const isBlocked = doc.blocked === true;
        const isApproved = doc.approved === true;
        const tr = document.createElement('tr');

        // Determine status
        let statusClass = 'status-inactive';
        let statusText = 'INACTIVE';

        if (isBlocked) {
            statusClass = 'status-inactive';
            statusText = 'BLOCKED';
        } else if (doc.status === 'ACTIVE') {
            statusClass = doc.busy ? 'status-busy' : 'status-active';
            statusText = doc.busy ? 'BUSY' : 'ACTIVE';
        }

        // Build action buttons
        let actions = '';

        if (!isApproved && !isBlocked) {
            actions += `<button class="btn btn-sm btn-primary" onclick="window.approveDoctor('${uid}')">Approve</button> `;
        }

        if (isApproved && !isBlocked) {
            actions += `<button class="btn btn-sm" style="background:#f59e0b;color:white;" onclick="window.blockDoctor('${uid}')">Block</button> `;
        }

        if (isBlocked) {
            actions += `<button class="btn btn-sm btn-accent" onclick="window.unblockDoctor('${uid}')">Unblock</button> `;
        }

        actions += `<button class="btn btn-sm btn-danger" onclick="window.deleteDoctor('${uid}')">Remove</button>`;

        tr.innerHTML = `
            <td>
                <strong>${doc.name || 'Unknown'}</strong>
                <br><small style="color:#64748b;">${doc.specialty || 'General'}</small>
            </td>
            <td style="font-size:0.85rem;">${doc.email || '-'}</td>
            <td><span class="status-indicator ${statusClass}">${statusText}</span></td>
            <td>
                ${isApproved ? '<span style="color:#10b981;">✓ Approved</span>' : '<span style="color:#f59e0b;">⏳ Pending</span>'}
            </td>
            <td>${actions}</td>
        `;

        doctorList.appendChild(tr);
    });
}

function updateDoctorStats(doctors) {
    let online = 0;
    let total = Object.keys(doctors).length;

    Object.values(doctors).forEach(d => {
        if (d.status === 'ACTIVE' && !d.blocked) online++;
    });

    if (statOnline) statOnline.innerText = online;
}

function renderSessions(sessions) {
    const list = document.getElementById('session-list');
    if (!list) return;

    list.innerHTML = '';

    let activeCount = 0;
    let emergencyCount = 0;
    let totalConsultations = Object.keys(sessions).length;

    if (statTotal) statTotal.innerText = totalConsultations;

    if (totalConsultations === 0) {
        list.innerHTML = `
            <tr>
                <td colspan="5" style="text-align:center;color:#64748b;padding:2rem;">
                    No consultation sessions yet.
                </td>
            </tr>
        `;
        if (statActive) statActive.innerText = 0;
        if (statEmergency) statEmergency.innerText = 0;
        return;
    }

    // Sort by newest first
    const sortedSessions = Object.entries(sessions)
        .sort((a, b) => (b[1].startTime || 0) - (a[1].startTime || 0));

    sortedSessions.forEach(([sid, session]) => {
        if (!session.endTime) activeCount++;
        if (session.emergency) emergencyCount++;

        const isLive = !session.endTime;
        const tr = document.createElement('tr');

        tr.innerHTML = `
            <td style="font-family:monospace;font-size:0.8rem;">${sid.substring(0, 8)}...</td>
            <td>${session.patientName || 'Patient'}</td>
            <td>${session.doctorName || 'Doctor'}</td>
            <td>${formatDuration(session.startTime, session.endTime)}</td>
            <td>
                ${session.emergency ? '<span class="status-indicator status-inactive">🚨 EMERGENCY</span> ' : ''}
                <span class="status-indicator ${isLive ? 'status-active' : 'status-offline'}">${isLive ? '● LIVE' : 'Completed'}</span>
            </td>
        `;
        list.appendChild(tr);
    });

    if (statActive) statActive.innerText = activeCount;
    if (statEmergency) statEmergency.innerText = emergencyCount;
}

function formatDuration(startTime, endTime) {
    if (!startTime) return '-';
    const end = endTime || Date.now();
    const min = Math.floor((end - startTime) / 60000);
    if (min < 60) return `${min} min`;
    const hrs = Math.floor(min / 60);
    const remainingMin = min % 60;
    return `${hrs}h ${remainingMin}m`;
}

// Global Doctor Management Functions
window.approveDoctor = async (uid) => {
    if (confirm('Approve this doctor? They will be able to receive patients.')) {
        try {
            await update(ref(db, `users/doctors/${uid}`), {
                approved: true,
                blocked: false
            });
            console.log('Doctor approved:', uid);
        } catch (error) {
            alert('Error: ' + error.message);
        }
    }
};

window.blockDoctor = async (uid) => {
    if (confirm('Block this doctor? They will not receive new patients.')) {
        try {
            await update(ref(db, `users/doctors/${uid}`), {
                blocked: true,
                approved: false,
                status: 'INACTIVE',
                busy: false,
                activeSessionId: null
            });
            console.log('Doctor blocked:', uid);
        } catch (error) {
            alert('Error: ' + error.message);
        }
    }
};

window.unblockDoctor = async (uid) => {
    if (confirm('Unblock and approve this doctor?')) {
        try {
            await update(ref(db, `users/doctors/${uid}`), {
                blocked: false,
                approved: true
            });
            console.log('Doctor unblocked:', uid);
        } catch (error) {
            alert('Error: ' + error.message);
        }
    }
};

window.deleteDoctor = async (uid) => {
    if (confirm('Are you sure you want to permanently remove this doctor? This cannot be undone.')) {
        try {
            await remove(ref(db, `users/doctors/${uid}`));
            await remove(ref(db, `doctorStatus/${uid}`));
            console.log('Doctor deleted:', uid);
        } catch (error) {
            alert('Error: ' + error.message);
        }
    }
};

// Initialize after auth success
window.addEventListener('auth-success', (e) => {
    console.log('Admin authenticated:', e.detail.email);
    initMonitoring();
});
