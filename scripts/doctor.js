// Doctor Panel - Improved with Better Session Handling
import { db, auth, storage } from './firebase.js';
import { checkAuth, login, logout } from './auth.js';
import {
    ref, set, push, onValue, update, get, onDisconnect, off
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";
import {
    uploadString, ref as sRef, getDownloadURL
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";

// Initialize Auth Check
checkAuth('doctor');

let currentDoctor = null;
let currentDoctorData = null;
let currentSessionId = null;
let heartbeatInterval = null;
let sessionListener = null;
let chatListener = null;

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

// Login Handler
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

// Logout Handler
logoutBtn?.addEventListener('click', async () => {
    try {
        // Stop heartbeat
        if (heartbeatInterval) {
            clearInterval(heartbeatInterval);
            heartbeatInterval = null;
        }

        // Set doctor offline
        if (currentDoctor) {
            await update(ref(db, `users/doctors/${currentDoctor.uid}`), {
                status: 'INACTIVE',
                busy: false,
                lastActiveTime: Date.now()
            });
        }

        await logout();
    } catch (error) {
        console.error('Logout error:', error);
        await logout();
    }
});

// Heartbeat System - Keep Doctor "Online"
function startHeartbeat(uid) {
    console.log('Starting heartbeat for doctor:', uid);

    const statusRef = ref(db, `doctorStatus/${uid}`);
    const doctRef = ref(db, `users/doctors/${uid}`);

    // Set initial status
    update(doctRef, {
        status: 'ACTIVE',
        lastActiveTime: Date.now()
    });

    // Set to offline on disconnect
    onDisconnect(statusRef).remove();
    onDisconnect(doctRef).update({
        status: 'INACTIVE',
        busy: false
    });

    // Heartbeat every 10 seconds
    heartbeatInterval = setInterval(() => {
        const now = Date.now();

        set(statusRef, {
            lastActiveTime: now,
            status: 'ACTIVE'
        });

        update(doctRef, {
            status: 'ACTIVE',
            lastActiveTime: now
        });

        // Update UI status
        if (liveStatus) {
            liveStatus.innerText = 'ONLINE';
            liveStatus.className = 'status-indicator status-active';
        }
    }, 10000);

    // Immediate first beat
    if (liveStatus) {
        liveStatus.innerText = 'ONLINE';
        liveStatus.className = 'status-indicator status-active';
    }
}

// Monitor Doctor's Session Assignment
async function monitorSessions(uid) {
    console.log('Monitoring sessions for doctor:', uid);

    // Listen for session assignment
    onValue(ref(db, `users/doctors/${uid}`), async (snapshot) => {
        const data = snapshot.val();
        currentDoctorData = data;

        if (data?.activeSessionId && data.activeSessionId !== currentSessionId) {
            // Validate session exists and is still active
            const sessionSnap = await get(ref(db, `sessions/${data.activeSessionId}`));
            const session = sessionSnap.val();

            if (session && session.status === 'ACTIVE' && !session.endTime) {
                currentSessionId = data.activeSessionId;
                console.log('New session assigned:', currentSessionId);
                showConsultation(currentSessionId);
            } else {
                // Session ended or doesn't exist - clear stale data
                console.log('Stale session detected, clearing...');
                await update(ref(db, `users/doctors/${uid}`), {
                    activeSessionId: null,
                    busy: false
                });
                if (currentSessionId) {
                    currentSessionId = null;
                    hideConsultation();
                }
            }
        } else if (!data?.activeSessionId && currentSessionId) {
            console.log('Session ended');
            currentSessionId = null;
            hideConsultation();
        }
    });
}

// Show Consultation UI
function showConsultation(sid) {
    console.log('Showing consultation:', sid);

    if (noPatientView) noPatientView.classList.add('hidden');
    if (activeConsultation) activeConsultation.classList.remove('hidden');

    // Clear previous listeners
    if (sessionListener) off(sessionListener);
    if (chatListener) off(chatListener);

    // Load Session Data
    const sessionRef = ref(db, `sessions/${sid}`);
    onValue(sessionRef, (snap) => {
        const session = snap.val();
        if (!session) return;

        // Update patient info
        const nameEl = document.getElementById('p-name');
        if (nameEl) {
            nameEl.innerText = session.patientName || 'Patient';
            if (session.emergency) {
                nameEl.innerHTML = nameEl.innerText + ' <span class="icon-svg" style="color:#ef4444;"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/></svg></span> EMERGENCY';
                nameEl.style.color = '#ef4444';
            }
        }

        // Load patient details
        if (session.patientId) {
            get(ref(db, `users/patients/${session.patientId}`)).then(patientSnap => {
                const patient = patientSnap.val();
                if (patient) {
                    const ageEl = document.getElementById('p-age');
                    const bloodEl = document.getElementById('p-blood');
                    if (ageEl) ageEl.innerText = patient.age || '--';
                    if (bloodEl) bloodEl.innerText = patient.bloodGroup || '--';
                }
            });
        }

        // Load health data
        if (session.healthData) {
            const hd = session.healthData;
            const bpEl = document.getElementById('v-bp');
            const tempEl = document.getElementById('v-temp');
            const sugarEl = document.getElementById('v-sugar');
            const spo2El = document.getElementById('v-spo2');

            if (bpEl) bpEl.innerText = hd.bp || '--';
            if (tempEl) tempEl.innerText = hd.temp || '--';
            if (sugarEl) sugarEl.innerText = hd.sugar || '--';
            if (spo2El) spo2El.innerText = hd.spo2 || '--';
        }
    });

    // Load Chat Messages
    const chatRef = ref(db, `sessions/${sid}/chat`);
    onValue(chatRef, (snap) => {
        if (!chatMessages) return;

        chatMessages.innerHTML = '';
        const msgs = snap.val() || {};

        Object.values(msgs).forEach(m => {
            const div = document.createElement('div');
            div.className = `msg msg-${m.role === 'doctor' ? 'd' : 'p'}`;
            div.innerText = m.text;
            chatMessages.appendChild(div);
        });

        chatMessages.scrollTop = chatMessages.scrollHeight;
    });
}

// Hide Consultation UI
function hideConsultation() {
    if (activeConsultation) activeConsultation.classList.add('hidden');
    if (noPatientView) noPatientView.classList.remove('hidden');

    // Clear chat
    if (chatMessages) chatMessages.innerHTML = '';
}

// Send Chat Message
async function sendMessage() {
    const text = chatInput?.value?.trim();
    if (!text || !currentSessionId) return;

    try {
        const msgRef = push(ref(db, `sessions/${currentSessionId}/chat`));
        await set(msgRef, {
            role: 'doctor',
            text,
            timestamp: Date.now()
        });

        if (chatInput) chatInput.value = '';
    } catch (error) {
        console.error('Send message error:', error);
        alert('Failed to send message');
    }
}

sendBtn?.addEventListener('click', sendMessage);
chatInput?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendMessage();
});

