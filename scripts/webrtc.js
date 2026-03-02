// webrtc.js - Real-time Video Consultation via Firebase Signaling
import { db } from './firebase.js';
import {
    ref, set, onValue, update, push, onChildAdded, onDisconnect, remove
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";

// STUN Servers for NAT Traversal
const servers = {
    iceServers: [
        { urls: ['stun:stun1.l.google.com:19302', 'stun:stun2.l.google.com:19302'] }
    ]
};

let peerConnection = null;
let localStream = null;
let remoteStream = null;

/**
 * Stop all tracks to free the camera
 */
export function stopCamera() {
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
}

/**
 * Initialize WebRTC Call
 * @param {string} sessionId - The Firebase Database session ID (e.g., `-O1A2B3C...`)
 * @param {string} role - 'doctor' (caller) or 'patient' (callee)
 * @param {HTMLVideoElement} localVideo - Element to show own camera
 * @param {HTMLVideoElement} remoteVideo - Element to show remote camera
 */
export async function initWebRTC(sessionId, role, localVideo, remoteVideo) {
    try {
        console.log(`Initializing WebRTC for ${role} in session ${sessionId}`);

        // 1. Get Camera/Mic access
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        if (localVideo) {
            localVideo.srcObject = localStream;
            localVideo.muted = true; // Avoid feedback loop locally
        }

        remoteStream = new MediaStream();
        if (remoteVideo) {
            remoteVideo.srcObject = remoteStream;
        }

        // 2. Setup RTCPeerConnection
        peerConnection = new RTCPeerConnection(servers);

        // Add local tracks to peer connection
        localStream.getTracks().forEach(track => {
            peerConnection.addTrack(track, localStream);
        });

        // Listen for remote tracks
        peerConnection.ontrack = (event) => {
            event.streams[0].getTracks().forEach(track => {
                remoteStream.addTrack(track);
            });
        };

        const sessionRef = ref(db, `sessions/${sessionId}/webrtc`);
        const offerRef = ref(db, `sessions/${sessionId}/webrtc/offer`);
        const answerRef = ref(db, `sessions/${sessionId}/webrtc/answer`);
        const callerCandidatesRef = ref(db, `sessions/${sessionId}/webrtc/callerCandidates`);
        const calleeCandidatesRef = ref(db, `sessions/${sessionId}/webrtc/calleeCandidates`);

        // Clean up signaling on disconnect
        onDisconnect(sessionRef).remove();

        // 3. Signaling Logic based on Role
        if (role === 'doctor') {
            // DOCTOR is the CALLER

            // Listen for local ICE candidates
            peerConnection.onicecandidate = (event) => {
                if (event.candidate) {
                    push(callerCandidatesRef, event.candidate.toJSON());
                }
            };

            // Create Offer
            const offerDescription = await peerConnection.createOffer();
            await peerConnection.setLocalDescription(offerDescription);

            const offer = {
                sdp: offerDescription.sdp,
                type: offerDescription.type,
            };
            await set(offerRef, offer);
            console.log('Doctor created offer');

            // Listen for Answer
            onValue(answerRef, (snapshot) => {
                const answer = snapshot.val();
                if (answer && !peerConnection.currentRemoteDescription) {
                    const answerDescription = new RTCSessionDescription(answer);
                    peerConnection.setRemoteDescription(answerDescription);
                    console.log('Doctor received answer');
                }
            });

            // Listen for Callee ICE Candidates
            onChildAdded(calleeCandidatesRef, (data) => {
                const candidate = new RTCIceCandidate(data.val());
                peerConnection.addIceCandidate(candidate);
            });

        } else if (role === 'patient') {
            // PATIENT is the CALLEE

            // Listen for local ICE candidates
            peerConnection.onicecandidate = (event) => {
                if (event.candidate) {
                    push(calleeCandidatesRef, event.candidate.toJSON());
                }
            };

            // Listen for Offer
            onValue(offerRef, async (snapshot) => {
                const offer = snapshot.val();
                if (offer && !peerConnection.currentRemoteDescription) {
                    console.log('Patient received offer');
                    const offerDescription = new RTCSessionDescription(offer);
                    await peerConnection.setRemoteDescription(offerDescription);

                    // Create Answer
                    const answerDescription = await peerConnection.createAnswer();
                    await peerConnection.setLocalDescription(answerDescription);

                    const answer = {
                        sdp: answerDescription.sdp,
                        type: answerDescription.type,
                    };
                    await set(answerRef, answer);
                    console.log('Patient created answer');
                }
            });

            // Listen for Caller ICE Candidates
            onChildAdded(callerCandidatesRef, (data) => {
                const candidate = new RTCIceCandidate(data.val());
                peerConnection.addIceCandidate(candidate);
            });
        }

    } catch (error) {
        console.error('WebRTC Initialization Error:', error);
        alert('Could not start video call: \n' + error.message);
    }
}
