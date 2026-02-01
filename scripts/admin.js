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

    try {
        // Register doctor in Firebase Auth
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        const uid = userCredential.user.uid;

        // Save to Database
        await set(ref(db, `users/doctors/${uid}`), {
            name,
            email,
            role: 'doctor',
            approved: false, // Initially false
            status: 'INACTIVE',
            busy: false,
            createdAt: Date.now()
        });

        alert("Doctor registered successfully. Awaiting approval.");
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
        updateStats(doctors);
    });

    // Watch Sessions
    onValue(ref(db, 'sessions'), (snapshot) => {
        const sessions = snapshot.val() || {};
        renderSessions(sessions);
    });
}

function renderDoctors(doctors) {
    doctorList.innerHTML = '';
    Object.entries(doctors).forEach(([uid, doc]) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${doc.name}</td>
            <td>${doc.email}</td>
            <td><span class="status-indicator status-${doc.status?.toLowerCase()}">${doc.status}</span></td>
            <td>${doc.approved ? '✅ Approved' : '⏳ Pending'}</td>
            <td>
                ${!doc.approved ? `<button class="btn btn-sm btn-primary" onclick="window.approveDoctor('${uid}')">Approve</button>` : ''}
                <button class="btn btn-sm btn-danger" onclick="window.deleteDoctor('${uid}')">Remove</button>
            </td>
        `;
        doctorList.appendChild(tr);
    });
}

function updateStats(doctors) {
    let online = 0;
    Object.values(doctors).forEach(d => {
        if (d.status === 'ACTIVE') online++;
    });
    statOnline.innerText = online;
}

function renderSessions(sessions) {
    const list = document.getElementById('session-list');
    const statEmergency = document.getElementById('stat-emergency');
    list.innerHTML = '';
    let activeCount = 0;
    let emergencyCount = 0;
    let totalConsultations = Object.keys(sessions).length;
    statTotal.innerText = totalConsultations;

    Object.entries(sessions).forEach(([sid, session]) => {
        if (!session.endTime) activeCount++;
        if (session.emergency) emergencyCount++;

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${sid.substring(0, 8)}...</td>
            <td>${session.patientName || 'Patient'}</td>
            <td>${session.doctorName || 'Doctor'}</td>
            <td>${formatDuration(session.startTime)}</td>
            <td>
                ${session.emergency ? '<span class="status-indicator status-inactive">EMERGENCY</span>' : ''}
                <span class="status-indicator ${session.endTime ? '' : 'status-active'}">${session.endTime ? 'Completed' : 'LIVE'}</span>
            </td>
        `;
        list.appendChild(tr);
    });
    statActive.innerText = activeCount;
    if (statEmergency) statEmergency.innerText = emergencyCount;
}


function formatDuration(startTime) {
    const min = Math.floor((Date.now() - startTime) / 60000);
    return `${min} mins`;
}

// Global functions for inline buttons
window.approveDoctor = (uid) => {
    update(ref(db, `users/doctors/${uid}`), { approved: true });
};

window.deleteDoctor = (uid) => {
    if (confirm("Are you sure?")) {
        remove(ref(db, `users/doctors/${uid}`));
    }
};

// Initialize after auth success
window.addEventListener('auth-success', () => {
    initMonitoring();
});
