function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function finiteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function indexById(list, label, failures) {
  const index = new Map();
  if (!Array.isArray(list)) {
    failures.push({ code: "LEDGER_ARRAY_REQUIRED", path: label, message: `${label} must be an array` });
    return index;
  }
  list.forEach((entry, position) => {
    const id = typeof entry?.id === "string" ? entry.id.trim() : "";
    if (!id) {
      failures.push({ code: "ENTITY_ID_REQUIRED", path: `${label}[${position}].id`, message: "Every ledger entry needs a stable id" });
      return;
    }
    if (index.has(id)) failures.push({ code: "DUPLICATE_ENTITY_ID", path: `${label}[${position}].id`, message: `Duplicate ${label} id: ${id}` });
    else index.set(id, entry);
  });
  return index;
}

function ref(index, id, code, path, label, failures) {
  if (id === null || id === undefined || id === "") return null;
  if (typeof id !== "string" || !index.has(id)) {
    failures.push({ code, path, message: `Unknown ${label}: ${String(id)}` });
    return null;
  }
  return index.get(id);
}

export function auditEntityStateLedger(ledger) {
  const failures = [];
  const warnings = [];
  if (!isObject(ledger)) return { decision: "HARD_FAIL", failures: [{ code: "LEDGER_OBJECT_REQUIRED", path: "$", message: "Ledger must be a JSON object" }], warnings: [], summary: {} };
  if (ledger.version !== 1) failures.push({ code: "UNSUPPORTED_LEDGER_VERSION", path: "version", message: "Only entity-state-ledger version 1 is supported" });
  if (!Number.isInteger(ledger.chapterOrdinal) || ledger.chapterOrdinal < 0) failures.push({ code: "CHAPTER_ORDINAL_INVALID", path: "chapterOrdinal", message: "chapterOrdinal must be a non-negative integer" });

  const characters = indexById(ledger.characters, "characters", failures);
  const locations = indexById(ledger.locations, "locations", failures);
  const items = indexById(ledger.items, "items", failures);
  const sources = indexById(ledger.sources, "sources", failures);
  const knowledge = indexById(ledger.knowledge, "knowledge", failures);
  const relationships = indexById(ledger.relationships, "relationships", failures);
  const accounts = indexById(ledger.moneyAccounts, "moneyAccounts", failures);
  const health = indexById(ledger.healthConditions, "healthConditions", failures);
  const foreshadows = indexById(ledger.foreshadows, "foreshadows", failures);

  for (const [id, character] of characters) {
    ref(locations, character.locationId, "CHARACTER_LOCATION_UNKNOWN", `characters.${id}.locationId`, "location", failures);
    if (!["PRESENT", "ABSENT", "UNKNOWN"].includes(character.presence)) failures.push({ code: "CHARACTER_PRESENCE_INVALID", path: `characters.${id}.presence`, message: "presence must be PRESENT, ABSENT or UNKNOWN" });
  }

  const scene = ledger.currentScene;
  if (!isObject(scene)) failures.push({ code: "CURRENT_SCENE_REQUIRED", path: "currentScene", message: "currentScene is required" });
  else {
    const sceneLocation = ref(locations, scene.locationId, "SCENE_LOCATION_UNKNOWN", "currentScene.locationId", "location", failures);
    if (!Array.isArray(scene.presentCharacterIds)) failures.push({ code: "SCENE_PRESENT_ARRAY_REQUIRED", path: "currentScene.presentCharacterIds", message: "presentCharacterIds must be an array" });
    else {
      const present = new Set();
      scene.presentCharacterIds.forEach((characterId, position) => {
        if (present.has(characterId)) failures.push({ code: "SCENE_CHARACTER_DUPLICATE", path: `currentScene.presentCharacterIds[${position}]`, message: `Duplicate present character: ${characterId}` });
        present.add(characterId);
        const character = ref(characters, characterId, "SCENE_CHARACTER_UNKNOWN", `currentScene.presentCharacterIds[${position}]`, "character", failures);
        if (character && character.presence !== "PRESENT") failures.push({ code: "SCENE_PRESENCE_CONFLICT", path: `characters.${characterId}.presence`, message: `${characterId} is listed in the scene but is not PRESENT` });
        if (character && sceneLocation && character.locationId !== scene.locationId) failures.push({ code: "SCENE_LOCATION_CONFLICT", path: `characters.${characterId}.locationId`, message: `${characterId} is present but located elsewhere` });
      });
      for (const [characterId, character] of characters) if (character.presence === "PRESENT" && !present.has(characterId)) failures.push({ code: "PRESENT_CHARACTER_MISSING_FROM_SCENE", path: `characters.${characterId}.presence`, message: `${characterId} is PRESENT but absent from currentScene` });
    }
  }

  for (const [id, item] of items) {
    const holder = ref(characters, item.holderId, "ITEM_HOLDER_UNKNOWN", `items.${id}.holderId`, "character", failures);
    ref(locations, item.locationId, "ITEM_LOCATION_UNKNOWN", `items.${id}.locationId`, "location", failures);
    if (!item.holderId && !item.locationId) warnings.push({ code: "ITEM_LOCATION_UNRESOLVED", path: `items.${id}`, message: `${id} has neither holder nor location` });
    if (holder && item.locationId && holder.locationId && item.locationId !== holder.locationId) failures.push({ code: "ITEM_HOLDER_LOCATION_CONFLICT", path: `items.${id}.locationId`, message: `${id} location conflicts with its holder` });
  }

  for (const [id, entry] of knowledge) {
    if (!Array.isArray(entry.knownBy)) failures.push({ code: "KNOWLEDGE_KNOWN_BY_REQUIRED", path: `knowledge.${id}.knownBy`, message: "knownBy must be an array" });
    else entry.knownBy.forEach((known, position) => {
      ref(characters, known?.characterId, "KNOWLEDGE_CHARACTER_UNKNOWN", `knowledge.${id}.knownBy[${position}].characterId`, "character", failures);
      ref(sources, known?.sourceId, "KNOWLEDGE_SOURCE_UNKNOWN", `knowledge.${id}.knownBy[${position}].sourceId`, "source", failures);
    });
  }

  for (const [id, relation] of relationships) {
    ref(characters, relation.fromCharacterId, "RELATIONSHIP_CHARACTER_UNKNOWN", `relationships.${id}.fromCharacterId`, "character", failures);
    ref(characters, relation.toCharacterId, "RELATIONSHIP_CHARACTER_UNKNOWN", `relationships.${id}.toCharacterId`, "character", failures);
    if (relation.fromCharacterId && relation.fromCharacterId === relation.toCharacterId) warnings.push({ code: "SELF_RELATIONSHIP", path: `relationships.${id}`, message: `${id} points to the same character` });
  }

  for (const [id, account] of accounts) {
    ref(characters, account.ownerId, "MONEY_OWNER_UNKNOWN", `moneyAccounts.${id}.ownerId`, "character", failures);
    if (!finiteNumber(account.openingBalance) || !finiteNumber(account.currentBalance) || !Array.isArray(account.changes)) {
      failures.push({ code: "MONEY_ACCOUNT_INVALID", path: `moneyAccounts.${id}`, message: "Money account requires numeric opening/current balance and a changes array" });
      continue;
    }
    const changeIds = new Set();
    let expected = account.openingBalance;
    account.changes.forEach((change, position) => {
      if (!change?.id || changeIds.has(change.id)) failures.push({ code: "MONEY_CHANGE_ID_INVALID", path: `moneyAccounts.${id}.changes[${position}].id`, message: "Money changes need unique ids" });
      else changeIds.add(change.id);
      if (!finiteNumber(change?.amount)) failures.push({ code: "MONEY_CHANGE_AMOUNT_INVALID", path: `moneyAccounts.${id}.changes[${position}].amount`, message: "Money change amount must be finite" });
      else expected += change.amount;
      if (!Number.isInteger(change?.chapterOrdinal) || change.chapterOrdinal < 0 || change.chapterOrdinal > ledger.chapterOrdinal) failures.push({ code: "MONEY_CHANGE_CHAPTER_INVALID", path: `moneyAccounts.${id}.changes[${position}].chapterOrdinal`, message: "Money change chapter must be within the ledger window" });
    });
    if (Math.abs(expected - account.currentBalance) > 1e-9) failures.push({ code: "MONEY_BALANCE_MISMATCH", path: `moneyAccounts.${id}.currentBalance`, message: `Expected ${expected}, got ${account.currentBalance}` });
  }

  for (const [id, condition] of health) {
    ref(characters, condition.characterId, "HEALTH_CHARACTER_UNKNOWN", `healthConditions.${id}.characterId`, "character", failures);
    if (!Number.isInteger(condition.startChapter) || condition.startChapter < 0 || !Number.isInteger(condition.recoveryNotBeforeChapter) || condition.recoveryNotBeforeChapter < condition.startChapter) failures.push({ code: "HEALTH_WINDOW_INVALID", path: `healthConditions.${id}`, message: "Health recovery window is invalid" });
    if (condition.status === "RESOLVED") {
      if (!Number.isInteger(condition.resolvedChapter)) failures.push({ code: "HEALTH_RESOLUTION_CHAPTER_REQUIRED", path: `healthConditions.${id}.resolvedChapter`, message: "Resolved condition needs resolvedChapter" });
      else if (condition.resolvedChapter < condition.recoveryNotBeforeChapter) failures.push({ code: "HEALTH_RESOLVED_TOO_EARLY", path: `healthConditions.${id}.resolvedChapter`, message: `${id} resolves before its minimum recovery chapter` });
    } else if (condition.status === "ACTIVE" && ledger.chapterOrdinal >= condition.recoveryNotBeforeChapter) warnings.push({ code: "HEALTH_REVIEW_DUE", path: `healthConditions.${id}`, message: `${id} reached its review window; do not auto-heal without prose evidence` });
    else if (!['ACTIVE', 'RESOLVED'].includes(condition.status)) failures.push({ code: "HEALTH_STATUS_INVALID", path: `healthConditions.${id}.status`, message: "Health status must be ACTIVE or RESOLVED" });
  }

  for (const [id, item] of foreshadows) {
    if (!["ACTIVE", "RESOLVED", "DROPPED"].includes(item.status)) failures.push({ code: "FORESHADOW_STATUS_INVALID", path: `foreshadows.${id}.status`, message: "Foreshadow status must be ACTIVE, RESOLVED or DROPPED" });
    if (!Number.isInteger(item.firstChapter) || item.firstChapter < 0 || !Number.isInteger(item.lastAdvancedChapter) || item.lastAdvancedChapter < item.firstChapter || item.lastAdvancedChapter > ledger.chapterOrdinal) failures.push({ code: "FORESHADOW_WINDOW_INVALID", path: `foreshadows.${id}`, message: "Foreshadow chapter window is invalid" });
    if (item.status === "ACTIVE" && Number.isInteger(item.nextAdvanceByChapter) && item.nextAdvanceByChapter < ledger.chapterOrdinal) warnings.push({ code: "FORESHADOW_OVERDUE", path: `foreshadows.${id}.nextAdvanceByChapter`, message: `${id} is overdue for review, not forced resolution` });
    if (item.status === "RESOLVED" && !Number.isInteger(item.resolvedChapter)) failures.push({ code: "FORESHADOW_RESOLUTION_CHAPTER_REQUIRED", path: `foreshadows.${id}.resolvedChapter`, message: "Resolved foreshadow needs resolvedChapter" });
  }

  return {
    decision: failures.length ? "HARD_FAIL" : warnings.length ? "REVIEW" : "PASS",
    failures,
    warnings,
    summary: {
      chapterOrdinal: Number.isInteger(ledger.chapterOrdinal) ? ledger.chapterOrdinal : null,
      characters: characters.size,
      locations: locations.size,
      items: items.size,
      knowledge: knowledge.size,
      relationships: relationships.size,
      moneyAccounts: accounts.size,
      healthConditions: health.size,
      foreshadows: foreshadows.size
    },
    note: "Deterministic consistency audit only. Warnings locate review points and must not be converted into prose KPIs or automatic plot changes."
  };
}