// End Session - Show Prescription Modal
endSessionBtn?.addEventListener('click', () => {
    if (prescriptionModal) prescriptionModal.classList.remove('hidden');
});

// Close modal on outside click
prescriptionModal?.addEventListener('click', (e) => {
    if (e.target === prescriptionModal) {
        prescriptionModal.classList.add('hidden');
    }
});

// Confirm End Session - Save Prescription and Close
confirmEndBtn?.addEventListener('click', async () => {
    const prescriptionText = document.getElementById('prescription-text')?.value?.trim();

    if (!prescriptionText) {
        alert('Please enter a prescription before ending the session.');
        return;
    }

    if (!currentSessionId) {
        alert('No active session found.');
        return;
    }

    const btn = confirmEndBtn;
    const originalText = btn.innerText;
    const sessionToEnd = currentSessionId;

    try {
        btn.disabled = true;
        btn.innerText = 'Saving...';

        console.log('Ending session:', sessionToEnd);

        // 1. Update session with prescription and end time
        await update(ref(db, `sessions/${sessionToEnd}`), {
            prescription: prescriptionText,
            endTime: Date.now(),
            status: 'COMPLETED'
        });
        console.log('Session updated with prescription');

        // 2. Free the doctor
        if (currentDoctor?.uid) {
            await update(ref(db, `users/doctors/${currentDoctor.uid}`), {
                busy: false,
                activeSessionId: null
            });
            console.log('Doctor freed');
        }

        // 3. Hide modal
        if (prescriptionModal) prescriptionModal.classList.add('hidden');

        // 4. Clear prescription text
        const textArea = document.getElementById('prescription-text');
        if (textArea) textArea.value = '';

        // 5. Clear session ID
        currentSessionId = null;

        // 6. Show success
        btn.disabled = false;
        btn.innerText = originalText;

        alert('Consultation completed! Prescription sent to patient.');

        // 7. Refresh to show dashboard
        hideConsultation();

    } catch (error) {
        console.error('End session error:', error);
        alert('Error: ' + error.message);
        btn.disabled = false;
        btn.innerText = originalText;
    }
});

