"use strict";

const crypto = require("crypto");

const API_KEY = process.env.MCP_MINER_FIREBASE_API_KEY || "AIzaSyBwLEA9IdoPSeEV_PRY5zFa5WJbE5NSG4o";
const PROJECT_ID = process.env.MCP_MINER_FIREBASE_PROJECT || "mcp-miner";
const EMAIL_LOCAL = process.env.MCP_MINER_QA_EMAIL_LOCAL || "jsteffes";
const EMAIL_DOMAIN = process.env.MCP_MINER_QA_EMAIL_DOMAIN || "gmail.com";
const RUN_ID = (process.env.MCP_MINER_QA_RUN_ID || new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)).toLowerCase();
const EXACT_WORD_ADDRESSES = process.env.MCP_MINER_QA_EXACT_WORDS === "1";
const CLEANUP = process.env.MCP_MINER_QA_CLEANUP === "1";
const WORDS = (process.env.MCP_MINER_QA_WORDS || "verify,signal,orbit,beacon,quartz,cobalt,nickel,comet")
  .split(",")
  .map((word) => word.trim().toLowerCase())
  .filter(Boolean);

if (process.env.MCP_MINER_EMAIL_VERIFICATION_QA !== "1") {
  throw new Error("Refusing to run production email QA without MCP_MINER_EMAIL_VERIFICATION_QA=1.");
}

async function requestJson(url, options, expectedStatus = 200) {
  const response = await fetch(url, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : {};
  if (response.status !== expectedStatus) {
    throw new Error(`${options.method || "GET"} ${url} expected ${expectedStatus}, got ${response.status}: ${text}`);
  }
  return body;
}

function firebaseAdmin() {
  const admin = require("../firebase/functions/node_modules/firebase-admin");
  if (!admin.apps.length) {
    admin.initializeApp({ projectId: PROJECT_ID });
  }
  return admin;
}

function randomPassword() {
  return `${crypto.randomBytes(18).toString("base64url")}Aa1!`;
}

function qaEmail(word) {
  const suffix = EXACT_WORD_ADDRESSES ? word : `${word}-${RUN_ID}`;
  return `${EMAIL_LOCAL}+${suffix}@${EMAIL_DOMAIN}`;
}

async function signUp(email) {
  return requestJson(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${API_KEY}`, {
    method: "POST",
    body: JSON.stringify({
      email,
      password: randomPassword(),
      returnSecureToken: true
    })
  });
}

async function sendVerificationEmail(idToken) {
  return requestJson(`https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${API_KEY}`, {
    method: "POST",
    body: JSON.stringify({
      requestType: "VERIFY_EMAIL",
      idToken
    })
  });
}

async function runCycle(word, index) {
  const email = qaEmail(word);
  const auth = await signUp(email);
  const verification = await sendVerificationEmail(auth.idToken);
  return {
    ok: true,
    issueIndex: index + 1,
    word,
    email,
    uid: auth.localId,
    requestType: verification.requestType || "VERIFY_EMAIL"
  };
}

async function cleanupAccounts(results) {
  const admin = firebaseAdmin();
  const auth = admin.auth();
  const cleaned = [];
  for (const result of results) {
    const cleanupResult = { email: result.email, uid: result.uid, ok: true };
    try {
      await auth.deleteUser(result.uid);
    } catch (error) {
      cleanupResult.ok = false;
      cleanupResult.error = error.message;
    }
    cleaned.push(cleanupResult);
  }
  return cleaned;
}

async function main() {
  if (WORDS.length !== 8) {
    throw new Error(`Expected exactly 8 QA words, got ${WORDS.length}.`);
  }

  const results = [];
  for (const [index, word] of WORDS.entries()) {
    results.push(await runCycle(word, index));
  }
  const cleanup = CLEANUP ? await cleanupAccounts(results) : [];

  console.log(JSON.stringify({
    ok: true,
    projectId: PROJECT_ID,
    runId: RUN_ID,
    cleanupEnabled: CLEANUP,
    cleanup,
    accountCount: results.length,
    gmailSearch: `to:(${results.map((result) => result.email).join(" OR ")}) newer_than:1d`,
    accounts: results
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
