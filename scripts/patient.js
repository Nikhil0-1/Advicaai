import { db, auth } from './firebase.js';
import { checkAuth, login, logout } from './auth.js';
import { ref, set, onValue, update, get, push, remove } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";
import { createUserWithEmailAndPassword, updateProfile } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

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
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;
    try {
        await login(email, password, 'patient');
    } catch (error) {
        alert("Login failed: " + error.message);
    }
});

// Registration Handler
registerForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('reg-name').value;
    const email = document.getElementById('reg-email').value;
    const password = document.getElementById('reg-password').value;
    const age = document.getElementById('reg-age').value;
    const bloodGroup = document.getElementById('reg-blood').value;

    try {
        // Create user in Firebase Auth
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;

        // Update display name
        await updateProfile(user, { displayName: name });

        // Save patient data to database
        await set(ref(db, `users/patients/${user.uid}`), {
            name,
            email,
            age: parseInt(age),
            bloodGroup,
            role: 'patient',
            createdAt: Date.now()
        });

        alert("Registration successful! Logging you in...");
        // Auth state change will handle the rest
    } catch (error) {
        alert("Registration failed: " + error.message);
    }
});

logoutBtn?.addEventListener('click', logout);

// Doctor Assignment Algorithm (CRITICAL)
consultBtn?.addEventListener('click', async () => {
    consultBtn.disabled = true;
    consultBtn.innerText = "Finding Doctor...";

    try {
        const doctorsSnap = await get(ref(db, 'users/doctors'));
        const doctors = doctorsSnap.val() || {};

        // Filter: approved, ACTIVE, not busy, and updated recently (heartbeat check)
        const availableDoctor = Object.entries(doctors).find(([uid, doc]) => {
            const isApproved = doc.approved === true;
            const isActive = doc.status === 'ACTIVE';
            const isNotBusy = doc.busy === false;
            const lastActive = doc.lastActiveTime || 0;
            const isRecentlyActive = (Date.now() - lastActive) < 30000; // Heartbeat check

            return isApproved && isActive && isNotBusy && isRecentlyActive;
        });

        if (availableDoctor) {
            const [docId, docData] = availableDoctor;
            assignedDoctorId = docId;
            startSession(docId, docData.name);
        } else {
            alert("No doctors available right now. Please try again in a few minutes.");
            consultBtn.disabled = false;
            consultBtn.innerText = "⚕️ Consult Doctor";
        }
    } catch (error) {
        alert("Error finding doctor: " + error.message);
        consultBtn.disabled = false;
        consultBtn.innerText = "⚕️ Consult Doctor";
    }
});

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

    // 1. Create session
    await set(sessionRef, sessionData);

    // 2. Lock doctor
    await update(ref(db, `users/doctors/${docId}`), {
        busy: true,
        activeSessionId: currentSessionId
    });

    // 3. Update UI
    showConsultation(docName);

    // 4. Start Fail-Safe Watcher
    startFailSafeWatcher(docId);
}

// Emergency Flagging
async function flagEmergency() {
    if (!currentSessionId) return;
    await update(ref(db, `sessions/${currentSessionId}`), { emergency: true });
    alert("Emergency flagged! Admin and Doctor notified.");
}
window.flagEmergency = flagEmergency;


function showConsultation(docName) {
    actionSection.classList.add('hidden');
    consultationArea.classList.remove('hidden');
    doctorNameEl.innerText = `Dr. ${docName}`;

    // Monitor Chat
    onValue(ref(db, `sessions/${currentSessionId}/chat`), (snap) => {
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

    // Monitor Session Status (check if ended by doctor)
    onValue(ref(db, `sessions/${currentSessionId}`), (snap) => {
        const session = snap.val();
        if (session && session.endTime) {
            stopFailSafeWatcher();
            alert("Consultation ended. Prescription is available in your records.");
            window.location.reload();
        }
    });
}

// Fail-Safe Algorithm (MANDATORY)
function startFailSafeWatcher(docId) {
    if (failSafeTimer) clearInterval(failSafeTimer);
    failSafeTimer = setInterval(async () => {
        const docSnap = await get(ref(db, `users/doctors/${docId}`));
        const docData = docSnap.val();
        const lastActive = docData.lastActiveTime || 0;

        if ((Date.now() - lastActive) > 30000 || docData.status === 'INACTIVE') {
            console.warn("Assigned doctor became inactive. Reassigning...");
            handleDoctorDisconnection(docId);
        }
    }, 10000);
}

function stopFailSafeWatcher() {
    if (failSafeTimer) clearInterval(failSafeTimer);
}

async function handleDoctorDisconnection(oldDocId) {
    stopFailSafeWatcher();

    // Mark old doctor inactive if not already
    await update(ref(db, `users/doctors/${oldDocId}`), { status: 'INACTIVE', busy: false, activeSessionId: null });

    // Try to reassign immediately
    const doctorsSnap = await get(ref(db, 'users/doctors'));
    const doctors = doctorsSnap.val() || {};

    const nextDoc = Object.entries(doctors).find(([uid, doc]) => {
        return doc.approved && doc.status === 'ACTIVE' && !doc.busy && (Date.now() - (doc.lastActiveTime || 0)) < 30000;
    });

    if (nextDoc) {
        const [newDocId, newDocData] = nextDoc;
        assignedDoctorId = newDocId;

        // Update Session with new Doctor
        await update(ref(db, `sessions/${currentSessionId}`), {
            doctorId: newDocId,
            doctorName: newDocData.name
        });

        // Lock new doctor
        await update(ref(db, `users/doctors/${newDocId}`), {
            busy: true,
            activeSessionId: currentSessionId
        });

        doctorNameEl.innerText = `Dr. ${newDocData.name} (Reassigned)`;
        startFailSafeWatcher(newDocId);
        alert("Your doctor disconnected. We have assigned a new doctor to continue your session.");
    } else {
        alert("Your doctor disconnected and no other doctors are available. Please wait or try again.");
        // Stay in consultation area but show waiting status
        doctorNameEl.innerText = `Waiting for available doctor...`;
    }
}

// Health Data Submission
healthForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!currentSessionId) return;

    const healthData = {
        bp: document.getElementById('bp').value,
        temp: document.getElementById('temp').value,
        sugar: document.getElementById('sugar').value,
        spo2: document.getElementById('spo2').value,
        timestamp: Date.now()
    };

    await update(ref(db, `sessions/${currentSessionId}/healthData`), healthData);
    alert("Vitals submitted successfully!");
});

// Chat Logic
sendBtn?.addEventListener('click', sendMessage);
chatInput?.addEventListener('keypress', (e) => { if (e.key === 'Enter') sendMessage(); });

async function sendMessage() {
    if (!chatInput.value.trim() || !currentSessionId) return;
    const msgRef = push(ref(db, `sessions/${currentSessionId}/chat`));
    await set(msgRef, {
        role: 'patient',
        text: chatInput.value,
        timestamp: Date.now()
    });
    chatInput.value = '';
}

// Initialization
window.addEventListener('auth-success', (e) => {
    currentPatient = e.detail;
    // Load patient profile
    onValue(ref(db, `users/patients/${currentPatient.uid}`), (snap) => {
        const profile = snap.val();
        if (profile) {
            document.getElementById('patient-name').innerText = profile.name;
            document.getElementById('patient-id').innerText = `ID: ${currentPatient.uid.substring(0, 8)}`;
            document.getElementById('p-age').innerText = profile.age || '--';
            document.getElementById('p-blood').innerText = profile.bloodGroup || '--';
        }
    });
});
