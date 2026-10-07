  function developerRetentionMs() {
    return normalizeDeveloperRetentionMinutes(config.developerRetentionMinutes) * 60000;
  }
  function developerRetentionLabel() {
    const minutes = normalizeDeveloperRetentionMinutes(config.developerRetentionMinutes);
    return minutes % 1440 === 0 ? `${minutes / 1440}天` : minutes % 60 === 0 ? `${minutes / 60}小时` : `${minutes}分钟`;
  }
  function synchronizeDeveloperRetention(raw = null) {
    const values = [decodeDeveloperStorage(raw)];
    try { values.push(decodeDeveloperStorage(GM_getValue(STORAGE_KEY, null))); } catch (_) {}
    try { values.push(decodeDeveloperStorage(developerLocalStorage()?.getItem(STORAGE_KEY + ':durable-v1'))); } catch (_) {}
    // Old pages may save an older whole config without this field. Such a save
    // must not undo a retention duration selected in the newer document.
    const latest = values.filter(value => value && typeof value === 'object' && !Array.isArray(value) && Object.prototype.hasOwnProperty.call(value, 'developerRetentionMinutes'))
      .sort((a, b) => Number(b.configurationSavedAt || 0) - Number(a.configurationSavedAt || 0))[0];
    if (!latest || Number(latest.configurationSavedAt || 0) < developerRetentionConfigurationSavedAt) return false;
    const next = normalizeDeveloperRetentionMinutes(latest.developerRetentionMinutes);
    const changed = config.developerRetentionMinutes !== next;
    config.developerRetentionMinutes = next;
    developerRetentionConfigurationSavedAt = Number(latest.configurationSavedAt || 0);
    config.configurationSavedAt = Math.max(Number(config.configurationSavedAt || 0), developerRetentionConfigurationSavedAt);
    return changed;
  }

  function decodeDeveloperStorage(raw) {
    try { return typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (_) { return null; }
  }
  function developerLocalStorage() {
    try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch (_) { return null; }
  }
  function readDeveloperReset() {
    const markers = [debugResetMarker];
    try { markers.push(decodeDeveloperStorage(GM_getValue(DEBUG_RESET_KEY, null))); } catch (_) {}
    try { markers.push(decodeDeveloperStorage(developerLocalStorage()?.getItem(DEBUG_RESET_KEY))); } catch (_) {}
    debugResetMarker = markers.filter(value => value && Number.isFinite(Number(value.at))).sort((a, b) => Number(b.at) - Number(a.at) || String(b.token || '').localeCompare(String(a.token || '')))[0] || { at: 0, token: '' };
    return debugResetMarker;
  }
  function developerEventId(event) {
    if (event.eventId) return String(event.eventId);
    // Older arrays have no IDs. Stable content identity prevents duplicate migration reads.
    const text = JSON.stringify(event);
    let hash = 2166136261;
    for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
    return `legacy:${event.at || ''}:${text.length}:${(hash >>> 0).toString(36)}`;
  }
  function retainedDeveloperEvents(events, now = Date.now()) {
    const cutoff = now - developerRetentionMs();
    return (Array.isArray(events) ? events : []).filter(event => {
      const at = Date.parse(event?.at || '');
      return Number.isFinite(at) && at >= cutoff && (at > Number(debugResetMarker.at) || (at === Number(debugResetMarker.at) && event.debugResetId === debugResetMarker.token));
    });
  }
  function developerJournalKeys() {
    const keys = new Set();
    try { if (typeof GM_listValues === 'function') for (const key of GM_listValues()) if (key.startsWith(DEBUG_JOURNAL_PREFIX) || key.startsWith(DEBUG_LEGACY_JOURNAL_PREFIX)) keys.add(key); } catch (_) {}
    try {
      const storage = developerLocalStorage();
      for (let i = 0; storage && i < storage.length; i++) { const key = storage.key(i); if (key?.startsWith(DEBUG_JOURNAL_PREFIX) || key?.startsWith(DEBUG_LEGACY_JOURNAL_PREFIX)) keys.add(key); }
    } catch (_) {}
    return [...keys];
  }
  function sealLegacyDeveloperEvents(events) {
    const buckets = new Map();
    for (const event of events) {
      const bucketStart = Math.floor(Date.parse(event.at) / 60000) * 60000;
      if (!buckets.has(bucketStart)) buckets.set(bucketStart, new Map());
      const eventId = developerEventId(event);
      buckets.get(bucketStart).set(eventId, { ...event, eventId });
    }
    for (const [bucketStart, items] of buckets) {
      const snapshot = [...items.values()].sort((a, b) => a.eventId.localeCompare(b.eventId));
      const text = JSON.stringify(snapshot);
      let first = 2166136261, second = 3339675911;
      for (let i = 0; i < text.length; i++) {
        first = Math.imul(first ^ text.charCodeAt(i), 16777619);
        second = Math.imul(second ^ text.charCodeAt(i), 2246822519);
      }
      const writerId = `legacy-${text.length.toString(36)}-${(first >>> 0).toString(36)}-${(second >>> 0).toString(36)}`;
      const key = `${DEBUG_JOURNAL_PREFIX}${writerId}:${bucketStart}`;
      const journal = { schema: 2, writerId, bucketStart, events: snapshot };
      // Seal only legacy records not already present in an immutable snapshot.
      // The old script may overwrite its array later; this key remains independent.
      try { if (!developerLocalStorage()?.getItem(key)) developerLocalStorage()?.setItem(key, JSON.stringify(journal)); } catch (_) {}
      try { if (!GM_getValue(key, null)) GM_setValue(key, journal); } catch (_) {}
    }
  }
  function collectDeveloperEvents(cleanup = false) {
    readDeveloperReset();
    const all = [...debugEvents, ...debugWriterEvents];
    let legacyToSeal = [];
    const journalIds = new Set();
    try {
      const legacy = decodeDeveloperStorage(GM_getValue(DEBUG_STORAGE_KEY, []));
      if (Array.isArray(legacy)) {
        const retained = retainedDeveloperEvents(legacy);
        legacyToSeal = retained;
        for (const event of retained) all.push(event);
        // Read legacy data for compatibility, then remove only expired entries.
        if (cleanup && retained.length !== legacy.length) GM_setValue(DEBUG_STORAGE_KEY, retained);
      }
    } catch (_) {}
    for (const key of developerJournalKeys()) {
      const legacyJournal = key.startsWith(DEBUG_LEGACY_JOURNAL_PREFIX);
      const bucketStart = Number(key.slice(key.lastIndexOf(':') + 1));
      if (cleanup && Number.isFinite(bucketStart) && bucketStart + 60000 <= Date.now() - developerRetentionMs()) {
        try { if (typeof GM_deleteValue === 'function') GM_deleteValue(key); } catch (_) {}
        try { developerLocalStorage()?.removeItem(key); } catch (_) {}
        debugJournalSignatures.delete(key);
        continue;
      }
      const copies = [];
      try { copies.push(decodeDeveloperStorage(GM_getValue(key, null))); } catch (_) {}
      try { copies.push(decodeDeveloperStorage(developerLocalStorage()?.getItem(key))); } catch (_) {}
      const events = copies.flatMap(copy => Array.isArray(copy?.events) ? copy.events : []);
      const retained = retainedDeveloperEvents(events);
      for (const event of retained) all.push(event);
      if (legacyJournal) for (const event of retained) legacyToSeal.push(event);
      else for (const event of retained) journalIds.add(developerEventId(event));
      if (cleanup && !retained.length) {
        try { if (typeof GM_deleteValue === 'function') GM_deleteValue(key); } catch (_) {}
        try { developerLocalStorage()?.removeItem(key); } catch (_) {}
        debugJournalSignatures.delete(key);
      }
    }
    sealLegacyDeveloperEvents(legacyToSeal.filter(event => !journalIds.has(developerEventId(event))));
    const unique = new Map();
    for (const event of retainedDeveloperEvents(all)) {
      const eventId = developerEventId(event);
      if (!unique.has(eventId)) unique.set(eventId, { ...event, eventId });
    }
    debugEvents.length = 0;
    for (const event of [...unique.values()].sort((a, b) => Date.parse(a.at) - Date.parse(b.at))) debugEvents.push(event);
    const own = retainedDeveloperEvents(debugWriterEvents);
    debugWriterEvents.length = 0;
    for (const event of own) debugWriterEvents.push(event);
  }
  function persistDeveloperEvents() {
    if (debugPersistTimer) clearTimeout(debugPersistTimer);
    debugPersistTimer = null;
    // Writes only touch this document's events; aggregation is done on load,
    // minute cleanup or explicit read, rather than scanning an hour every second.
    synchronizeDeveloperRetention();
    pruneDeveloperEvents();
    const buckets = new Map();
    for (const event of debugWriterEvents) {
      const bucketStart = Math.floor(Date.parse(event.at) / 60000) * 60000;
      if (!buckets.has(bucketStart)) buckets.set(bucketStart, []);
      buckets.get(bucketStart).push(event);
    }
    // Each document owns its minute keys. Closed writers can be cleaned by deleting
    // expired buckets without rewriting an active writer's newer observations.
    for (const [bucketStart, events] of buckets) {
      const key = `${debugJournalKey}:${bucketStart}`;
      const signature = events.map(event => event.eventId).join('|');
      if (debugJournalSignatures.get(key) === signature) continue;
      const journal = { schema: 2, writerId: debugWriterId, bucketStart, events };
      try { developerLocalStorage()?.setItem(key, JSON.stringify(journal)); } catch (_) {}
      try { GM_setValue(key, journal); } catch (_) {}
      debugJournalSignatures.set(key, signature);
    }
  }
  function scheduleDeveloperPersistence(immediate = false) {
    if (immediate) { persistDeveloperEvents(); return; }
    if (debugPersistTimer) return;
    debugPersistTimer = setTimeout(persistDeveloperEvents, DEBUG_PERSIST_INTERVAL_MS);
  }
  function flushDeveloperEvents() {
    if (debugPersistTimer) persistDeveloperEvents();
  }
  function isCriticalDeveloperEvent(event, options = {}) {
    return !!options.force || /协议进入|进入(?:成功|失败|异常)|路由变化|运行版本|运行时(?:停止|重启)|异常|拒绝|失败|候选被其他用户占用|自动进入时段到期关闭/.test(event);
  }
  function scheduleDeveloperCleanup() {
    if (debugCleanupTimer) return;
    debugCleanupTimer = setInterval(() => {
      synchronizeDeveloperRetention();
      const changed = pruneDeveloperEvents(Date.now());
      if (changed || debugPersistTimer) persistDeveloperEvents();
      collectDeveloperEvents(true);
      if (typeof pruneCandidateLifecycle === 'function') pruneCandidateLifecycle();
      refreshDeveloperRetentionUI();
    }, DEBUG_CLEANUP_INTERVAL_MS);
  }

  function loadDeveloperEvents() {
    collectDeveloperEvents(true);
    try {
      if (typeof GM_addValueChangeListener === 'function') GM_addValueChangeListener(DEBUG_RESET_KEY, (_key, _oldValue, newValue) => {
        const marker = decodeDeveloperStorage(newValue);
        if (marker && Number(marker.at) >= Number(debugResetMarker.at)) debugResetMarker = marker;
        readDeveloperReset(); pruneDeveloperEvents(); debugLastAt.clear();
      });
      if (typeof GM_addValueChangeListener === 'function') GM_addValueChangeListener(STORAGE_KEY, (_key, _oldValue, newValue) => {
        if (!synchronizeDeveloperRetention(newValue)) return;
        pruneDeveloperEvents(); persistDeveloperEvents(); collectDeveloperEvents(true);
        if (typeof pruneCandidateLifecycle === 'function') pruneCandidateLifecycle();
        refreshDeveloperRetentionUI();
      });
    } catch (_) {}
    scheduleDeveloperCleanup();
  }
  function clearDeveloperEvents() {
    debugResetMarker = { at: Date.now(), token: `${debugWriterId}:clear:${++debugEventSequence}` };
    try { developerLocalStorage()?.setItem(DEBUG_RESET_KEY, JSON.stringify(debugResetMarker)); } catch (_) {}
    try { GM_setValue(DEBUG_RESET_KEY, debugResetMarker); GM_setValue(DEBUG_STORAGE_KEY, []); } catch (_) {}
    debugEvents.length = 0;
    debugWriterEvents.length = 0;
    debugJournalSignatures.clear();
    debugLastAt.clear();
    collectDeveloperEvents(true);
    persistDeveloperEvents();
  }
  loadDeveloperEvents();

