import { db, auth, storage } from './firebase.js';
import { checkAuth, login, logout } from './auth.js';
import { ref, set, push, onValue, update, get, onDisconnect } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";
import { uploadString, ref as sRef } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";

// Initialize Auth Check
checkAuth('doctor');

let currentDoctor = null;
let currentSessionId = null;
let heartbeatInterval = null;

// DOM Elements
const loginForm = document.getElementById('login-form');
const logoutBtn = document.getElementById('logout-btn');
const liveStatus = document.getElementById('live-status');
const noPatientView = document.getElementById('no-patient-view');
const activeConsultation = document.getElementById('active-consultation');
const chatMessages = document.getElementById('chat-messages');
const chatInput = document.getElementById('chat-input');
const sendBtn = document.getElementById('send-btn');
const endSessionBtn = document.getElementById('end-session-btn');
const prescriptionModal = document.getElementById('prescription-modal');
const confirmEndBtn = document.getElementById('confirm-end-btn');

// Event Listeners
loginForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type="submit"]');
    const originalText = btn.innerText;

    try {
        btn.disabled = true;
        btn.innerText = 'Signing in...';

        const email = document.getElementById('email').value.trim();
        const password = document.getElementById('password').value;

        await login(email, password, 'doctor');

    } catch (error) {
        alert(error.message);
        btn.disabled = false;
        btn.innerText = originalText;
    }
});

logoutBtn?.addEventListener('click', async () => {
    if (heartbeatInterval) clearInterval(heartbeatInterval);
    if (currentDoctor) {
        await update(ref(db, `users/doctors/${currentDoctor.uid}`), { status: 'OFFLINE', busy: false });
    }
    await logout();
});

// Heartbeat Algorithm
function startHeartbeat(uid) {
    const statusRef = ref(db, `doctorStatus/${uid}`);
    const doctRef = ref(db, `users/doctors/${uid}`);

    // Set offline on disconnect
    onDisconnect(statusRef).remove();
    onDisconnect(doctRef).update({ status: 'INACTIVE', busy: false });

    heartbeatInterval = setInterval(() => {
        set(statusRef, {
            lastActiveTime: Date.now(),
            status: 'ACTIVE'
        });
        update(doctRef, {
            status: 'ACTIVE',
            lastActiveTime: Date.now()
        });
        liveStatus.innerText = 'ONLINE';
        liveStatus.className = 'status-indicator status-active';
    }, 10000); // 10s heartbeat
}

// Session Monitoring
function monitorSessions(uid) {
    onValue(ref(db, `users/doctors/${uid}`), (snapshot) => {
        const data = snapshot.val();
        if (data.activeSessionId) {
            currentSessionId = data.activeSessionId;
            showConsultation(currentSessionId);
        } else {
            currentSessionId = null;
            hideConsultation();
        }
    });
}

function showConsultation(sid) {
    noPatientView.classList.add('hidden');
    activeConsultation.classList.remove('hidden');

    // Load Session Data
    onValue(ref(db, `sessions/${sid}`), (snap) => {
        const session = snap.val();
        if (session) {
            document.getElementById('p-name').innerText = session.patientName + (session.emergency ? ' [EMERGENCY]' : '');
            if (session.emergency) {
                document.getElementById('p-name').style.color = 'var(--danger)';
            }
            // Load health data
            if (session.healthData) {
                const hd = session.healthData;
                document.getElementById('v-bp').innerText = hd.bp || '--';
                document.getElementById('v-temp').innerText = hd.temp || '--';
                document.getElementById('v-sugar').innerText = hd.sugar || '--';
                document.getElementById('v-spo2').innerText = hd.spo2 || '--';
            }
        }
    });

    // Load Chat
    onValue(ref(db, `sessions/${sid}/chat`), (snap) => {
        chatMessages.innerHTML = '';
        const msgs = snap.val() || {};
        Object.values(msgs).forEach(m => {
            const div = document.createElement('div');
            div.className = `msg msg-${m.role === 'doctor' ? 'p' : 'd'}`; // Using same CSS classes
            div.innerText = m.text;
            chatMessages.appendChild(div);
        });
        chatMessages.scrollTop = chatMessages.scrollHeight;
    });
}

function hideConsultation() {
    activeConsultation.classList.add('hidden');
    noPatientView.classList.remove('hidden');
}

// Chat Logic
sendBtn?.addEventListener('click', sendMessage);
chatInput?.addEventListener('keypress', (e) => { if (e.key === 'Enter') sendMessage(); });

async function sendMessage() {
    if (!chatInput.value.trim() || !currentSessionId) return;
    const msgRef = push(ref(db, `sessions/${currentSessionId}/chat`));
    await set(msgRef, {
        role: 'doctor',
        text: chatInput.value,
        timestamp: Date.now()
    });
    chatInput.value = '';
}

// Session End
endSessionBtn?.addEventListener('click', () => {
    prescriptionModal.classList.remove('hidden');
});

confirmEndBtn?.addEventListener('click', async () => {
    const text = document.getElementById('prescription-text').value;
    if (!text) return alert("Please enter a prescription.");

    try {
        // 1. Save prescription to Storage
        const pRef = sRef(storage, `prescriptions/${currentSessionId}.txt`);
        await uploadString(pRef, text);

        // 2. Update Session
        await update(ref(db, `sessions/${currentSessionId}`), {
            endTime: Date.now(),
            prescriptionLink: `prescriptions/${currentSessionId}.txt`
        });

        // 3. Free Doctor
        await update(ref(db, `users/doctors/${currentDoctor.uid}`), {
            busy: false,
            activeSessionId: null
        });

        prescriptionModal.classList.add('hidden');
        alert("Session completed successfully.");
    } catch (error) {
        alert("Error ending session: " + error.message);
    }
});

// Initialization
window.addEventListener('auth-success', (e) => {
    currentDoctor = e.detail;
    document.getElementById('doctor-name').innerText = `Dr. ${currentDoctor.displayName || 'Practitioner'}`;
    document.getElementById('doctor-id').innerText = `ID: ${currentDoctor.uid.substring(0, 8)}`;

    startHeartbeat(currentDoctor.uid);
    monitorSessions(currentDoctor.uid);
});