// Add cancel button handler
const cancelPrescriptionBtn = document.getElementById('cancel-prescription-btn');
cancelPrescriptionBtn?.addEventListener('click', () => {
    if (prescriptionModal) prescriptionModal.classList.add('hidden');
});

// Load Doctor's Consultation History
async function loadConsultationHistory(doctorId) {
    console.log('Loading consultation history for:', doctorId);

    try {
        const sessionsSnap = await get(ref(db, 'sessions'));
        const allSessions = sessionsSnap.val() || {};

        // Filter sessions for this doctor
        const doctorSessions = Object.entries(allSessions)
            .filter(([sid, session]) => session.doctorId === doctorId)
            .sort((a, b) => (b[1].startTime || 0) - (a[1].startTime || 0))
            .slice(0, 10); // Last 10 sessions

        // Update stats
        const totalPatients = doctorSessions.length;
        const todayStart = new Date().setHours(0, 0, 0, 0);
        const todaySessions = doctorSessions.filter(([sid, s]) => (s.startTime || 0) >= todayStart).length;
        const emergencies = doctorSessions.filter(([sid, s]) => s.emergency).length;

        const statPatientsEl = document.getElementById('stat-patients');
        const statTodayEl = document.getElementById('stat-today');
        const statEmergenciesEl = document.getElementById('stat-emergencies');

        if (statPatientsEl) statPatientsEl.innerText = totalPatients;
        if (statTodayEl) statTodayEl.innerText = todaySessions;
        if (statEmergenciesEl) statEmergenciesEl.innerText = emergencies;

        // Render history table
        const historyList = document.getElementById('history-list');
        if (!historyList) return;

        historyList.innerHTML = '';

        if (doctorSessions.length === 0) {
            historyList.innerHTML = `
                <tr>
                    <td colspan="4" style="text-align:center;color:#64748b;padding:2rem;">
                        No consultations yet. Your patient history will appear here.
                    </td>
                </tr>
            `;
            return;
        }

        doctorSessions.forEach(([sid, session]) => {
            const tr = document.createElement('tr');
            const date = new Date(session.startTime).toLocaleDateString('en-IN', {
                day: '2-digit', month: 'short', year: '2-digit'
            });
            const duration = formatDuration(session.startTime, session.endTime);
            const isEmergency = session.emergency;
            const isCompleted = !!session.endTime;

            tr.innerHTML = `
                <td>
                    ${session.patientName || 'Patient'}
                    ${isEmergency ? '<span class="icon-svg" style="color:#ef4444;width:0.9em;height:0.9em;"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/></svg></span>' : ''}
                </td>
                <td style="font-size:0.85rem;">${date}</td>
                <td>${duration}</td>
                <td>
                    <span class="status-indicator ${isCompleted ? 'status-offline' : 'status-active'}">
                        ${isCompleted ? 'Done' : 'Active'}
                    </span>
                </td>
            `;
            historyList.appendChild(tr);
        });

    } catch (error) {
        console.error('Error loading history:', error);
    }
}

// Format duration helper
function formatDuration(startTime, endTime) {
    if (!startTime) return '-';
    const end = endTime || Date.now();
    const min = Math.floor((end - startTime) / 60000);
    if (min < 1) return '< 1 min';
    if (min < 60) return `${min} min`;
    const hrs = Math.floor(min / 60);
    const rem = min % 60;
    return `${hrs}h ${rem}m`;
}

// Initialize after auth success
window.addEventListener('auth-success', async (e) => {
    currentDoctor = e.detail;
    console.log('Doctor authenticated:', currentDoctor.email);

    // Get doctor data
    const docSnap = await get(ref(db, `users/doctors/${currentDoctor.uid}`));
    currentDoctorData = docSnap.val();

    // Update UI
    const nameEl = document.getElementById('doctor-name');
    const idEl = document.getElementById('doctor-id');

    if (nameEl) nameEl.innerText = `Dr. ${currentDoctorData?.name || currentDoctor.displayName || 'Practitioner'}`;
    if (idEl) idEl.innerText = `ID: ${currentDoctor.uid.substring(0, 8)}`;

    // Load consultation history
    await loadConsultationHistory(currentDoctor.uid);

    // Start heartbeat and session monitoring
    startHeartbeat(currentDoctor.uid);
    monitorSessions(currentDoctor.uid);
});

