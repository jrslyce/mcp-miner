"use strict";

const assert = require("assert");
const {
  backupConflict,
  sanitizeBackupPayload
} = require("../firebase/functions/src/backups");

let checks = 0;
function check(message, fn) {
  assert.ok(fn(), message);
  checks += 1;
}

const safe = sanitizeBackupPayload({
  profile: {
    display_name: "Jared the Prospector",
    suit_style: "patched teal survey suit",
    customization_unlocks: ["suit_patch_basic"]
  },
  progress: {
    space_bucks: 45,
    suit_condition: 96,
    current_asteroid_class_id: "asteroid_quartz_belt"
  },
  inventory: {
    mat_chonks: 160
  },
  syncMetadata: {
    last_pushed_sequence: 4
  }
});

check("backup sanitizer should keep only supported public sections", () => {
  return safe.privacyClass === "abstract" &&
    safe.sections.profile.display_name === "Jared the Prospector" &&
    safe.sections.progress.space_bucks === 45 &&
    safe.checksum.length === 64 &&
    safe.byteSize > 0;
});

check("backup sanitizer should reject prompt/code/path-style private fields", () => {
  try {
    sanitizeBackupPayload({
      profile: {
        display_name: "Private",
        avatar_concept_prompt: "please implement this"
      }
    });
    return false;
  } catch (error) {
    return error.message.includes("not allowed");
  }
});

check("backup sanitizer should reject private workspace-looking values", () => {
  try {
    sanitizeBackupPayload({
      profile: {
        display_name: "/Users/jared/Code/private"
      }
    });
    return false;
  } catch (error) {
    return error.message.includes("private workspace data");
  }
});

check("backup conflict helper should classify local/cloud freshness and device relation", () => {
  const result = backupConflict({
    localUpdatedAt: "2026-05-26T00:00:10.000Z",
    cloudUpdatedAt: "2026-05-26T00:00:00.000Z",
    sourceDeviceId: "device_a",
    targetDeviceId: "device_b"
  });
  return result.freshness === "local_newer" && result.deviceRelation === "different_device";
});

console.log(JSON.stringify({
  ok: true,
  checks
}, null, 2));
