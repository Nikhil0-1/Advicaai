// Patient Panel - Login, Registration & Consultation
import { db, auth } from './firebase.js';
import { checkAuth, login, logout, registerPatient } from './auth.js';
import {
    ref, set, onValue, update, get, push, remove
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";

// Initialize Auth Check
checkAuth('patient');

let currentPatient = null;
let currentSessionId = null;
let assignedDoctorId = null;
let failSafeTimer = null;

// DOM Elements
const loginForm = document.getElementById('login-form');
const registerForm = document.getElementById('register-form');
const logoutBtn = document.getElementById('logout-btn');
const consultBtn = document.getElementById('consult-btn');
const consultationArea = document.getElementById('consultation-area');
const actionSection = document.getElementById('action-section');
const doctorNameEl = document.getElementById('doctor-name');
const chatMessages = document.getElementById('chat-messages');
const chatInput = document.getElementById('chat-input');
const sendBtn = document.getElementById('send-btn');
const healthForm = document.getElementById('health-form');

// Login Handler
loginForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type="submit"]');
    const originalText = btn.innerText;

    try {
        btn.disabled = true;
        btn.innerText = 'Signing in...';

        const email = document.getElementById('login-email').value.trim();
        const password = document.getElementById('login-password').value;

        await login(email, password, 'patient');

    } catch (error) {
        alert(error.message);
        btn.disabled = false;
        btn.innerText = originalText;
    }
});

// Registration Handler
registerForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type="submit"]');
    const originalText = btn.innerText;

    try {
        btn.disabled = true;
        btn.innerText = 'Creating Account...';

        const name = document.getElementById('reg-name').value.trim();
        const email = document.getElementById('reg-email').value.trim();
        const password = document.getElementById('reg-password').value;
        const age = document.getElementById('reg-age').value;
        const bloodGroup = document.getElementById('reg-blood').value;

        await registerPatient(name, email, password, {
            age: parseInt(age),
            bloodGroup
        });

        alert('Account created successfully! You are now logged in.');

    } catch (error) {
        alert(error.message);
        btn.disabled = false;
        btn.innerText = originalText;
    }
});

// Logout Handler
logoutBtn?.addEventListener('click', logout);

// Doctor Assignment - Find Available Doctor
consultBtn?.addEventListener('click', async () => {
    consultBtn.disabled = true;
    consultBtn.innerText = 'Finding Doctor...';

    try {
        const doctorsSnap = await get(ref(db, 'users/doctors'));
        const doctors = doctorsSnap.val() || {};

        // Find available doctor: approved, active, not busy, recent heartbeat
        const availableDoctor = Object.entries(doctors).find(([uid, doc]) => {
            const isApproved = doc.approved === true;
            const isActive = doc.status === 'ACTIVE';
            const isNotBusy = doc.busy === false;
            const lastActive = doc.lastActiveTime || 0;
            const isRecentlyActive = (Date.now() - lastActive) < 30000;

            return isApproved && isActive && isNotBusy && isRecentlyActive;
        });

        if (availableDoctor) {
            const [docId, docData] = availableDoctor;
            assignedDoctorId = docId;
            await startSession(docId, docData.name);
        } else {
            alert('No doctors available right now. Please try again in a few minutes.');
            consultBtn.disabled = false;
            consultBtn.innerHTML = `<span class="icon-svg"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M19 8h-1.81c-.45-.78-1.07-1.45-1.82-1.96l1.1-1.1-1.41-1.41-1.47 1.47A5.93 5.93 0 0 0 12 4.5c-.64 0-1.26.09-1.86.26L8.67 3.29 7.26 4.7l1.1 1.1C7.61 6.35 6.99 7.02 6.54 7.8H5v2h1.09c-.05.33-.09.66-.09 1s.04.67.09 1H5v2h1.54c1.07 2.01 3.18 3.4 5.62 3.4h.12c2.44 0 4.55-1.39 5.62-3.4H19v-2h-1.09c.05-.33.09-.66.09-1s-.04-.67-.09-1H19V8zm-7 6c-1.65 0-3-1.35-3-3s1.35-3 3-3 3 1.35 3 3-1.35 3-3 3z"/><circle cx="12" cy="11" r="1.5"/></svg></span> Consult Doctor`;
        }
    } catch (error) {
        console.error('Error finding doctor:', error);
        alert('Error finding doctor: ' + error.message);
        consultBtn.disabled = false;
        consultBtn.innerHTML = `<span class="icon-svg"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M19 8h-1.81c-.45-.78-1.07-1.45-1.82-1.96l1.1-1.1-1.41-1.41-1.47 1.47A5.93 5.93 0 0 0 12 4.5c-.64 0-1.26.09-1.86.26L8.67 3.29 7.26 4.7l1.1 1.1C7.61 6.35 6.99 7.02 6.54 7.8H5v2h1.09c-.05.33-.09.66-.09 1s.04.67.09 1H5v2h1.54c1.07 2.01 3.18 3.4 5.62 3.4h.12c2.44 0 4.55-1.39 5.62-3.4H19v-2h-1.09c.05-.33.09-.66.09-1s-.04-.67-.09-1H19V8zm-7 6c-1.65 0-3-1.35-3-3s1.35-3 3-3 3 1.35 3 3-1.35 3-3 3z"/><circle cx="12" cy="11" r="1.5"/></svg></span> Consult Doctor`;
    }
});

