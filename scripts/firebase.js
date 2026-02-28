// Firebase Configuration & Initialization
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";

// MediSync Firebase Configuration
const firebaseConfig = {
    apiKey: "AIzaSyDrji6mioMGQ3X6Z3374y-160oIFHC0_Gc",
    authDomain: "advicaai-a57ee.firebaseapp.com",
    databaseURL: "https://advicaai-a57ee-default-rtdb.firebaseio.com",
    projectId: "advicaai-a57ee",
    storageBucket: "advicaai-a57ee.firebasestorage.app",
    messagingSenderId: "933625721032",
    appId: "1:933625721032:web:f4247e3ee52114972e35fd"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);
const storage = getStorage(app);

export { auth, db, storage };
