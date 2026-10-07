import { auth, db } from './firebase-config.js';
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { ref, onValue } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";

const AuthManager = {
    init() {
        onAuthStateChanged(auth, (user) => {
            if (user) {
                this.updateUIAuthenticated(user);
                this.syncUserData(user.uid);
            } else {
                this.updateUIGuest();
            }
        });
    },

    updateUIAuthenticated(user) {
        // Update profile sections, show premium crown if applicable
        document.getElementById('premiumBtn').classList.remove('hidden');
        console.log("User logged in:", user.email);
    },

    updateUIGuest() {
        document.getElementById('premiumBtn').classList.add('hidden');
        console.log("Running in Guest Mode");
    },

    syncUserData(uid) {
        const userRef = ref(db, `users/${uid}`);
        onValue(userRef, (snapshot) => {
            const data = snapshot.val();
            if (data && data.premium && data.premium.isPremium) {
                document.body.classList.add('is-premium');
                // Section 35: Premium status is server-authoritative
            }
        });
    },

    logout() {
        signOut(auth).then(() => location.reload());
    }
};

export default AuthManager;