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
let currentPatientId = null;

// Views
const views = {
    dashboard: document.getElementById('dashboard-view'),
    profile: document.getElementById('profile-view'),
    history: document.getElementById('history-view'),
    patients: document.getElementById('patients-view')
};

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
const sidebar = document.getElementById('sidebar');
const closeSidebarBtn = document.getElementById('close-sidebar');
const menuToggleBtn = document.getElementById('menu-toggle');

// Navigation Handler
document.querySelectorAll('.nav-item[data-section]').forEach(btn => {
    btn.addEventListener('click', (e) => {
        const section = btn.dataset.section;
        switchView(section);

        // Close sidebar on mobile
        if (window.innerWidth <= 768) {
            sidebar?.classList.remove('open');
        }
    });
});

function switchView(viewName) {
    // Hide active consultation if viewing other sections
    if (viewName !== 'dashboard') {
        const activeConsultation = document.getElementById('active-consultation');
        if (activeConsultation && !activeConsultation.classList.contains('hidden')) {
            // Don't allow switching away if in active consultation
            alert('Please end the current consultation before navigating away.');
            return;
        }
    }

    // Update active nav item
    document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
    const activeBtn = document.querySelector(`.nav-item[data-section="${viewName}"]`);
    if (activeBtn) activeBtn.classList.add('active');

    // Show selected view, hide others
    Object.values(views).forEach(el => el && el.classList.add('hidden'));
    if (views[viewName]) {
        views[viewName].classList.remove('hidden');
        views[viewName].classList.add('active');
    }
}

// Sidebar Toggle (Mobile)
menuToggleBtn?.addEventListener('click', () => {
    sidebar?.classList.add('open');
    document.body.style.overflow = 'hidden'; // Prevent background scroll
});

closeSidebarBtn?.addEventListener('click', () => {
    sidebar?.classList.remove('open');
    document.body.style.overflow = ''; // Restore scroll
});

