import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const VERSION = '0.2.2';
export const MAX_PAIRS = 50;
export const MAX_LEDGER = 1000;
export const RESTORE_NOTICE_MS = 8000;
export const CONFIRM_TIMEOUT_MS = 60_000;
export const SWITCH_MODES = ['ask', 'toggle', 'off'];

function isPlainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

/**
 * Reliable ESM CLI entrypoint check that resolves symlinks and handles spaces/special characters.
 */
export function isCliEntrypoint(importMetaUrl, argv1 = process.argv[1]) {
  if (!importMetaUrl || !argv1) return false;
  try {
    const resolved = fs.realpathSync(argv1);
    if (pathToFileURL(resolved).href === importMetaUrl) return true;
  } catch {
    // Fallback if argv1 does not exist on disk yet
  }
  try {
    return pathToFileURL(path.resolve(argv1)).href === importMetaUrl;
  } catch {
    return false;
  }
}

export function shortId(id) {
  const text = String(id || '').trim();
  return text ? text.slice(0, 8) : 'unknown';
}

export function normalizeSwitchMode(value) {
  const mode = String(value || '').trim().toLowerCase();
  return SWITCH_MODES.includes(mode) ? mode : 'ask';
}

export function isFreshEyeAgentName(value) {
  const name = String(value || '').trim().toLowerCase();
  return (
    name === 'fresheye' ||
    name === 'cyclops-fresheye:fresheye' ||
    name === 'cyclops-fresheye' ||
    name.endsWith(':fresheye') ||
    name.startsWith('fresheye ') ||
    name.startsWith('fresheye·')
  );
}

export function defaultStore() {
  return {
    version: VERSION,
    settings: {
      switchMode: 'ask',
    },
    pairs: {},
    ledger: [],
    activeSession: null,
    pendingOpen: null,
    pendingSwitch: null,
    lastRestored: null,
  };
}

export function defaultStorePath(env = process.env, homeDir = os.homedir()) {
  const override = String(env.CYCLOPS_FRESHEYE_STORE || '').trim();
  if (override) return path.resolve(override);
  const stateRoot = String(env.XDG_STATE_HOME || '').trim() || path.join(homeDir, '.local', 'state');
  return path.join(stateRoot, 'cyclops-fresheye', 'store.json');
}

export function loadStore(storePath) {
  try {
    const raw = fs.readFileSync(storePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return defaultStore();
    }
    const pairs = {};
    if (parsed.pairs && typeof parsed.pairs === 'object' && !Array.isArray(parsed.pairs)) {
      for (const [freshId, entry] of Object.entries(parsed.pairs)) {
        if (
          freshId &&
          entry &&
          typeof entry === 'object' &&
          typeof entry.originId === 'string' &&
          entry.originId.trim() &&
          entry.originId !== freshId
        ) {
          pairs[freshId] = {
            originId: entry.originId.trim(),
            originRoot: typeof entry.originRoot === 'string' ? entry.originRoot : '',
            model: typeof entry.model === 'string' ? entry.model : '',
            mode: typeof entry.mode === 'string' ? entry.mode : 'session',
            promptPreview: typeof entry.promptPreview === 'string' ? entry.promptPreview : '',
            createdAt: typeof entry.createdAt === 'string' ? entry.createdAt : new Date(0).toISOString(),
          };
        }
      }
    }
    const ledger = [];
    if (Array.isArray(parsed.ledger)) {
      for (const item of parsed.ledger.slice(-MAX_LEDGER)) {
        if (item && typeof item === 'object' && typeof item.event === 'string' && typeof item.at === 'string') {
          ledger.push({
            at: item.at,
            event: item.event,
            fromId: typeof item.fromId === 'string' ? item.fromId : '',
            toId: typeof item.toId === 'string' ? item.toId : '',
            originId: typeof item.originId === 'string' ? item.originId : '',
            freshId: typeof item.freshId === 'string' ? item.freshId : '',
            model: typeof item.model === 'string' ? item.model : '',
            mode: typeof item.mode === 'string' ? item.mode : '',
            promptPreview: typeof item.promptPreview === 'string' ? item.promptPreview : '',
            note: typeof item.note === 'string' ? item.note : '',
          });
        }
      }
    }
    return {
      version: VERSION,
      settings: {
        switchMode: normalizeSwitchMode(parsed.settings?.switchMode),
      },
      pairs: prunePairs(pairs),
      ledger,
      activeSession: isPlainObject(parsed.activeSession) ? parsed.activeSession : null,
      pendingOpen: isPlainObject(parsed.pendingOpen) ? parsed.pendingOpen : null,
      pendingSwitch: isPlainObject(parsed.pendingSwitch) ? parsed.pendingSwitch : null,
      lastRestored: isPlainObject(parsed.lastRestored) ? parsed.lastRestored : null,
    };
  } catch {
    return defaultStore();
  }
}

