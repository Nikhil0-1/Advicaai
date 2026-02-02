// Patient Panel - Logic for Sidebar, Profile, Consultation
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
const sidebar = document.getElementById('sidebar');
const closeSidebarBtn = document.getElementById('close-sidebar');
const menuToggleBtn = document.getElementById('menu-toggle');
const logoutBtn = document.getElementById('logout-btn');
const quickConsultBtn = document.getElementById('quick-consult-btn');
const consultModal = document.getElementById('consult-modal');
const confirmConsultBtn = document.getElementById('confirm-consult');
const cancelConsultBtn = document.getElementById('cancel-consult');
const consultSymptomsInput = document.getElementById('consult-symptoms');

// Views
const views = {
    dashboard: document.getElementById('dashboard-view'),
    profile: document.getElementById('profile-view'),
    history: document.getElementById('history-view'),
    reports: document.getElementById('reports-view')
};

// Navigation Handler
document.querySelectorAll('.nav-item[data-section]').forEach(btn => {
    btn.addEventListener('click', (e) => {
        const section = btn.dataset.section;
        switchView(section);

        // Close sidebar on mobile
        if (window.innerWidth <= 768) {
            sidebar.classList.remove('open');
        }
    });
});

function switchView(viewName) {
    // Update active nav item
    document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
    const activeBtn = document.querySelector(`.nav-item[data-section="${viewName}"]`);
    if (activeBtn) activeBtn.classList.add('active');

    // Show selected view, hide others
    Object.values(views).forEach(el => el && el.classList.add('hidden'));
    if (views[viewName]) {
        views[viewName].classList.remove('hidden');
        views[viewName].classList.add('active'); // Add active class ensuring visibility
    }
}

// Sidebar Toggle (Mobile)
menuToggleBtn?.addEventListener('click', () => {
    sidebar.classList.add('open');
});

closeSidebarBtn?.addEventListener('click', () => {
    sidebar.classList.remove('open');
});

// Logout
logoutBtn?.addEventListener('click', logout);


// ==========================================
// AUTH & INITIALIZATION
// ==========================================

// Login Handler
const loginForm = document.getElementById('login-form');
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

// Register Handler
const registerForm = document.getElementById('register-form');
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
        alert('Account created successfully!');
    } catch (error) {
        alert(error.message);
        btn.disabled = false;
        btn.innerText = originalText;
    }
});


// Initialize after auth success
window.addEventListener('auth-success', async (e) => {
    currentPatient = e.detail;
    console.log('Patient authenticated:', currentPatient.email);

    // Initial Load
    await Promise.all([
        loadProfile(),
        loadPatientHistory(currentPatient.uid)
    ]);
});


// ==========================================
// PROFILE MANAGEMENT
// ==========================================

async function loadProfile() {
    if (!currentPatient) return;

    onValue(ref(db, `users/patients/${currentPatient.uid}`), (snap) => {
        const profile = snap.val();
        if (profile) {
            // Header Info
            document.getElementById('patient-name').innerText = profile.name || 'Patient';
            document.getElementById('patient-id').innerText = `ID: ${currentPatient.uid.substring(0, 8)}`;

            // Dashboard Vitals
            document.getElementById('dash-age').innerText = profile.age || '--';
            document.getElementById('dash-blood').innerText = profile.bloodGroup || '--';
            document.getElementById('dash-weight').innerText = (profile.weight ? profile.weight + ' kg' : '--');

            // Profile Form Inputs
            setInputValue('p-name-input', profile.name);
            setInputValue('p-age-input', profile.age);
            setInputValue('p-gender-input', profile.gender || 'Other');
            setInputValue('p-blood-input', profile.bloodGroup);
            setInputValue('p-height-input', profile.height);
            setInputValue('p-weight-input', profile.weight);
            setInputValue('p-address-input', profile.address);
            setInputValue('p-medical-input', profile.medicalHistory);
        }
    });
}

function setInputValue(id, value) {
    const el = document.getElementById(id);
    if (el && value !== undefined) el.value = value;
}

