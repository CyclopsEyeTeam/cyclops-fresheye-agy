#!/usr/bin/env node
/**
 * fresheye-ctl.js - CLI controller for Cyclops FreshEye (Antigravity / agy).
 *
 * Manages session pairs (`originFor`, `pickTarget`), ledger formatting (`formatLedger`),
 * pending session opens, stale-session verification, and interactive switch confirmation
 * (`ask` with Stay here default & 60s timeout, `toggle`, `off`).
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import {
  CONFIRM_TIMEOUT_MS,
  appendLedger,
  buildConfirmPrompt,
  buildSessionBanner,
  conversationExistsOnDisk,
  defaultStorePath,
  formatLedger,
  isCliEntrypoint,
  loadStore,
  normalizeSwitchMode,
  originFor,
  pickTarget,
  recordOpenPair,
  saveStore,
  shortId,
} from './core.js';

const BOOLEAN_FLAGS = new Set(['json', 'interactive', 'check-disk', 'help', 'h']);

export function parseFlags(argv) {
  const positional = [];
  const flags = {};
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--') {
      positional.push(...argv.slice(i + 1));
      break;
    }
    if (arg.startsWith('--')) {
      const eqIdx = arg.indexOf('=');
      if (eqIdx !== -1) {
        const key = arg.slice(2, eqIdx);
        flags[key] = arg.slice(eqIdx + 1);
        continue;
      }
      const key = arg.slice(2);
      if (BOOLEAN_FLAGS.has(key)) {
        flags[key] = true;
      } else if (i + 1 < argv.length) {
        flags[key] = argv[i + 1];
        i += 1;
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(arg);
    }
  }
  return { subcommand: positional[0] || 'status', args: positional.slice(1), flags };
}

/**
 * Find the active or most recently modified conversation ID.
 * Checks ANTIGRAVITY_CONVERSATION_ID first, then store.activeSession, then conversation files on disk.
 */
export function detectRecentConversationId(store, env = process.env, homeDir = os.homedir()) {
  const envConvId = String(env.ANTIGRAVITY_CONVERSATION_ID || env.AGY_CONVERSATION_ID || '').trim();
  if (envConvId) {
    return envConvId;
  }
  if (store?.activeSession?.id) {
    return String(store.activeSession.id).trim();
  }
  const testDir = String(env.CYCLOPS_FRESHEYE_CONVERSATIONS_DIR || '').trim();
  const convDirs = [
    ...(testDir ? [testDir] : []),
    path.join(homeDir, '.gemini', 'antigravity-cli', 'conversations'),
    path.join(homeDir, '.gemini', 'antigravity', 'conversations'),
    path.join(homeDir, '.gemini', 'antigravity-ide', 'conversations'),
  ];
  let newestId = '';
  let newestMtime = 0;
  for (const dir of convDirs) {
    try {
      const entries = fs.readdirSync(dir);
      for (const name of entries) {
        if (!name.endsWith('.db') && !name.endsWith('.pb')) continue;
        const full = path.join(dir, name);
        let mtimeMs = fs.statSync(full).mtimeMs;
        if (name.endsWith('.db')) {
          try {
            const walStat = fs.statSync(`${full}-wal`);
            if (walStat.mtimeMs > mtimeMs) mtimeMs = walStat.mtimeMs;
          } catch {
            // no active WAL file
          }
        }
        if (mtimeMs > newestMtime) {
          newestMtime = mtimeMs;
          newestId = name.slice(0, -3);
        }
      }
    } catch {
      // ignore missing dirs
    }
  }
  return newestId;
}

