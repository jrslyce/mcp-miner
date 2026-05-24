import { initializeApp } from "https://www.gstatic.com/firebasejs/12.13.0/firebase-app.js";
import {
  createUserWithEmailAndPassword,
  connectAuthEmulator,
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut
} from "https://www.gstatic.com/firebasejs/12.13.0/firebase-auth.js";
import {
  connectFirestoreEmulator,
  doc,
  getDoc,
  getFirestore,
  serverTimestamp,
  setDoc
} from "https://www.gstatic.com/firebasejs/12.13.0/firebase-firestore.js";

const firebaseConfig = window.MCP_MINER_FIREBASE_CONFIG || {
  apiKey: "demo-api-key",
  authDomain: "demo-mcp-miner.firebaseapp.com",
  projectId: "demo-mcp-miner",
  appId: "1:000000000000:web:mcpminerlocal"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const localHostnames = new Set(["localhost", "127.0.0.1", "0.0.0.0"]);
const useEmulators = localHostnames.has(window.location.hostname) || window.location.hostname.endsWith(".local");

if (useEmulators) {
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
}

const form = document.querySelector("#auth-form");
const email = document.querySelector("#email");
const password = document.querySelector("#password");
const createAccount = document.querySelector("#create-account");
const signOutButton = document.querySelector("#sign-out");
const authStatus = document.querySelector("#auth-status");
const authUid = document.querySelector("#auth-uid");
const profileStatus = document.querySelector("#profile-status");
const message = document.querySelector("#auth-message");

function setMessage(text, isError = false) {
  message.textContent = text;
  message.style.color = isError ? "#9a3412" : "#1f7a5a";
}

function profilePayload(user) {
  const displayName = user.displayName || "Local Prospector";
  return {
    ownerUid: user.uid,
    schemaVersion: 1,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    privacyClass: "abstract",
    displayName,
    minerName: displayName,
    cloudSyncEnabled: true,
    accountLinkedAt: serverTimestamp()
  };
}

async function ensureLinkedProfile(user) {
  const playerRef = doc(db, "players", user.uid);
  const profileRef = doc(db, "players", user.uid, "profile", "current");
  const settingsRef = doc(db, "players", user.uid, "settings", "current");
  const existing = await getDoc(playerRef);

  if (!existing.exists()) {
    await setDoc(playerRef, profilePayload(user));
  } else {
    await setDoc(playerRef, {
      ownerUid: user.uid,
      updatedAt: serverTimestamp(),
      privacyClass: "abstract",
      cloudSyncEnabled: true
    }, { merge: true });
  }

  await setDoc(profileRef, {
    ownerUid: user.uid,
    schemaVersion: 1,
    updatedAt: serverTimestamp(),
    privacyClass: "abstract",
    displayName: user.displayName || "Local Prospector",
    minerName: user.displayName || "Prospector"
  }, { merge: true });

  await setDoc(settingsRef, {
    ownerUid: user.uid,
    schemaVersion: 1,
    updatedAt: serverTimestamp(),
    privacyClass: "abstract",
    reportMode: "meaningful_turns_only",
    cloudSyncEnabled: true
  }, { merge: true });

  return existing.exists() ? "Loaded" : "Created";
}

async function handleAuth(fn) {
  try {
    setMessage("");
    await fn();
  } catch (error) {
    setMessage(error.message || "Authentication failed.", true);
  }
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  handleAuth(() => signInWithEmailAndPassword(auth, email.value, password.value));
});

createAccount.addEventListener("click", () => {
  handleAuth(() => createUserWithEmailAndPassword(auth, email.value, password.value));
});

signOutButton.addEventListener("click", () => {
  handleAuth(() => signOut(auth));
});

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    authStatus.textContent = "Signed out";
    authUid.textContent = "-";
    profileStatus.textContent = "Not linked";
    signOutButton.disabled = true;
    setMessage("");
    return;
  }

  authStatus.textContent = "Signed in";
  authUid.textContent = user.uid;
  signOutButton.disabled = false;

  try {
    const result = await ensureLinkedProfile(user);
    profileStatus.textContent = result;
    setMessage("Profile linked.");
  } catch (error) {
    profileStatus.textContent = "Link error";
    setMessage(error.message || "Profile link failed.", true);
  }
});