export function saveStore(storePath, store) {
  const dir = path.dirname(storePath);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const normalized = {
    version: VERSION,
    settings: {
      switchMode: normalizeSwitchMode(store?.settings?.switchMode),
    },
    pairs: prunePairs(store?.pairs || {}),
    ledger: Array.isArray(store?.ledger) ? store.ledger.slice(-MAX_LEDGER) : [],
    activeSession: isPlainObject(store?.activeSession) ? store.activeSession : null,
    pendingOpen: isPlainObject(store?.pendingOpen) ? store.pendingOpen : null,
    pendingSwitch: isPlainObject(store?.pendingSwitch) ? store.pendingSwitch : null,
    lastRestored: isPlainObject(store?.lastRestored) ? store.lastRestored : null,
  };
  const tmpPath = `${storePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpPath, `${JSON.stringify(normalized, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmpPath, storePath);
  return normalized;
}

export function prunePairs(pairs, maxPairs = MAX_PAIRS) {
  const entries = Object.entries(pairs || {}).filter(
    ([freshId, entry]) =>
      Boolean(freshId) &&
      entry &&
      typeof entry === 'object' &&
      typeof entry.originId === 'string' &&
      Boolean(entry.originId.trim()) &&
      entry.originId !== freshId,
  );
  entries.sort((a, b) => {
    const aTime = Date.parse(a[1].createdAt || '') || 0;
    const bTime = Date.parse(b[1].createdAt || '') || 0;
    return bTime - aTime;
  });
  return Object.fromEntries(entries.slice(0, maxPairs));
}

/**
 * Given the active session ID, return the original session ID it should pair back to.
 * If the user is already inside a FreshEye session and runs `/fresheye <prompt>` again,
 * the new FreshEye session links back to the original session rather than chaining
 * FreshEye -> FreshEye -> FreshEye.
 */
export function originFor(pairs, currentId) {
  const id = String(currentId || '').trim();
  if (!id) return '';
  const existing = pairs?.[id];
  if (existing && typeof existing.originId === 'string' && existing.originId.trim()) {
    return existing.originId.trim();
  }
  return id;
}

/**
 * Resolve where bare `/fresheye` should switch from `currentId`.
 * Never guesses: returns null unless `currentId` is a known FreshEye session
 * or an original session that opened at least one FreshEye session.
 */
export function pickTarget(pairs, currentId) {
  const id = String(currentId || '').trim();
  if (!id || !pairs || typeof pairs !== 'object') return null;

  const currentPair = pairs[id];
  if (currentPair && currentPair.originId && currentPair.originId !== id) {
    return {
      direction: 'return',
      targetId: currentPair.originId,
      freshId: id,
      pair: currentPair,
    };
  }

  let newestFreshId = '';
  let newestPair = null;
  let newestTime = -1;
  for (const [freshId, entry] of Object.entries(pairs)) {
    if (!entry || entry.originId !== id || freshId === id) continue;
    const ts = Date.parse(entry.createdAt || '') || 0;
    if (ts >= newestTime) {
      newestTime = ts;
      newestFreshId = freshId;
      newestPair = entry;
    }
  }

  if (newestFreshId && newestPair) {
    return {
      direction: 'enter',
      targetId: newestFreshId,
      freshId: newestFreshId,
      pair: newestPair,
    };
  }

  return null;
}

/**
 * Record a newly opened FreshEye session or subagent pair into `store`.
 * Fails closed if IDs are missing or identical.
 */
export function recordOpenPair(
  store,
  { freshId, originId, originRoot = '', model = '', prompt = '', mode = 'subagent', createdAt } = {},
) {
  const fId = String(freshId || '').trim();
  const rawOrigin = String(originId || '').trim();
  const nowIso = createdAt || new Date().toISOString();
  const preview = String(prompt || '').trim().replace(/\s+/g, ' ').slice(0, 80);

  if (!fId || !rawOrigin || fId === rawOrigin) {
    appendLedger(store.ledger, {
      at: nowIso,
      event: 'open-failed',
      fromId: rawOrigin,
      originId: rawOrigin,
      freshId: fId,
      model,
      mode,
      promptPreview: preview,
      note: !fId ? 'missing freshId' : !rawOrigin ? 'missing originId' : 'session ID did not change',
    });
    return { ok: false, reason: 'invalid-ids' };
  }

  const trueOriginId = originFor(store.pairs, rawOrigin);
  if (!trueOriginId || trueOriginId === fId) {
    appendLedger(store.ledger, {
      at: nowIso,
      event: 'open-failed',
      fromId: rawOrigin,
      originId: trueOriginId,
      freshId: fId,
      model,
      mode,
      promptPreview: preview,
      note: 'resolved originId matches freshId',
    });
    return { ok: false, reason: 'origin-equals-fresh' };
  }

  // Idempotency guard: if already recorded with the same origin, update missing fields without duplicate ledger
  if (store.pairs[fId] && store.pairs[fId].originId === trueOriginId) {
    if (model && !store.pairs[fId].model) store.pairs[fId].model = model;
    if (preview && !store.pairs[fId].promptPreview) store.pairs[fId].promptPreview = preview;
    return { ok: true, pair: store.pairs[fId], duplicate: true };
  }

  const pairEntry = {
    originId: trueOriginId,
    originRoot,
    model,
    mode,
    promptPreview: preview,
    createdAt: nowIso,
  };
  store.pairs[fId] = pairEntry;
  store.pairs = prunePairs(store.pairs);

  appendLedger(store.ledger, {
    at: nowIso,
    event: 'open',
    fromId: rawOrigin,
    toId: fId,
    originId: trueOriginId,
    freshId: fId,
    model,
    mode,
    promptPreview: preview,
    note: mode === 'subagent' ? 'FreshEye isolated subagent opened' : 'FreshEye interactive session opened',
  });

  return { ok: true, pair: pairEntry, duplicate: false };
}

export function stripFreshEyeContext(context) {
  if (!context || typeof context !== 'object' || Array.isArray(context)) {
    return context;
  }
  const next = { ...context };
  delete next.claudeMd;
  delete next.agentsMd;
  delete next.geminiMd;
  if ('memory' in next) {
    next.memory = null;
  }
  return next;
}

export function stripFreshEyeSections(sections) {
  if (!Array.isArray(sections)) return sections;
  return sections.filter((section) => {
    const key = String(section?.key || section?.id || section?.name || '').toLowerCase();
    return key !== 'claudemd' && key !== 'memory' && key !== 'agentsmd' && key !== 'geminimd';
  });
}

export function appendLedger(ledger, entry, maxEntries = MAX_LEDGER) {
  const list = Array.isArray(ledger) ? ledger : [];
  if (!entry || typeof entry !== 'object' || typeof entry.event !== 'string') {
    if (list.length > maxEntries) {
      list.splice(0, list.length - maxEntries);
    }
    return list;
  }
  const item = {
    at: typeof entry.at === 'string' && entry.at ? entry.at : new Date().toISOString(),
    event: entry.event,
    fromId: typeof entry.fromId === 'string' ? entry.fromId : '',
    toId: typeof entry.toId === 'string' ? entry.toId : '',
    originId: typeof entry.originId === 'string' ? entry.originId : '',
    freshId: typeof entry.freshId === 'string' ? entry.freshId : '',
    model: typeof entry.model === 'string' ? entry.model : '',
    mode: typeof entry.mode === 'string' ? entry.mode : '',
    promptPreview:
      typeof entry.promptPreview === 'string' ? entry.promptPreview.replace(/\s+/g, ' ').trim().slice(0, 80) : '',
    note: typeof entry.note === 'string' ? entry.note.replace(/\s+/g, ' ').trim().slice(0, 120) : '',
  };
  list.push(item);
  if (list.length > maxEntries) {
    list.splice(0, list.length - maxEntries);
  }
  return list;
}

/**
 * Filter attachments in a FreshEye session:
 * Withhold hook additional_context (e.g. Remember / memory / ambient context)
 * while keeping safety blocking error notes intact.
 */
export function filterFreshEyeAttachments(attachments) {
  if (!Array.isArray(attachments)) return attachments;
  return attachments.filter((item) => {
    if (!item || typeof item !== 'object') return true;
    const type = String(item.type || '').toLowerCase();
    if (type === 'hook_additional_context') {
      return false;
    }
    if (type === 'memory' || type === 'claudemd' || type === 'claude_md' || type === 'agentsmd' || type === 'geminimd') {
      return false;
    }
    return true;
  });
}

export function formatTime(iso) {
  const ts = Date.parse(iso || '');
  if (!ts) return 'now';
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

export function formatStamp(iso) {
  const ts = Date.parse(iso || '');
  if (!ts) return 'unknown-time';
  const d = new Date(ts);
  const yyyy = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${yyyy}-${mo}-${dd} ${hh}:${mm}`;
}

export function formatLedger(ledger, limit = 20) {
  const list = Array.isArray(ledger) ? ledger : [];
  if (list.length === 0) {
    return 'Cyclops FreshEye ledger is empty. Open a fresh context with: /fresheye "your prompt" (or agy --fresheye "your prompt")';
  }
  const count = Math.max(1, Math.min(200, Number(limit) || 20));
  const recent = list.slice(-count).reverse();
  const lines = [`Cyclops FreshEye Ledger (newest first, showing ${recent.length} of ${list.length}):`];
  for (const item of recent) {
    const stamp = formatStamp(item.at);
    const fromShort = item.fromId ? shortId(item.fromId) : '--------';
    const toShort = item.toId ? shortId(item.toId) : '--------';
    const modelPart = item.model ? ` · model ${item.model}` : '';
    const modePart = item.mode ? ` · ${item.mode}` : '';
    const previewPart = item.promptPreview ? ` · "${item.promptPreview}"` : '';
    const notePart = item.note ? ` (${item.note})` : '';
    lines.push(
      `  ${stamp}  ${item.event.padEnd(17, ' ')} ${fromShort} -> ${toShort}${modelPart}${modePart}${previewPart}${notePart}`,
    );
  }
  return lines.join('\n');
}

export function buildSessionBanner(pair, currentId) {
  if (!pair || !pair.originId) return [];
  const originShort = shortId(pair.originId);
  const freshShort = shortId(currentId);
  const opened = formatTime(pair.createdAt);
  const modelPart = pair.model ? ` · model ${pair.model}` : '';
  return [
    `◎ FreshEye · Fresh Context (${freshShort}) · opened ${opened}${modelPart} · original ${originShort} kept`,
    `  Withheld: AGENTS.md, GEMINI.md, rules, skills · agy --fresheye or /resume to return`,
  ];
}

export function buildConfirmPrompt(target) {
  if (!target || !target.targetId) return null;
  const targetShort = shortId(target.targetId);
  if (target.direction === 'return') {
    return {
      title: `Return to original conversation (${targetShort})?`,
      subtitle: 'FreshEye conversation stays saved; you can switch back anytime with agy --fresheye or /resume.',
      confirmLabel: `Return to original (${targetShort})`,
      cancelLabel: 'Stay here',
    };
  }
  return {
    title: `Switch to paired FreshEye conversation (${targetShort})?`,
    subtitle: 'Your original conversation stays saved; use agy --fresheye or /resume to come back.',
    confirmLabel: `Enter FreshEye (${targetShort})`,
    cancelLabel: 'Stay here',
  };
}

/**
 * Render the custom statusline for Antigravity (`agy`).
 * Returns empty string `""` when in an ordinary conversation with no recent restore notice,
 * so `stack_with_default: true` only displays an extra line when FreshEye is active or just restored.
 */
export function buildAgyStatusLine(
  store,
  statusData = {},
  nowMs = Date.now(),
  restoreNoticeMs = RESTORE_NOTICE_MS,
) {
  if (!store || typeof store !== 'object') return '';

  const convId = String(
    statusData?.conversation_id ||
      statusData?.conversationId ||
      statusData?.session_id ||
      statusData?.sessionId ||
      '',
  ).trim();

  const rawAgent =
    statusData?.agent?.name ||
    statusData?.agent?.display_name ||
    statusData?.agent_name ||
    (typeof statusData?.agent === 'string' ? statusData.agent : '') ||
    (convId && store.activeSession?.id === convId ? store.activeSession?.agent : '') ||
    '';
  const agentName = String(rawAgent).trim();

  if (convId && store.pairs?.[convId]) {
    const pair = store.pairs[convId];
    const originShort = shortId(pair.originId);
    const freshShort = shortId(convId);
    const opened = formatTime(pair.createdAt);
    return `◎ FreshEye · Fresh Context (${freshShort}) · opened ${opened} · original ${originShort} kept · agy --fresheye or /resume to return`;
  }

  if (isFreshEyeAgentName(agentName)) {
    const freshShort = convId ? ` (${shortId(convId)})` : '';
    return `◎ FreshEye · Fresh Context${freshShort} · AGENTS.md, GEMINI.md, rules & skills withheld`;
  }

  const restored = store.lastRestored;
  if (
    restored &&
    typeof restored === 'object' &&
    restored.originId &&
    convId &&
    restored.originId === convId
  ) {
    const restoredTs = Date.parse(restored.restoredAt || '') || 0;
    if (restoredTs > 0 && nowMs - restoredTs >= 0 && nowMs - restoredTs < restoreNoticeMs) {
      return `✓ Original conversation ${shortId(restored.originId)} restored · FreshEye ${shortId(restored.freshId)} kept`;
    }
  }

  return '';
}

/**
 * Verify whether a conversation ID exists on disk in Antigravity's storage.
 */
export function conversationExistsOnDisk(
  convId,
  { env = process.env, homeDir = os.homedir() } = {},
) {
  const id = String(convId || '').trim();
  if (!id) return false;

  const testDir = String(env.CYCLOPS_FRESHEYE_CONVERSATIONS_DIR || '').trim();
  if (testDir) {
    return (
      fs.existsSync(path.join(testDir, `${id}.db`)) ||
      fs.existsSync(path.join(testDir, `${id}.pb`)) ||
      fs.existsSync(path.join(testDir, id))
    );
  }

  const candidates = [
    path.join(homeDir, '.gemini', 'antigravity-cli', 'conversations', `${id}.db`),
    path.join(homeDir, '.gemini', 'antigravity-cli', 'conversations', `${id}.pb`),
    path.join(homeDir, '.gemini', 'antigravity-cli', 'brain', id),
    path.join(homeDir, '.gemini', 'antigravity', 'conversations', `${id}.db`),
    path.join(homeDir, '.gemini', 'antigravity', 'conversations', `${id}.pb`),
    path.join(homeDir, '.gemini', 'antigravity', 'brain', id),
    path.join(homeDir, '.gemini', 'antigravity-ide', 'conversations', `${id}.db`),
    path.join(homeDir, '.gemini', 'antigravity-ide', 'conversations', `${id}.pb`),
    path.join(homeDir, '.gemini', 'antigravity-ide', 'brain', id),
  ];

  return candidates.some((candidate) => fs.existsSync(candidate));
}