async function promptSwitchConfirm(target, timeoutMs = CONFIRM_TIMEOUT_MS) {
  const promptSpec = buildConfirmPrompt(target);
  if (!promptSpec) return { outcome: 'cancelled' };

  return new Promise((resolve) => {
    let settled = false;
    let rl = null;
    const timeoutSec = Math.max(1, Math.round(timeoutMs / 1000));
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      if (rl) rl.close();
      process.stderr.write(`\n◎ FreshEye switch confirmation timed out after ${timeoutSec}s · Staying here.\n`);
      resolve({ outcome: 'timeout' });
    }, timeoutMs);

    try {
      rl = readline.createInterface({
        input: process.stdin,
        output: process.stderr,
      });
    } catch {
      clearTimeout(timer);
      resolve({ outcome: 'cancelled' });
      return;
    }

    process.stderr.write(`\n◎ ${promptSpec.title}\n`);
    process.stderr.write(`  ${promptSpec.subtitle}\n`);
    process.stderr.write(`  [1] ${promptSpec.cancelLabel} (default)\n`);
    process.stderr.write(`  [2] ${promptSpec.confirmLabel}\n`);

    rl.question('Select [1/2] (Enter = Stay here): ', (answer) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      rl.close();
      const normalized = String(answer || '').trim().toLowerCase();
      if (normalized === '2' || normalized === 'y' || normalized === 'yes' || normalized === 'switch') {
        resolve({ outcome: 'confirmed' });
      } else {
        resolve({ outcome: 'cancelled' });
      }
    });

    rl.on('SIGINT', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      rl.close();
      process.stderr.write('\n');
      resolve({ outcome: 'cancelled' });
    });

    rl.on('close', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ outcome: 'cancelled' });
    });
  });
}