const profileForm = document.getElementById('profile-form');
profileForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('save-profile-btn');
    const originalText = btn.innerText;

    try {
        btn.disabled = true;
        btn.innerText = 'Saving...';

        const updateData = {
            name: document.getElementById('p-name-input').value,
            age: parseInt(document.getElementById('p-age-input').value),
            gender: document.getElementById('p-gender-input').value,
            bloodGroup: document.getElementById('p-blood-input').value,
            height: document.getElementById('p-height-input').value,
            weight: document.getElementById('p-weight-input').value,
            address: document.getElementById('p-address-input').value,
            medicalHistory: document.getElementById('p-medical-input').value
        };

        if (currentPatient?.uid) {
            await update(ref(db, `users/patients/${currentPatient.uid}`), updateData);
            alert('Profile updated successfully!');
        }
    } catch (error) {
        console.error(error);
        alert('Failed to save profile.');
    } finally {
        btn.disabled = false;
        btn.innerText = originalText;
    }
});


// ==========================================
// CONSULTATION FLOW
// ==========================================

// Open Modal
quickConsultBtn?.addEventListener('click', () => {
    consultModal.classList.remove('hidden');
});

// Close Modal
cancelConsultBtn?.addEventListener('click', () => {
    consultModal.classList.add('hidden');
});

// Confirm Consultation Request
confirmConsultBtn?.addEventListener('click', async () => {
    const symptoms = consultSymptomsInput.value.trim();
    if (!symptoms) {
        alert('Please describe your symptoms.');
        return;
    }

    confirmConsultBtn.disabled = true;
    confirmConsultBtn.innerText = 'Finding Doctor...';

    try {
        await findAndConnectDoctor(symptoms);
    } catch (error) {
        console.error('Consult error:', error);
        alert(error.message);
        confirmConsultBtn.disabled = false;
        confirmConsultBtn.innerText = 'Find Doctor';
    }
});

async function findAndConnectDoctor(symptoms) {
    const doctorsSnap = await get(ref(db, 'users/doctors'));
    const doctors = doctorsSnap.val() || {};

    // Find available doctor logic
    const availableDoctor = Object.entries(doctors).find(([uid, doc]) => {
        const isApproved = doc.approved === true;
        const isActive = doc.status === 'ACTIVE';
        const isNotBusy = doc.busy === false;
        const lastActive = doc.lastActiveTime || 0;
        return isApproved && isActive && isNotBusy && (Date.now() - lastActive) < 30000;
    });

    if (availableDoctor) {
        const [docId, docData] = availableDoctor;
        assignedDoctorId = docId;

        await startSession(docId, docData.name, symptoms);

        // Close modal
        consultModal.classList.add('hidden');
        consultSymptomsInput.value = '';
        confirmConsultBtn.disabled = false;
        confirmConsultBtn.innerText = 'Find Doctor';
    } else {
        throw new Error('No doctors available right now. Please try again later.');
    }
}