// Start Consultation Session
async function startSession(docId, docName) {
    const sessionRef = push(ref(db, 'sessions'));
    currentSessionId = sessionRef.key;

    const sessionData = {
        sessionId: currentSessionId,
        patientId: currentPatient.uid,
        patientName: currentPatient.displayName || 'Patient',
        doctorId: docId,
        doctorName: docName,
        startTime: Date.now(),
        status: 'ACTIVE'
    };

    // Create session
    await set(sessionRef, sessionData);

    // Lock doctor
    await update(ref(db, `users/doctors/${docId}`), {
        busy: true,
        activeSessionId: currentSessionId
    });

    // Show consultation UI
    showConsultation(docName);

    // Start fail-safe monitoring
    startFailSafeWatcher(docId);
}

// Emergency Flag
async function flagEmergency() {
    if (!currentSessionId) return;
    await update(ref(db, `sessions/${currentSessionId}`), { emergency: true });
    alert('Emergency flagged! Admin and Doctor notified.');
}
window.flagEmergency = flagEmergency;

// Show Consultation UI
function showConsultation(docName) {
    actionSection?.classList.add('hidden');
    consultationArea?.classList.remove('hidden');
    if (doctorNameEl) doctorNameEl.innerText = `Dr. ${docName}`;

    // Monitor chat messages
    onValue(ref(db, `sessions/${currentSessionId}/chat`), (snap) => {
        if (!chatMessages) return;
        chatMessages.innerHTML = '';
        const msgs = snap.val() || {};
        Object.values(msgs).forEach(m => {
            const div = document.createElement('div');
            div.className = `msg msg-${m.role === 'patient' ? 'p' : 'd'}`;
            div.innerText = m.text;
            chatMessages.appendChild(div);
        });
        chatMessages.scrollTop = chatMessages.scrollHeight;
    });

    // Monitor session end
    onValue(ref(db, `sessions/${currentSessionId}`), (snap) => {
        const session = snap.val();
        if (session && session.endTime) {
            stopFailSafeWatcher();
            alert('Consultation ended. Prescription is available in your records.');
            window.location.reload();
        }
    });
}

// Fail-Safe: Monitor Doctor Connection
function startFailSafeWatcher(docId) {
    if (failSafeTimer) clearInterval(failSafeTimer);

    failSafeTimer = setInterval(async () => {
        try {
            const docSnap = await get(ref(db, `users/doctors/${docId}`));
            const docData = docSnap.val();
            const lastActive = docData?.lastActiveTime || 0;

            if ((Date.now() - lastActive) > 30000 || docData?.status === 'INACTIVE') {
                console.warn('Doctor disconnected!');
                showDoctorDisconnectNotice();
                stopFailSafeWatcher();
            }
        } catch (error) {
            console.error('Fail-safe check error:', error);
        }
    }, 10000);
}

function stopFailSafeWatcher() {
    if (failSafeTimer) {
        clearInterval(failSafeTimer);
        failSafeTimer = null;
    }
}

// Show disconnect notice
function showDoctorDisconnectNotice() {
    const notice = document.getElementById('doctor-disconnect-notice');
    if (notice) notice.classList.remove('hidden');
    if (doctorNameEl) {
        doctorNameEl.innerText = 'Doctor Disconnected';
        doctorNameEl.className = 'status-indicator status-inactive';
    }
}

