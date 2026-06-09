const MCP_MINER_HOST_AUTH_DOMAINS = new Set([
  "mcpminer.net",
  "www.mcpminer.net",
  "mcp-miner.web.app",
  "mcp-miner.firebaseapp.com"
]);

window.MCP_MINER_FIREBASE_CONFIG = {
  apiKey: "AIzaSyBwLEA9IdoPSeEV_PRY5zFa5WJbE5NSG4o",
  authDomain: MCP_MINER_HOST_AUTH_DOMAINS.has(window.location.hostname)
    ? window.location.hostname
    : "mcp-miner.firebaseapp.com",
  projectId: "mcp-miner",
  storageBucket: "mcp-miner.firebasestorage.app",
  messagingSenderId: "197641607989",
  appId: "1:197641607989:web:2946d9c9423702b9984a7c"
};
