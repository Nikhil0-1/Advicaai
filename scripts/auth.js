// Firebase Auth System - Simplified & Fixed
import { auth, db } from './firebase.js';
import {
    onAuthStateChanged,
    signInWithEmailAndPassword,
    signOut,
    createUserWithEmailAndPassword
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { ref, get, set } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";

/**
 * Get user role from database
 */
async function getUserRole(uid) {
    try {
        // Check admin first
        const adminSnap = await get(ref(db, `users/admin/${uid}`));
        if (adminSnap.exists()) return { role: 'admin', data: adminSnap.val() };

        // Check doctor
        const doctorSnap = await get(ref(db, `users/doctors/${uid}`));
        if (doctorSnap.exists()) return { role: 'doctor', data: doctorSnap.val() };

        // Check patient
        const patientSnap = await get(ref(db, `users/patients/${uid}`));
        if (patientSnap.exists()) return { role: 'patient', data: patientSnap.val() };

        return { role: null, data: null };
    } catch (error) {
        console.error('Error getting user role:', error);
        return { role: null, data: null };
    }
}

/**
 * Check authentication and setup UI
 * @param {string} requiredRole - 'patient', 'doctor', or 'admin'
 */
export function checkAuth(requiredRole) {
    const authContainer = document.getElementById('auth-container');
    const mainPanel = document.getElementById('main-panel');

    onAuthStateChanged(auth, async (user) => {
        console.log('Auth state changed:', user ? user.email : 'No user');

        if (!user) {
            // Not logged in - show login form
            if (authContainer) authContainer.classList.remove('hidden');
            if (mainPanel) mainPanel.classList.add('hidden');
            return;
        }

        try {
            const { role, data } = await getUserRole(user.uid);
            console.log('User role:', role);

            // No role found
            if (!role) {
                console.log('No role found for user');
                if (authContainer) authContainer.classList.remove('hidden');
                if (mainPanel) mainPanel.classList.add('hidden');
                return;
            }

            // Wrong role
            if (role !== requiredRole) {
                alert(`You are logged in as ${role}. Please use the correct portal.`);
                await signOut(auth);
                window.location.href = 'index.html';
                return;
            }

            // Check if blocked
            if (data?.blocked === true) {
                alert('Your account has been blocked. Contact administrator.');
                await signOut(auth);
                return;
            }

            // Doctor needs approval
            if (role === 'doctor' && data?.approved !== true) {
                alert('Your account is pending admin approval.');
                await signOut(auth);
                return;
            }

            // SUCCESS - Show main panel
            if (authContainer) authContainer.classList.add('hidden');
            if (mainPanel) mainPanel.classList.remove('hidden');

            // Dispatch success event
            window.dispatchEvent(new CustomEvent('auth-success', { detail: user }));

        } catch (error) {
            console.error('Auth check error:', error);
            alert('Authentication error: ' + error.message);
        }
    });
}

/**
 * Login function
 */
export async function login(email, password, requiredRole) {
    try {
        const userCredential = await signInWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;

        // Verify role
        const { role, data } = await getUserRole(user.uid);

        if (!role) {
            await signOut(auth);
            throw new Error('Account not registered. Please sign up first.');
        }

        if (role !== requiredRole) {
            await signOut(auth);
            throw new Error(`This is the ${requiredRole} portal. You are registered as ${role}.`);
        }

        if (data?.blocked) {
            await signOut(auth);
            throw new Error('Your account has been blocked.');
        }

        if (role === 'doctor' && !data?.approved) {
            await signOut(auth);
            throw new Error('Pending admin approval.');
        }

        return user;

    } catch (error) {
        console.error('Login error:', error);

        // Clean error messages
        if (error.code === 'auth/user-not-found') {
            throw new Error('No account found with this email.');
        }
        if (error.code === 'auth/wrong-password' || error.code === 'auth/invalid-credential') {
            throw new Error('Invalid email or password.');
        }
        if (error.code === 'auth/invalid-email') {
            throw new Error('Invalid email format.');
        }

        throw error;
    }
}

/**
 * Register new patient
 */
export async function registerPatient(name, email, password, extraData = {}) {
    try {
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;

        // Save to database
        await set(ref(db, `users/patients/${user.uid}`), {
            name,
            email,
            role: 'patient',
            blocked: false,
            createdAt: Date.now(),
            ...extraData
        });

        return user;

    } catch (error) {
        console.error('Registration error:', error);

        if (error.code === 'auth/email-already-in-use') {
            throw new Error('Email already registered. Please login.');
        }
        if (error.code === 'auth/weak-password') {
            throw new Error('Password should be at least 6 characters.');
        }

        throw error;
    }
}

/**
 * Logout function
 */
export async function logout() {
    try {
        await signOut(auth);
        window.location.href = 'index.html';
    } catch (error) {
        console.error('Logout error:', error);
        window.location.href = 'index.html';
    }
}

/**
 * Get current user role
 */
export async function getCurrentUserRole() {
    const user = auth.currentUser;
    if (!user) return null;
    const { role } = await getUserRole(user.uid);
    return role;
}
