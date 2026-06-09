"use strict";

const TOPIC_PALETTES = {
  charter: ["#48d19a", "#d9b46e", "#6bd1ff"],
  profile: ["#58c79b", "#f1d486", "#7aa8ff"],
  company: ["#48d19a", "#9be7c4", "#d9b46e"],
  install: ["#6bd1ff", "#48d19a", "#d76cd5"],
  sync: ["#48d19a", "#78a6ff", "#e6f7ff"],
  privacy: ["#d9b46e", "#48d19a", "#f7fbf5"],
  devices: ["#7aa8ff", "#48d19a", "#d9b46e"],
  reports: ["#d76cd5", "#48d19a", "#f1d486"]
};

function hashTopic(topic, salt) {
  return Array.from(`${topic}:${salt}`).reduce((total, char) => ((total * 33) + char.charCodeAt(0)) >>> 0, 5381);
}

function point(seed, index, min, max) {
  const raw = Math.sin(seed + index * 41.7) * 10000;
  return min + ((raw - Math.floor(raw)) * (max - min));
}

function asteroidPoints(seed) {
  return Array.from({ length: 14 }, (_, index) => {
    const angle = (Math.PI * 2 * index) / 14;
    const radius = point(seed, index, 44, 72);
    const x = 128 + Math.cos(angle) * radius;
    const y = 128 + Math.sin(angle) * radius;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
}

function generatedTopicSvg(topic, index) {
  const colors = TOPIC_PALETTES[topic] || TOPIC_PALETTES.charter;
  const seed = hashTopic(topic, index + Date.now().toString(36).slice(-3));
  const stars = Array.from({ length: 18 }, (_, star) => {
    const x = point(seed, star, 18, 238).toFixed(1);
    const y = point(seed, star + 90, 18, 238).toFixed(1);
    const r = point(seed, star + 180, 0.8, 2.2).toFixed(1);
    return `<circle cx="${x}" cy="${y}" r="${r}" fill="rgba(247,251,245,0.78)"/>`;
  }).join("");
  const orbitA = point(seed, 201, -18, 18).toFixed(1);
  const orbitB = point(seed, 202, -18, 18).toFixed(1);
  return `
    <svg viewBox="0 0 256 256" role="img" aria-label="Generated MCP Miner ${topic} art" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="glow-${topic}-${index}" cx="38%" cy="32%" r="72%">
          <stop offset="0" stop-color="${colors[0]}" stop-opacity="0.64"/>
          <stop offset="0.52" stop-color="#102822" stop-opacity="0.9"/>
          <stop offset="1" stop-color="#07111d"/>
        </radialGradient>
        <linearGradient id="rock-${topic}-${index}" x1="44" y1="40" x2="210" y2="220">
          <stop offset="0" stop-color="${colors[1]}"/>
          <stop offset="0.52" stop-color="#7f877d"/>
          <stop offset="1" stop-color="#37443e"/>
        </linearGradient>
      </defs>
      <rect width="256" height="256" rx="28" fill="url(#glow-${topic}-${index})"/>
      <g opacity="0.88">${stars}</g>
      <ellipse cx="128" cy="136" rx="88" ry="72" fill="none" stroke="${colors[0]}" stroke-width="4" opacity="0.42" transform="rotate(${orbitA} 128 136)"/>
      <ellipse cx="128" cy="136" rx="98" ry="42" fill="none" stroke="${colors[2]}" stroke-width="3" opacity="0.34" transform="rotate(${orbitB} 128 136)"/>
      <polygon points="${asteroidPoints(seed)}" fill="url(#rock-${topic}-${index})" stroke="${colors[0]}" stroke-width="3"/>
      <circle cx="${point(seed, 301, 88, 144).toFixed(1)}" cy="${point(seed, 302, 86, 148).toFixed(1)}" r="22" fill="${colors[0]}" opacity="0.45"/>
      <circle cx="${point(seed, 303, 96, 166).toFixed(1)}" cy="${point(seed, 304, 112, 174).toFixed(1)}" r="8" fill="#0b1714" opacity="0.5"/>
      <path d="M58 190 C88 222, 169 228, 205 185" fill="none" stroke="${colors[0]}" stroke-width="7" opacity="0.72" stroke-linecap="round"/>
    </svg>
  `;
}

document.querySelectorAll(".generated-topic-art").forEach((node, index) => {
  node.innerHTML = generatedTopicSvg(node.dataset.topic || "charter", index);
});
