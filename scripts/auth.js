import { auth, db } from './firebase.js';
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { ref, get } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";

/**
 * Validates the user role and redirects if necessary
 * @param {string} requiredRole - 'patient', 'doctor', or 'admin'
 */
export async function checkAuth(requiredRole) {
    onAuthStateChanged(auth, async (user) => {
        if (!user) {
            // No user is signed in, stay on auth-container view
            return;
        }

        // Get user role from database
        const role = await getUserRole(user.uid);

        if (role !== requiredRole) {
            alert("Unauthorized access. Redirecting...");
            // Redirect based on actual role
            window.location.href = `${role}.html`;
        } else {
            // Auth success, show main panel
            document.getElementById('auth-container').classList.add('hidden');
            document.getElementById('main-panel').classList.remove('hidden');

            // Dispatch custom event for page-specific logic
            window.dispatchEvent(new CustomEvent('auth-success', { detail: user }));
        }
    });
}

/**
 * Helper to fetch user role from Firebase
 */
async function getUserRole(uid) {
    // Check patients
    const patientSnap = await get(ref(db, `users/patients/${uid}`));
    if (patientSnap.exists()) return 'patient';

    // Check doctors
    const doctorSnap = await get(ref(db, `users/doctors/${uid}`));
    if (doctorSnap.exists()) return 'doctor';

    // Check admin (hardcoded logic or special path)
    const adminSnap = await get(ref(db, `users/admin/${uid}`));
    if (adminSnap.exists()) return 'admin';

    return null;
}

/**
 * Handle Login
 */
export async function login(email, password, role) {
    try {
        const userCredential = await signInWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;

        // Verify role before proceeding
        const actualRole = await getUserRole(user.uid);
        if (actualRole !== role) {
            await signOut(auth);
            throw new Error(`User is not a ${role}`);
        }

        return user;
    } catch (error) {
        throw error;
    }
}

/**
 * Handle Logout
 */
export async function logout() {
    await signOut(auth);
    window.location.reload();
}