async function startSession(docId, docName, symptoms) {
    const sessionRef = push(ref(db, 'sessions'));
    currentSessionId = sessionRef.key;

    const sessionData = {
        sessionId: currentSessionId,
        patientId: currentPatient.uid,
        patientName: currentPatient.displayName || 'Patient',
        doctorId: docId,
        doctorName: docName,
        symptoms: symptoms,
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

    // Show Full Screen Consultation Overlay
    showConsultation(docName);

    // Start monitoring
    startFailSafeWatcher(docId);
}

// Show Consultation Overlay (The "Next Panel" experience)
function showConsultation(docName) {
    const overlay = document.getElementById('consultation-area');
    const doctorNameDisplay = document.getElementById('doctor-name-display');
    const chatMessages = document.getElementById('chat-messages');

    if (overlay) overlay.classList.remove('hidden'); // Show overlay
    if (doctorNameDisplay) doctorNameDisplay.innerText = `Dr. ${docName}`;

    // Initialize Chat Listener
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

    // Monitor Session End
    onValue(ref(db, `sessions/${currentSessionId}`), (snap) => {
        const session = snap.val();
        if (session && session.endTime) {
            stopFailSafeWatcher();
            alert('Consultation ended. Prescription received.');
            window.location.reload(); // Refresh to go back to dashboard
        }
    });
}


// ==========================================
// UTILS: HISTORY, CHAT, EMERGENCY
// ==========================================

async function loadPatientHistory(patientId) {
    if (!patientId) return;

    try {
        const sessionsSnap = await get(ref(db, 'sessions'));
        const allSessions = sessionsSnap.val() || {};

        // 1. Check for Active Session
        const activeEntry = Object.entries(allSessions).find(([sid, s]) =>
            s.patientId === patientId && s.status === 'ACTIVE' && !s.endTime
        );

        if (activeEntry) {
            const [sid, session] = activeEntry;
            console.log('Found active session:', sid);
            currentSessionId = sid;
            assignedDoctorId = session.doctorId;

            // Don't auto-show consultation. Let user click button.
            // Update "Consult Doctor" button to "Resume"
            if (activeEntry && quickConsultBtn) {
                quickConsultBtn.innerText = 'Resume Consultation';
                quickConsultBtn.classList.remove('btn-primary');
                quickConsultBtn.classList.add('btn-warning');

                // Override click handler to resume instead of opening modal
                quickConsultBtn.onclick = (e) => {
                    e.stopImmediatePropagation();
                    showConsultation(session.doctorName);
                    startFailSafeWatcher(session.doctorId);
                };
            }
        }

        // 2. Populate History List
        const patientSessions = Object.entries(allSessions)
            .filter(([sid, s]) => s.patientId === patientId && s.endTime)
            .sort((a, b) => b[1].endTime - a[1].endTime);

        // Populate both Compact (Dashboard) and Full (History View) lists
        renderHistoryList('patient-history-list', patientSessions.slice(0, 3)); // Top 3 for dashboard
        renderHistoryList('full-history-list', patientSessions); // All for full view

    } catch (e) {
        console.error('History load error:', e);
    }
}

function renderHistoryList(elementId, sessions) {
    const listEl = document.getElementById(elementId);
    if (!listEl) return;

    listEl.innerHTML = '';

    if (sessions.length === 0) {
        listEl.innerHTML = '<p class="text-muted">No consultations yet.</p>';
        return;
    }

    sessions.forEach(([sid, session]) => {
        const date = new Date(session.startTime).toLocaleDateString();
        const div = document.createElement('div');
        div.className = `history-card ${session.emergency ? 'emergency' : ''}`;

        div.innerHTML = `
            <div class="history-card-header">
                <strong>Dr. ${session.doctorName}</strong>
                <span>${date}</span>
            </div>
            <div class="history-card-body">
                <p>${session.symptoms || 'General Checkup'}</p>
                ${session.prescription ? '<span class="badge success">Prescription Available</span>' : ''}
            </div>
        `;
        div.addEventListener('click', () => showPrescription(session));
        listEl.appendChild(div);
    });
}

function showPrescription(session) {
    const modal = document.getElementById('prescription-modal');
    if (modal) {
        modal.classList.remove('hidden');
        document.getElementById('rx-doctor').innerText = `Dr. ${session.doctorName}`;
        document.getElementById('rx-date').innerText = new Date(session.endTime).toLocaleDateString();
        document.getElementById('prescription-content').innerText = session.prescription || 'No notes.';
    }
}

// Chat Send
const sendBtn = document.getElementById('send-btn');
const chatInput = document.getElementById('chat-input');
const chatSendHandler = async () => {
    const text = chatInput?.value?.trim();
    if (!text || !currentSessionId) return;

    await set(push(ref(db, `sessions/${currentSessionId}/chat`)), {
        role: 'patient',
        text,
        timestamp: Date.now()
    });
    chatInput.value = '';
};
sendBtn?.addEventListener('click', chatSendHandler);
chatInput?.addEventListener('keypress', (e) => { if (e.key === 'Enter') chatSendHandler(); });

// Close Prescript Modal
document.getElementById('close-prescription-modal')?.addEventListener('click', () => {
    document.getElementById('prescription-modal').classList.add('hidden');
});

// Fail Safe & Emergency
function startFailSafeWatcher(docId) {
    if (failSafeTimer) clearInterval(failSafeTimer);
    failSafeTimer = setInterval(async () => {
        // Simple heartbeat check could go here
    }, 15000);
}
function stopFailSafeWatcher() { if (failSafeTimer) clearInterval(failSafeTimer); }
window.flagEmergency = async () => {
    if (!currentSessionId) return;
    await update(ref(db, `sessions/${currentSessionId}`), { emergency: true });
    alert('Emergency Flagged!');
};
