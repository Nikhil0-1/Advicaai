import { auth, db } from './firebase.js';
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { ref, get } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";

/**
 * Get user role and data from database
 * Returns: { role: 'patient'|'doctor'|'admin'|null, data: object|null }
 */
async function getUserRoleAndData(uid) {
    // Check patients
    const patientSnap = await get(ref(db, `users/patients/${uid}`));
    if (patientSnap.exists()) {
        return { role: 'patient', data: patientSnap.val() };
    }

    // Check doctors
    const doctorSnap = await get(ref(db, `users/doctors/${uid}`));
    if (doctorSnap.exists()) {
        return { role: 'doctor', data: doctorSnap.val() };
    }

    // Check admin
    const adminSnap = await get(ref(db, `users/admin/${uid}`));
    if (adminSnap.exists()) {
        return { role: 'admin', data: adminSnap.val() };
    }

    return { role: null, data: null };
}

/**
 * Validates the user role and redirects if necessary
 * STRICT: Only allows access if user role matches required role
 * @param {string} requiredRole - 'patient', 'doctor', or 'admin'
 */
export async function checkAuth(requiredRole) {
    onAuthStateChanged(auth, async (user) => {
        if (!user) {
            // No user signed in - show login form
            document.getElementById('auth-container')?.classList.remove('hidden');
            document.getElementById('main-panel')?.classList.add('hidden');
            return;
        }

        try {
            const { role, data } = await getUserRoleAndData(user.uid);

            // Case 1: User not found in any role database
            if (!role) {
                alert("Account not found. Please register first.");
                await signOut(auth);
                window.location.href = 'index.html';
                return;
            }

            // Case 2: Role mismatch - user trying to access wrong panel
            if (role !== requiredRole) {
                alert(`Access denied. You are registered as a ${role}, not a ${requiredRole}. Redirecting...`);
                await signOut(auth);
                window.location.href = 'index.html';
                return;
            }

            // Case 3: Check if user is blocked (for patients and doctors)
            if (role === 'patient' && data.blocked === true) {
                alert("Your account has been blocked by the administrator.");
                await signOut(auth);
                return;
            }

            if (role === 'doctor' && data.blocked === true) {
                alert("Your account has been blocked. Contact administrator.");
                await signOut(auth);
                return;
            }

            // Case 4: Doctor not approved yet
            if (role === 'doctor' && data.approved !== true) {
                alert("Your account is pending admin approval. Please wait.");
                await signOut(auth);
                return;
            }

            // SUCCESS - Role matches and user is not blocked
            document.getElementById('auth-container').classList.add('hidden');
            document.getElementById('main-panel').classList.remove('hidden');

            // Dispatch custom event for page-specific logic
            window.dispatchEvent(new CustomEvent('auth-success', { detail: user }));

        } catch (error) {
            console.error("Auth check error:", error);
            alert("Authentication error. Please try again.");
            await signOut(auth);
        }
    });
}

/**
 * Handle Login - STRICT role verification
 * @param {string} email 
 * @param {string} password 
 * @param {string} requiredRole - The role this login form is for
 */
export async function login(email, password, requiredRole) {
    try {
        const userCredential = await signInWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;

        // Get actual role from database
        const { role, data } = await getUserRoleAndData(user.uid);

        // STRICT: Must match exactly
        if (!role) {
            await signOut(auth);
            throw new Error("Account not found in database. Please register first.");
        }

        if (role !== requiredRole) {
            await signOut(auth);
            throw new Error(`This login is for ${requiredRole}s only. You are registered as a ${role}. Please use the correct portal.`);
        }

        // Check blocked status
        if ((role === 'patient' || role === 'doctor') && data.blocked === true) {
            await signOut(auth);
            throw new Error("Your account has been blocked by administrator.");
        }

        // Check approval for doctors
        if (role === 'doctor' && data.approved !== true) {
            await signOut(auth);
            throw new Error("Your account is pending admin approval.");
        }

        return user;
    } catch (error) {
        // Re-throw with cleaner message for Firebase errors
        if (error.code === 'auth/user-not-found') {
            throw new Error("No account found with this email.");
        }
        if (error.code === 'auth/wrong-password') {
            throw new Error("Incorrect password.");
        }
        if (error.code === 'auth/invalid-credential') {
            throw new Error("Invalid email or password.");
        }
        throw error;
    }
}

/**
 * Handle Logout - Clears session and reloads
 */
export async function logout() {
    try {
        await signOut(auth);
        window.location.href = 'index.html';
    } catch (error) {
        console.error("Logout error:", error);
        window.location.href = 'index.html';
    }
}

/**
 * Get current user role (for URL protection)
 */
export async function getCurrentUserRole() {
    const user = auth.currentUser;
    if (!user) return null;
    const { role } = await getUserRoleAndData(user.uid);
    return role;
}
