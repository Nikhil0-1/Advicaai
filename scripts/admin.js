import { db, auth } from './firebase.js';
import { checkAuth, login, logout } from './auth.js';
import { ref, set, push, onValue, update, remove, get } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";
import { createUserWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

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

// Event Listeners
loginForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = e.target.email.value;
    const password = e.target.password.value;
    try {
        await login(email, password, 'admin');
    } catch (error) {
        alert("Login failed: " + error.message);
    }
});

logoutBtn?.addEventListener('click', logout);

addDoctorBtn?.addEventListener('click', () => doctorModal.classList.remove('hidden'));
closeModal?.addEventListener('click', () => doctorModal.classList.add('hidden'));

addDoctorForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('doc-name').value;
    const email = document.getElementById('doc-email').value;
    const password = document.getElementById('doc-password').value;
    const specialty = document.getElementById('doc-specialty')?.value || 'General';

    try {
        // Register doctor in Firebase Auth
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        const uid = userCredential.user.uid;

        // Save to Database
        await set(ref(db, `users/doctors/${uid}`), {
            name,
            email,
            specialty,
            role: 'doctor',
            approved: false, // Initially false - admin must approve
            blocked: false,
            status: 'INACTIVE',
            busy: false,
            createdAt: Date.now()
        });

        alert("Doctor registered successfully. You can now approve them.");
        doctorModal.classList.add('hidden');
        addDoctorForm.reset();
    } catch (error) {
        alert("Registration failed: " + error.message);
    }
});

// Real-time Monitoring
function initMonitoring() {
    // Watch Doctors
    onValue(ref(db, 'users/doctors'), (snapshot) => {
        const doctors = snapshot.val() || {};
        renderDoctors(doctors);
        updateDoctorStats(doctors);
    });

    // Watch Sessions
    onValue(ref(db, 'sessions'), (snapshot) => {
        const sessions = snapshot.val() || {};
        renderSessions(sessions);
    });
}

function renderDoctors(doctors) {
    doctorList.innerHTML = '';

    if (Object.keys(doctors).length === 0) {
        doctorList.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#64748b;">No doctors registered</td></tr>';
        return;
    }

    Object.entries(doctors).forEach(([uid, doc]) => {
        const isBlocked = doc.blocked === true;
        const tr = document.createElement('tr');

        // Determine status display
        let statusClass = 'status-inactive';
        let statusText = doc.status || 'INACTIVE';

        if (isBlocked) {
            statusClass = 'status-inactive';
            statusText = 'BLOCKED';
        } else if (doc.status === 'ACTIVE') {
            statusClass = doc.busy ? 'status-busy' : 'status-active';
            statusText = doc.busy ? 'BUSY' : 'ACTIVE';
        }

        tr.innerHTML = `
            <td>
                <strong>${doc.name}</strong>
                <br><small style="color:#64748b;">${doc.specialty || 'General'}</small>
            </td>
            <td style="font-size:0.85rem;">${doc.email}</td>
            <td><span class="status-indicator ${statusClass}">${statusText}</span></td>
            <td>${doc.approved ? '<span style="color:#10b981;">✓ Approved</span>' : '<span style="color:#f59e0b;">⏳ Pending</span>'}</td>
            <td>
                ${!doc.approved && !isBlocked ? `<button class="btn btn-sm btn-primary" onclick="window.approveDoctor('${uid}')">Approve</button>` : ''}
                ${doc.approved && !isBlocked ? `<button class="btn btn-sm btn-outline" style="border-color:#f59e0b;color:#f59e0b;" onclick="window.blockDoctor('${uid}')">Block</button>` : ''}
                ${isBlocked ? `<button class="btn btn-sm btn-accent" onclick="window.unblockDoctor('${uid}')">Unblock</button>` : ''}
                <button class="btn btn-sm btn-danger" onclick="window.deleteDoctor('${uid}')">Remove</button>
            </td>
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

    statOnline.innerText = online;
    document.getElementById('stat-doctors')?.innerText && (document.getElementById('stat-doctors').innerText = total);
}

function renderSessions(sessions) {
    const list = document.getElementById('session-list');
    list.innerHTML = '';

    let activeCount = 0;
    let emergencyCount = 0;
    let totalConsultations = Object.keys(sessions).length;

    statTotal.innerText = totalConsultations;

    if (totalConsultations === 0) {
        list.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#64748b;">No sessions yet</td></tr>';
        statActive.innerText = 0;
        if (statEmergency) statEmergency.innerText = 0;
        return;
    }

    // Sort sessions by start time (newest first)
    const sortedSessions = Object.entries(sessions).sort((a, b) => b[1].startTime - a[1].startTime);

    sortedSessions.forEach(([sid, session]) => {
        if (!session.endTime) activeCount++;
        if (session.emergency) emergencyCount++;

        const tr = document.createElement('tr');
        const isLive = !session.endTime;

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

    statActive.innerText = activeCount;
    if (statEmergency) statEmergency.innerText = emergencyCount;
}

function formatDuration(startTime, endTime) {
    const end = endTime || Date.now();
    const min = Math.floor((end - startTime) / 60000);
    if (min < 60) return `${min} min`;
    const hrs = Math.floor(min / 60);
    const remainingMin = min % 60;
    return `${hrs}h ${remainingMin}m`;
}

// Global functions for inline buttons
window.approveDoctor = async (uid) => {
    if (confirm("Approve this doctor?")) {
        await update(ref(db, `users/doctors/${uid}`), { approved: true, blocked: false });
    }
};

window.blockDoctor = async (uid) => {
    if (confirm("Block this doctor? They will not receive new patients.")) {
        await update(ref(db, `users/doctors/${uid}`), {
            blocked: true,
            approved: false,
            status: 'INACTIVE',
            busy: false,
            activeSessionId: null
        });
    }
};

window.unblockDoctor = async (uid) => {
    if (confirm("Unblock and approve this doctor?")) {
        await update(ref(db, `users/doctors/${uid}`), { blocked: false, approved: true });
    }
};

window.deleteDoctor = async (uid) => {
    if (confirm("Are you sure you want to permanently remove this doctor?")) {
        await remove(ref(db, `users/doctors/${uid}`));
        await remove(ref(db, `doctorStatus/${uid}`));
    }
};

// Initialize after auth success
window.addEventListener('auth-success', () => {
    initMonitoring();
});