// Close sidebar when clicking outside on mobile
document.addEventListener('click', (e) => {
    if (window.innerWidth <= 768) {
        if (sidebar?.classList.contains('open') &&
            !sidebar.contains(e.target) &&
            !menuToggleBtn?.contains(e.target)) {
            sidebar.classList.remove('open');
            document.body.style.overflow = '';
        }
    }
});

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

                // Alert the doctor!
                alert(`New Patient Request: ${session.patientName || 'Patient'} needs consultation!\nSymptoms: ${session.symptoms || 'Not specified'}`);

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

    // Switch to dashboard view
    switchView('dashboard');

    const dashboard = document.getElementById('dashboard-view');
    if (dashboard) dashboard.classList.add('hidden');
    if (activeConsultation) activeConsultation.classList.remove('hidden');

    // Clear previous listeners
    if (sessionListener) off(sessionListener);
    if (chatListener) off(chatListener);

    // Load Session Data
    const sessionRef = ref(db, `sessions/${sid}`);
    onValue(sessionRef, (snap) => {
        const session = snap.val();
        if (!session) return;

        // Store patient ID for reports
        currentPatientId = session.patientId;

        // Update patient info
        const nameEl = document.getElementById('p-name');
        if (nameEl) {
            nameEl.innerText = session.patientName || 'Patient';
            if (session.emergency) {
                nameEl.innerHTML = nameEl.innerText + ' <span class="icon-svg" style="color:#ef4444;"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/></svg></span> EMERGENCY';
                nameEl.style.color = '#ef4444';
            }
        }

        // Update Symptoms
        const sxEl = document.getElementById('p-symptoms');
        if (sxEl) sxEl.innerText = session.symptoms || 'Not specified';

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

            // Load patient reports
            loadPatientReportsForDoctor(session.patientId);
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
    const dashboard = document.getElementById('dashboard-view');
    if (dashboard) dashboard.classList.remove('hidden');

    // Clear chat
    if (chatMessages) chatMessages.innerHTML = '';
    currentPatientId = null;
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

    if (!currentDoctor?.uid) {
        alert('Doctor information not found. Please refresh and try again.');
        return;
    }

    const btn = confirmEndBtn;
    const originalText = btn.innerText;

    console.log('=== Starting End Session ===');
    console.log('Session:', currentSessionId);
    console.log('Doctor:', currentDoctor.uid);

    try {
        btn.disabled = true;
        btn.innerText = 'Saving...';

        console.log('Step 1: Saving prescription to session...');
        await update(ref(db, `sessions/${currentSessionId}`), {
            prescription: prescriptionText,
            endTime: Date.now(),
            status: 'COMPLETED'
        });
        console.log('✓ Prescription saved');

        console.log('Step 2: Freeing doctor...');
        await update(ref(db, `users/doctors/${currentDoctor.uid}`), {
            busy: false,
            activeSessionId: null
        });
        console.log('✓ Doctor freed');

        console.log('Step 3: Cleaning UI...');
        const textArea = document.getElementById('prescription-text');
        if (textArea) textArea.value = '';

        if (prescriptionModal) prescriptionModal.classList.add('hidden');

        // Reset button BEFORE alert
        btn.disabled = false;
        btn.innerText = originalText;
        console.log('✓ UI cleaned');

        console.log('=== Session End Complete ===');
        alert('Consultation completed successfully! Prescription sent to patient.');

        currentSessionId = null;
        currentPatientId = null;

    } catch (error) {
        console.error('!!! Session End Error !!!');
        console.error('Error:', error);
        console.error('Message:', error.message);
        console.error('Code:', error.code);

        btn.disabled = false;
        btn.innerText = originalText;

        alert(`Error: ${error.message}\n\nPlease try again or refresh the page.`);
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

    // Load profile info
    loadDoctorProfile();
});

// Load Doctor Profile
function loadDoctorProfile() {
    if (!currentDoctor || !currentDoctorData) return;

    const nameSpan = document.getElementById('doc-profile-name');
    const emailSpan = document.getElementById('doc-profile-email');
    const statusSpan = document.getElementById('doc-profile-status');

    if (nameSpan) nameSpan.innerText = currentDoctorData.name || currentDoctor.displayName || 'Doctor';
    if (emailSpan) emailSpan.innerText = currentDoctor.email;
    if (statusSpan) statusSpan.innerText = currentDoctorData.approved ? 'Approved' : 'Pending Approval';
}

// Load Patient Reports for Doctor
async function loadPatientReportsForDoctor(patientId) {
    const reportsList = document.getElementById('patient-reports-list');
    if (!reportsList) return;

    try {
        const reportsSnap = await get(ref(db, `users/patients/${patientId}/reports`));
        const reports = reportsSnap.val() || {};
        const reportsArray = Object.entries(reports);

        if (reportsArray.length === 0) {
            reportsList.innerHTML = '<p class="text-muted" style="font-size:0.9rem;">No reports uploaded</p>';
            return;
        }

        reportsList.innerHTML = reportsArray.map(([id, report]) => `
            <div class="report-item" style="display:flex; justify-content:space-between; align-items:center; padding:0.75rem; border:1px solid #e2e8f0; border-radius:8px; margin-bottom:0.5rem; background:#f8fafc;">
                <div style="flex:1;">
                    <strong style="font-size:0.9rem;">${report.description || 'Report'}</strong>
                    <p style="font-size:0.75rem; color:#64748b; margin:0.25rem 0 0 0;">
                        ${new Date(report.uploadedAt).toLocaleDateString()}
                    </p>
                </div>
                <button class="btn btn-sm btn-primary" onclick="window.open('${report.downloadURL}', '_blank')" style="padding:0.4rem 0.8rem; font-size:0.85rem;">
                    View
                </button>
            </div>
        `).join('');

        // Also listen for new reports
        onValue(ref(db, `users/patients/${patientId}/reports`), (snap) => {
            const updatedReports = snap.val() || {};
            const updatedArray = Object.entries(updatedReports);

            if (updatedArray.length === reportsArray.length) return; // No change

            reportsList.innerHTML = updatedArray.map(([id, report]) => `
                <div class="report-item" style="display:flex; justify-content:space-between; align-items:center; padding:0.75rem; border:1px solid #e2e8f0; border-radius:8px; margin-bottom:0.5rem; background:#f8fafc;">
                    <div style="flex:1;">
                        <strong style="font-size:0.9rem;">${report.description || 'Report'}</strong>
                        <p style="font-size:0.75rem; color:#64748b; margin:0.25rem 0 0 0;">
                            ${new Date(report.uploadedAt).toLocaleDateString()}
                        </p>
                    </div>
                    <button class="btn btn-sm btn-primary" onclick="window.open('${report.downloadURL}', '_blank')" style="padding:0.4rem 0.8rem; font-size:0.85rem;">
                        View
                    </button>
                </div>
            `).join('');
        });

    } catch (error) {
        console.error('Error loading reports:', error);
        reportsList.innerHTML = '<p class="text-muted" style="font-size:0.9rem; color:#ef4444;">Failed to load reports</p>';
    }
}

