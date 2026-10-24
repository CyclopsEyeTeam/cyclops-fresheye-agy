#!/usr/bin/env node
/**
 * hook.js - Fast, synchronous Antigravity lifecycle hook observer for Cyclops FreshEye.
 *
 * Tracks active conversation IDs, pairs FreshEye sessions/subagents to their true original
 * conversation (`originFor`), records `open` / `open-failed` / `return` / `enter` / `interrupted`
 * events in the capped 1,000-entry ledger, and updates `lastRestored` for the statusline strip.
 * Always outputs `{}` on stdout and never blocks or overrides tool permissions.
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  appendLedger,
  defaultStorePath,
  isCliEntrypoint,
  isFreshEyeAgentName,
  loadStore,
  originFor,
  recordOpenPair,
  saveStore,
} from './core.js';

const PENDING_OPEN_TTL_MS = 60_000;
const SUBAGENT_START_WINDOW_MS = 5 * 60_000;

function extractSubagentId(payload) {
  const candidates = [
    payload?.result,
    payload?.toolResult,
    payload?.response,
    payload?.output,
    payload?.toolCall?.result,
  ];
  for (const item of candidates) {
    if (!item) continue;
    if (typeof item === 'object' && !Array.isArray(item)) {
      const direct = String(
        item.conversationId || item.conversation_id || item.subagentId || item.subagent_id || item.id || '',
      ).trim();
      if (direct) return direct;
    }
    if (typeof item === 'string') {
      const text = item.trim();
      if (!text) continue;
      try {
        const parsed = JSON.parse(text);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          const fromJson = String(
            parsed.conversationId ||
              parsed.conversation_id ||
              parsed.subagentId ||
              parsed.subagent_id ||
              parsed.id ||
              '',
          ).trim();
          if (fromJson) return fromJson;
        }
      } catch {
        // Not JSON; try pattern match below
      }
      const labeled = text.match(
        /(?:conversationId|conversation_id|subagentId|conversation:\/\/)["'\s:=]*([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}|[a-zA-Z0-9_-]{8,64})/i,
      );
      if (labeled && labeled[1]) return labeled[1].trim();
      const uuid = text.match(/\b([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\b/);
      if (uuid && uuid[1]) return uuid[1].trim();
    }
  }
  return '';
}

function workspacesMatch(rootA, rootB) {
  if (!rootA || !rootB) return true;
  try {
    return path.resolve(rootA) === path.resolve(rootB);
  } catch {
    return rootA === rootB;
  }
}

function parseArgs(argv) {
  let event = '';
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === '--event' && argv[i + 1]) {
      event = argv[i + 1];
      i += 1;
    }
  }
  return { event };
}

function readStdinJson() {
  try {
    const raw = fs.readFileSync(0, 'utf8');
    if (!raw || !raw.trim()) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function handleHookPayload(payload, eventName = '', env = process.env) {
  const storePath = defaultStorePath(env);
  const store = loadStore(storePath);
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();

  const event =
    eventName ||
    String(payload?.hookEvent || payload?.hook_event_name || '').trim() ||
    (payload?.toolCall ? 'PostToolUse' : payload?.terminationReason ? 'Stop' : 'PreInvocation');

  const convId = String(payload?.conversationId || '').trim();
  const modelName = String(payload?.modelName || '').trim();
  const workspaceRoot =
    Array.isArray(payload?.workspacePaths) && payload.workspacePaths.length > 0
      ? String(payload.workspacePaths[0] || '')
      : '';

  // Expire stale pendingOpen older than 60s
  if (store.pendingOpen && store.pendingOpen.requestedAt) {
    const age = nowMs - (Date.parse(store.pendingOpen.requestedAt) || 0);
    if (age > PENDING_OPEN_TTL_MS) {
      appendLedger(store.ledger, {
        at: nowIso,
        event: 'interrupted',
        fromId: store.pendingOpen.fromId || store.pendingOpen.originId || '',
        originId: store.pendingOpen.originId || '',
        model: store.pendingOpen.model || '',
        mode: store.pendingOpen.mode || '',
        promptPreview: store.pendingOpen.prompt || '',
        note: 'pending FreshEye open expired before target session started',
      });
      store.pendingOpen = null;
    }
  }

  // 1. PostToolUse on invoke_subagent
  if (event === 'PostToolUse') {
    const toolCall = payload?.toolCall && typeof payload.toolCall === 'object' ? payload.toolCall : {};
    const toolName = String(payload?.toolName || toolCall.name || '').trim().toLowerCase();
    if (toolName === 'invoke_subagent') {
      const args = toolCall.args && typeof toolCall.args === 'object' ? toolCall.args : {};
      const typeName = String(args.TypeName || '').trim();
      const role = String(args.Role || '').trim();
      const prompt = String(args.Prompt || '').trim();

      if (isFreshEyeAgentName(typeName) || isFreshEyeAgentName(role)) {
        const originId = originFor(store.pairs, convId || store.activeSession?.id || '');
        if (payload?.error) {
          appendLedger(store.ledger, {
            at: nowIso,
            event: 'open-failed',
            fromId: convId,
            originId,
            model: modelName || store.activeSession?.model || '',
            mode: 'subagent',
            promptPreview: prompt,
            note: String(payload.error).slice(0, 100),
          });
          store.pendingOpen = null;
          saveStore(storePath, store);
          return store;
        }

        const resultChildId = extractSubagentId(payload);
        const recentStart = store.activeSession?.lastUnpairedStart;
        const canUseRecentStart =
          recentStart &&
          recentStart.id &&
          recentStart.id !== convId &&
          recentStart.id !== originId &&
          !recentStart.nonFreshEye &&
          workspacesMatch(workspaceRoot, recentStart.workspaceRoot) &&
          nowMs - (Date.parse(recentStart.at || '') || 0) < SUBAGENT_START_WINDOW_MS;

        const matchedChildId =
          resultChildId && resultChildId !== convId && resultChildId !== originId
            ? resultChildId
            : canUseRecentStart
              ? recentStart.id
              : '';

        if (matchedChildId) {
          const matchedStart = recentStart && recentStart.id === matchedChildId ? recentStart : null;
          recordOpenPair(store, {
            freshId: matchedChildId,
            originId,
            originRoot: workspaceRoot || matchedStart?.workspaceRoot || store.activeSession?.workspaceRoot || '',
            model: modelName || matchedStart?.model || store.activeSession?.model || '',
            prompt,
            mode: 'subagent',
            createdAt: matchedStart?.at || nowIso,
          });
          if (matchedStart?.stoppedAt) {
            store.lastRestored = {
              originId,
              freshId: matchedChildId,
              restoredAt: matchedStart.stoppedAt,
            };
            appendLedger(store.ledger, {
              at: matchedStart.stoppedAt,
              event: 'return',
              fromId: matchedChildId,
              toId: originId,
              originId,
              freshId: matchedChildId,
              model: modelName || matchedStart.model || store.activeSession?.model || '',
              mode: 'subagent',
              note: 'FreshEye subagent completed and returned to origin',
            });
          }
          if (store.activeSession) {
            delete store.activeSession.lastUnpairedStart;
            if (originId) {
              store.activeSession.id = originId;
            }
          }
          store.pendingOpen = null;
        } else {
          store.pendingOpen = {
            originId,
            fromId: convId || originId,
            originRoot: workspaceRoot || store.activeSession?.workspaceRoot || '',
            model: modelName || store.activeSession?.model || '',
            prompt,
            mode: 'subagent',
            requestedAt: nowIso,
          };
        }
        saveStore(storePath, store);
        return store;
      }

      // Non-FreshEye subagent (e.g. research, browser, self): clear lastUnpairedStart so it cannot be mis-paired
      if (store.activeSession?.lastUnpairedStart) {
        delete store.activeSession.lastUnpairedStart;
        saveStore(storePath, store);
      }
    }
    return store;
  }

  // 2. SessionStart / PreInvocation / Stop with a conversationId
  if (convId) {
    const isBrandNewTurn =
      event === 'SessionStart' ||
      (event === 'PreInvocation' &&
        (payload?.invocationNum === undefined || Number(payload.invocationNum) <= 1) &&
        (payload?.initialNumSteps === undefined || Number(payload.initialNumSteps) <= 3));

    // Check if there is a pendingOpen waiting for the new FreshEye conversationId
    if (
      store.pendingOpen &&
      isBrandNewTurn &&
      convId !== store.pendingOpen.originId &&
      convId !== store.pendingOpen.fromId &&
      !store.pairs[convId] &&
      workspacesMatch(workspaceRoot, store.pendingOpen.originRoot)
    ) {
      const pending = store.pendingOpen;
      if (pending.originId) {
        recordOpenPair(store, {
          freshId: convId,
          originId: pending.originId,
          originRoot: workspaceRoot || pending.originRoot || '',
          model: modelName || pending.model || '',
          prompt: pending.prompt || '',
          mode: pending.mode || 'session',
          createdAt: nowIso,
        });
      }
      store.pendingOpen = null;
    }

    const prevId = String(store.activeSession?.id || '').trim();
    const isFresh = Boolean(store.pairs[convId]);

    // Detect return/enter transitions only on SessionStart (not on every PreInvocation across concurrent terminals)
    if (prevId && prevId !== convId && event === 'SessionStart') {
      const prevPair = store.pairs[prevId];
      const currPair = store.pairs[convId];

      // Returning from FreshEye (`prevId`) to its original (`convId`)
      if (prevPair && prevPair.originId === convId && prevPair.mode !== 'subagent') {
        store.lastRestored = {
          originId: convId,
          freshId: prevId,
          restoredAt: nowIso,
        };
        const lastEntry = store.ledger[store.ledger.length - 1];
        const alreadyLogged =
          lastEntry &&
          lastEntry.event === 'return' &&
          lastEntry.fromId === prevId &&
          lastEntry.toId === convId &&
          nowMs - (Date.parse(lastEntry.at) || 0) < 5000;
        if (!alreadyLogged) {
          appendLedger(store.ledger, {
            at: nowIso,
            event: 'return',
            fromId: prevId,
            toId: convId,
            originId: convId,
            freshId: prevId,
            model: modelName || prevPair.model || '',
            mode: prevPair.mode || 'session',
          });
        }
      } else if (currPair && currPair.originId === prevId && currPair.mode !== 'subagent') {
        // Re-entering an existing FreshEye (`convId`) from its original (`prevId`)
        const createdAge = nowMs - (Date.parse(currPair.createdAt) || 0);
        const lastEntry = store.ledger[store.ledger.length - 1];
        const alreadyLogged =
          lastEntry &&
          (lastEntry.event === 'enter' || lastEntry.event === 'open') &&
          lastEntry.toId === convId &&
          nowMs - (Date.parse(lastEntry.at) || 0) < 5000;
        if (createdAge > 2000 && !alreadyLogged) {
          appendLedger(store.ledger, {
            at: nowIso,
            event: 'enter',
            fromId: prevId,
            toId: convId,
            originId: prevId,
            freshId: convId,
            model: modelName || currPair.model || '',
            mode: currPair.mode || 'session',
          });
        }
      }
    }

    // When a subagent FreshEye finishes its turn (`Stop`), mark lastRestored on its originId
    if (event === 'Stop' && isFresh && store.pairs[convId]?.mode === 'subagent') {
      const pair = store.pairs[convId];
      store.lastRestored = {
        originId: pair.originId,
        freshId: convId,
        restoredAt: nowIso,
      };
      appendLedger(store.ledger, {
        at: nowIso,
        event: 'return',
        fromId: convId,
        toId: pair.originId,
        originId: pair.originId,
        freshId: convId,
        model: modelName || pair.model || '',
        mode: 'subagent',
        note: 'FreshEye subagent completed and returned to origin',
      });
    }

    let lastUnpairedStart = store.activeSession?.lastUnpairedStart;
    if (!isFresh && (event === 'SessionStart' || (event === 'PreInvocation' && payload?.invocationNum === 1))) {
      lastUnpairedStart = { id: convId, at: nowIso, model: modelName, workspaceRoot };
    } else if (!isFresh && event === 'Stop' && lastUnpairedStart && lastUnpairedStart.id === convId) {
      lastUnpairedStart = { ...lastUnpairedStart, stoppedAt: nowIso };
    }

    const payloadAgent = String(payload?.agentName || payload?.agent?.name || payload?.agent || '').trim();
    const effectiveAgent =
      payloadAgent ||
      (isFresh ? 'fresheye' : store.activeSession?.id === convId ? store.activeSession?.agent || '' : '');

    // Keep activeSession pointed at the main interactive session when a subagent stops
    if (event === 'Stop' && isFresh && store.pairs[convId]?.mode === 'subagent') {
      store.activeSession = {
        id: store.pairs[convId].originId,
        agent: '',
        model: modelName || store.pairs[convId].model || store.activeSession?.model || '',
        workspaceRoot: workspaceRoot || store.pairs[convId].originRoot || store.activeSession?.workspaceRoot || '',
        updatedAt: nowIso,
      };
    } else if (event === 'Stop' && !isFresh && prevId && prevId !== convId && lastUnpairedStart?.id === convId) {
      // Unpaired subagent stopped before PostToolUse fired; preserve parent activeSession.id
      store.activeSession = {
        ...(store.activeSession || {}),
        id: prevId,
        updatedAt: nowIso,
        lastUnpairedStart,
      };
    } else {
      store.activeSession = {
        id: convId,
        agent: effectiveAgent,
        model: modelName || store.activeSession?.model || '',
        workspaceRoot: workspaceRoot || store.activeSession?.workspaceRoot || '',
        updatedAt: nowIso,
        ...(lastUnpairedStart ? { lastUnpairedStart } : {}),
      };
    }

    saveStore(storePath, store);
  }

  return store;
}

function main() {
  try {
    const { event } = parseArgs(process.argv);
    const payload = readStdinJson();
    handleHookPayload(payload, event, process.env);
  } catch {
    // Fail open and never block Antigravity's execution loop
  }
  process.stdout.write('{}\n');
}

if (isCliEntrypoint(import.meta.url)) {
  main();
}
