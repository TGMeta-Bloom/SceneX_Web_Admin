// firebase-config.js
// Access the initialized compat instances from the global window scope

const auth = (typeof window.firebase !== 'undefined') ? window.firebase.auth() : null;
const db = (typeof window.firebase !== 'undefined') ? window.firebase.firestore() : null;

export { auth, db };