async function main() {
  const { subcommand, args, flags } = parseFlags(process.argv);
  const storePath = defaultStorePath(process.env);
  const store = loadStore(storePath);
  const nowIso = new Date().toISOString();

  if (subcommand === 'log') {
    const rawLimit = flags.limit ?? args[0] ?? 20;
    const count = Math.max(1, Math.min(200, Number(rawLimit) || 20));
    if (flags.json) {
      process.stdout.write(`${JSON.stringify(store.ledger.slice(-count).reverse(), null, 2)}\n`);
    } else {
      process.stdout.write(`${formatLedger(store.ledger, count)}\n`);
    }
    return;
  }

  if (subcommand === 'mode') {
    const requested = args[0] || flags.set;
    if (requested && typeof requested === 'string') {
      store.settings.switchMode = normalizeSwitchMode(requested);
      saveStore(storePath, store);
      process.stdout.write(`Cyclops FreshEye switchMode set to: ${store.settings.switchMode}\n`);
    } else {
      process.stdout.write(`${store.settings.switchMode}\n`);
    }
    return;
  }

  if (subcommand === 'prepare-open') {
    const rawOrigin = String(flags.origin || detectRecentConversationId(store, process.env) || '').trim();
    const trueOriginId = rawOrigin ? originFor(store.pairs, rawOrigin) : '';
    const rawPrompt = typeof flags.prompt === 'string' ? flags.prompt.trim() : args.join(' ').trim();
    const prompt = rawPrompt || (flags.interactive ? '(interactive session)' : '');
    const model = String((typeof flags.model === 'string' ? flags.model : '') || store.activeSession?.model || '').trim();
    const workspaceRoot = String(
      (typeof flags.workspace === 'string' ? flags.workspace : '') || store.activeSession?.workspaceRoot || '',
    ).trim();
    const mode = String((typeof flags.mode === 'string' ? flags.mode : '') || 'session').trim();

    if (!prompt) {
      process.stderr.write('Error: FreshEye requires a prompt to open a fresh context.\n');
      process.exitCode = 1;
      return;
    }

    store.pendingOpen = {
      originId: trueOriginId,
      fromId: rawOrigin,
      originRoot: workspaceRoot,
      model,
      prompt,
      mode,
      requestedAt: nowIso,
    };
    saveStore(storePath, store);

    if (flags.json) {
      process.stdout.write(`${JSON.stringify(store.pendingOpen)}\n`);
    } else {
      process.stdout.write(`${trueOriginId}\n`);
    }
    return;
  }

  if (subcommand === 'clear-pending') {
    if (store.pendingOpen) {
      store.pendingOpen = null;
      saveStore(storePath, store);
    }
    return;
  }

  if (subcommand === 'open-failed') {
    const pending = store.pendingOpen;
    const fromId = String(
      (typeof flags.from === 'string' ? flags.from : '') || pending?.fromId || store.activeSession?.id || '',
    ).trim();
    const originId = String(
      (typeof flags.origin === 'string' ? flags.origin : '') || pending?.originId || fromId,
    ).trim();
    const model = String((typeof flags.model === 'string' ? flags.model : '') || pending?.model || '').trim();
    const prompt = String((typeof flags.prompt === 'string' ? flags.prompt : '') || pending?.prompt || '').trim();
    const note = String(
      (typeof flags.note === 'string' ? flags.note : '') || 'FreshEye session failed to open',
    ).trim();

    appendLedger(store.ledger, {
      at: nowIso,
      event: 'open-failed',
      fromId,
      originId,
      model,
      mode: pending?.mode || 'session',
      promptPreview: prompt,
      note,
    });
    store.pendingOpen = null;
    saveStore(storePath, store);
    return;
  }

  if (subcommand === 'switch-failed') {
    const fromId = String((typeof flags.from === 'string' ? flags.from : '') || '').trim();
    const toId = String((typeof flags.to === 'string' ? flags.to : '') || '').trim();
    const pair = store.pairs[toId] || store.pairs[fromId] || null;
    const originId = String(
      (typeof flags.origin === 'string' ? flags.origin : '') || pair?.originId || fromId || '',
    ).trim();
    const freshId = String(
      (typeof flags.fresh === 'string' ? flags.fresh : '') || (store.pairs[toId] ? toId : store.pairs[fromId] ? fromId : ''),
    ).trim();
    const note = String(
      (typeof flags.note === 'string' ? flags.note : '') || 'Failed to launch agy for target conversation',
    ).trim();

    appendLedger(store.ledger, {
      at: nowIso,
      event: 'switch-failed',
      fromId,
      toId,
      originId,
      freshId,
      model: pair?.model || store.activeSession?.model || '',
      mode: pair?.mode || 'session',
      note,
    });
    if (fromId) {
      store.activeSession = {
        ...(store.activeSession || {}),
        id: fromId,
        updatedAt: nowIso,
      };
    }
    if (store.lastRestored && store.lastRestored.originId === toId) {
      store.lastRestored = null;
    }
    saveStore(storePath, store);
    return;
  }

  if (subcommand === 'pair') {
    const freshId = String(flags.fresh || '').trim();
    const originId = String(flags.origin || store.activeSession?.id || '').trim();
    const model = String(flags.model || store.activeSession?.model || '').trim();
    const prompt = String(flags.prompt || args.join(' ') || '').trim();
    const mode = String(flags.mode || 'subagent').trim();
    const originRoot = String(flags.workspace || store.activeSession?.workspaceRoot || process.cwd()).trim();

    const result = recordOpenPair(store, {
      freshId,
      originId,
      originRoot,
      model,
      prompt,
      mode,
      createdAt: nowIso,
    });
    store.pendingOpen = null;
    saveStore(storePath, store);

    if (!result.ok) {
      process.stderr.write(`FreshEye pair failed: ${result.reason}\n`);
      process.exitCode = 1;
      return;
    }
    if (flags.json) {
      process.stdout.write(`${JSON.stringify(result.pair)}\n`);
    } else {
      process.stdout.write(
        `◎ Paired FreshEye ${shortId(freshId)} <-> original ${shortId(result.pair.originId)} (${mode})\n`,
      );
    }
    return;
  }

  if (subcommand === 'status') {
    const currentId = String(
      (typeof flags.session === 'string' ? flags.session : '') || detectRecentConversationId(store, process.env) || '',
    ).trim();
    const target = pickTarget(store.pairs, currentId);
    const activePair = store.pairs[currentId] || target?.pair || null;

    if (flags.json) {
      process.stdout.write(
        `${JSON.stringify(
          {
            currentId,
            switchMode: store.settings.switchMode,
            isFreshEye: Boolean(store.pairs[currentId]),
            target,
            pair: activePair,
          },
          null,
          2,
        )}\n`,
      );
      return;
    }

    if (!target) {
      process.stdout.write(
        'No paired FreshEye session for this conversation. Use: /fresheye "your prompt" (or agy --fresheye "your prompt")\n',
      );
      return;
    }

    if (target.direction === 'return') {
      const banner = buildSessionBanner(target.pair, currentId);
      for (const line of banner) {
        process.stdout.write(`${line}\n`);
      }
      process.stdout.write(
        `  To return to original: agy --fresheye (or agy --conversation ${target.targetId} / /resume)\n`,
      );
    } else {
      const freshShort = shortId(target.freshId);
      const originShort = shortId(currentId);
      const modelPart = target.pair.model ? ` · model ${target.pair.model}` : '';
      const modePart = target.pair.mode ? ` · ${target.pair.mode}` : '';
      const previewPart = target.pair.promptPreview ? `\n  Topic: "${target.pair.promptPreview}"` : '';
      process.stdout.write(
        `◎ Paired FreshEye session available: ${freshShort} (from original ${originShort}${modelPart}${modePart})${previewPart}\n` +
          `  To enter FreshEye session: agy --fresheye (or agy --agent fresheye --conversation ${target.targetId})\n`,
      );
    }
    return;
  }

  if (subcommand === 'switch') {
    const currentId = String(
      (typeof flags.session === 'string' ? flags.session : '') || detectRecentConversationId(store, process.env) || '',
    ).trim();
    const target = pickTarget(store.pairs, currentId);
    if (!target) {
      process.stderr.write(
        'No paired FreshEye session for this conversation. Use: /fresheye "your prompt" (or agy --fresheye "your prompt")\n',
      );
      process.exitCode = 2;
      return;
    }

    if (flags['check-disk'] && !conversationExistsOnDisk(target.targetId, { env: process.env })) {
      delete store.pairs[target.freshId];
      appendLedger(store.ledger, {
        at: nowIso,
        event: 'stale',
        fromId: currentId,
        toId: target.targetId,
        originId: target.pair.originId,
        freshId: target.freshId,
        model: target.pair.model,
        mode: target.pair.mode,
        note: 'target conversation missing on disk; pair removed',
      });
      saveStore(storePath, store);
      process.stderr.write(
        `◎ Target conversation (${shortId(target.targetId)}) no longer exists on disk. Removed stale FreshEye pair.\n`,
      );
      process.exitCode = 3;
      return;
    }

    const switchMode = normalizeSwitchMode(flags.mode || store.settings.switchMode);
    if (switchMode === 'off') {
      process.stderr.write(
        `Automatic switching is off. Switch manually with: agy --conversation ${target.targetId} (or /resume)\n`,
      );
      process.exitCode = 4;
      return;
    }

    if (switchMode === 'ask') {
      const timeoutMs = Number(flags['timeout-ms']) || CONFIRM_TIMEOUT_MS;
      const decision = await promptSwitchConfirm(target, timeoutMs);
      if (decision.outcome !== 'confirmed') {
        const eventName = decision.outcome === 'timeout' ? 'confirm-timeout' : 'confirm-cancelled';
        appendLedger(store.ledger, {
          at: new Date().toISOString(),
          event: eventName,
          fromId: currentId,
          toId: target.targetId,
          originId: target.pair.originId,
          freshId: target.freshId,
          model: target.pair.model,
          mode: target.pair.mode,
        });
        saveStore(storePath, store);
        process.exitCode = decision.outcome === 'timeout' ? 6 : 5;
        return;
      }
    }

    // Confirmed or toggle mode: record transition
    const eventName = target.direction === 'return' ? 'return' : 'enter';
    if (target.direction === 'return') {
      store.lastRestored = {
        originId: target.targetId,
        freshId: target.freshId,
        restoredAt: new Date().toISOString(),
      };
    }
    appendLedger(store.ledger, {
      at: new Date().toISOString(),
      event: eventName,
      fromId: currentId,
      toId: target.targetId,
      originId: target.pair.originId,
      freshId: target.freshId,
      model: target.pair.model,
      mode: target.pair.mode,
    });
    store.activeSession = {
      ...(store.activeSession || {}),
      id: target.targetId,
      agent: target.direction === 'enter' ? 'fresheye' : '',
      updatedAt: new Date().toISOString(),
    };
    saveStore(storePath, store);

    if (flags.json) {
      process.stdout.write(`${JSON.stringify({ ...target, fromId: currentId })}\n`);
    } else {
      process.stdout.write(`${target.targetId}\n`);
    }
  }
}

if (isCliEntrypoint(import.meta.url)) {
  main();
}
