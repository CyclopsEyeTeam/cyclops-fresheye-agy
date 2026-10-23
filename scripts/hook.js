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
import {
  appendLedger,
  defaultStorePath,
  isFreshEyeAgentName,
  loadStore,
  originFor,
  recordOpenPair,
  saveStore,
} from './core.js';

const PENDING_OPEN_TTL_MS = 30 * 60_000;

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

        // Check if the child subagent already fired SessionStart/PreInvocation just before PostToolUse
        const recentStart = store.activeSession?.lastUnpairedStart;
        if (
          recentStart &&
          recentStart.id &&
          recentStart.id !== convId &&
          recentStart.id !== originId &&
          nowMs - (Date.parse(recentStart.at || '') || 0) < 15_000
        ) {
          recordOpenPair(store, {
            freshId: recentStart.id,
            originId,
            originRoot: workspaceRoot || recentStart.workspaceRoot || '',
            model: modelName || recentStart.model || store.activeSession?.model || '',
            prompt,
            mode: 'subagent',
            createdAt: recentStart.at || nowIso,
          });
          if (store.activeSession) {
            delete store.activeSession.lastUnpairedStart;
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
    }
    return store;
  }

  // 2. SessionStart / PreInvocation / Stop with a conversationId
  if (convId) {
    // Check if there is a pendingOpen waiting for the new FreshEye conversationId
    if (
      store.pendingOpen &&
      convId !== store.pendingOpen.originId &&
      convId !== store.pendingOpen.fromId
    ) {
      const pending = store.pendingOpen;
      recordOpenPair(store, {
        freshId: convId,
        originId: pending.originId,
        originRoot: workspaceRoot || pending.originRoot || '',
        model: modelName || pending.model || '',
        prompt: pending.prompt || '',
        mode: pending.mode || 'session',
        createdAt: nowIso,
      });
      store.pendingOpen = null;
    }

    const prevId = String(store.activeSession?.id || '').trim();
    const isFresh = Boolean(store.pairs[convId]);

    // Detect return/enter transitions between paired sessions when switching via /resume or CLI
    if (prevId && prevId !== convId && (event === 'SessionStart' || event === 'PreInvocation')) {
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

    const lastUnpairedStart =
      !isFresh && (event === 'SessionStart' || (event === 'PreInvocation' && payload?.invocationNum === 1))
        ? { id: convId, at: nowIso, model: modelName, workspaceRoot }
        : store.activeSession?.lastUnpairedStart;

    // Keep activeSession pointed at the main interactive session when a subagent stops
    if (event === 'Stop' && isFresh && store.pairs[convId]?.mode === 'subagent') {
      store.activeSession = {
        id: store.pairs[convId].originId,
        model: modelName || store.pairs[convId].model || store.activeSession?.model || '',
        workspaceRoot: workspaceRoot || store.pairs[convId].originRoot || store.activeSession?.workspaceRoot || '',
        updatedAt: nowIso,
      };
    } else {
      store.activeSession = {
        id: convId,
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

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