// Hide disconnect notice
function hideDoctorDisconnectNotice() {
    const notice = document.getElementById('doctor-disconnect-notice');
    if (notice) notice.classList.add('hidden');
}

// Find new doctor button handler
const findNewDoctorBtn = document.getElementById('find-new-doctor-btn');
findNewDoctorBtn?.addEventListener('click', findNewDoctor);

// Find and assign new doctor
async function findNewDoctor() {
    if (!currentSessionId) return;

    findNewDoctorBtn.disabled = true;
    findNewDoctorBtn.innerText = 'Searching...';

    try {
        // Mark old doctor as free
        if (assignedDoctorId) {
            await update(ref(db, `users/doctors/${assignedDoctorId}`), {
                busy: false,
                activeSessionId: null
            });
        }

        // Find new doctor
        const doctorsSnap = await get(ref(db, 'users/doctors'));
        const doctors = doctorsSnap.val() || {};

        const nextDoc = Object.entries(doctors).find(([uid, doc]) => {
            return doc.approved && doc.status === 'ACTIVE' && !doc.busy &&
                (Date.now() - (doc.lastActiveTime || 0)) < 30000;
        });

        if (nextDoc) {
            const [newDocId, newDocData] = nextDoc;
            assignedDoctorId = newDocId;

            // Update session with new doctor
            await update(ref(db, `sessions/${currentSessionId}`), {
                doctorId: newDocId,
                doctorName: newDocData.name,
                reassigned: true
            });

            // Lock new doctor
            await update(ref(db, `users/doctors/${newDocId}`), {
                busy: true,
                activeSessionId: currentSessionId
            });

            // Update UI
            hideDoctorDisconnectNotice();
            if (doctorNameEl) {
                doctorNameEl.innerText = `Dr. ${newDocData.name}`;
                doctorNameEl.className = 'status-indicator status-active';
            }

            // Restart monitoring
            startFailSafeWatcher(newDocId);

            alert(`New doctor assigned: Dr. ${newDocData.name}`);
        } else {
            alert('No doctors available right now. Please try again in a moment.');
        }
    } catch (error) {
        console.error('Find new doctor error:', error);
        alert('Error: ' + error.message);
    } finally {
        findNewDoctorBtn.disabled = false;
        findNewDoctorBtn.innerText = 'Find New Doctor';
    }
}

// Health Data Submission
healthForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!currentSessionId) {
        alert('No active session');
        return;
    }

    const healthData = {
        bp: document.getElementById('bp')?.value || '',
        temp: document.getElementById('temp')?.value || '',
        sugar: document.getElementById('sugar')?.value || '',
        spo2: document.getElementById('spo2')?.value || '',
        timestamp: Date.now()
    };

    await update(ref(db, `sessions/${currentSessionId}/healthData`), healthData);
    alert('Vitals submitted successfully!');
});

// Chat Logic
sendBtn?.addEventListener('click', sendMessage);
chatInput?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendMessage();
});

async function sendMessage() {
    const text = chatInput?.value?.trim();
    if (!text || !currentSessionId) return;

    const msgRef = push(ref(db, `sessions/${currentSessionId}/chat`));
    await set(msgRef, {
        role: 'patient',
        text,
        timestamp: Date.now()
    });

    if (chatInput) chatInput.value = '';
}

// Initialize after auth success
window.addEventListener('auth-success', (e) => {
    currentPatient = e.detail;
    console.log('Patient authenticated:', currentPatient.email);

    // Load patient profile
    onValue(ref(db, `users/patients/${currentPatient.uid}`), (snap) => {
        const profile = snap.val();
        if (profile) {
            const nameEl = document.getElementById('patient-name');
            const idEl = document.getElementById('patient-id');
            const ageEl = document.getElementById('p-age');
            const bloodEl = document.getElementById('p-blood');

            if (nameEl) nameEl.innerText = profile.name || 'Patient';
            if (idEl) idEl.innerText = `ID: ${currentPatient.uid.substring(0, 8)}`;
            if (ageEl) ageEl.innerText = profile.age || '--';
            if (bloodEl) bloodEl.innerText = profile.bloodGroup || '--';
        }
    });
});
