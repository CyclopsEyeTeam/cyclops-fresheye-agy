import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  MAX_LEDGER,
  MAX_PAIRS,
  RESTORE_NOTICE_MS,
  appendLedger,
  buildAgyStatusLine,
  buildConfirmPrompt,
  buildSessionBanner,
  conversationExistsOnDisk,
  defaultStore,
  defaultStorePath,
  filterFreshEyeAttachments,
  formatLedger,
  isCliEntrypoint,
  isFreshEyeAgentName,
  loadStore,
  normalizeSwitchMode,
  originFor,
  pickTarget,
  prunePairs,
  recordOpenPair,
  saveStore,
  shortId,
  stripFreshEyeContext,
  stripFreshEyeSections,
} from '../scripts/core.js';

test('shortId and normalizeSwitchMode', () => {
  assert.equal(shortId('4ee9d53c-e5e1-4656-a600-1d6885e8d60f'), '4ee9d53c');
  assert.equal(shortId(''), 'unknown');
  assert.equal(normalizeSwitchMode('ask'), 'ask');
  assert.equal(normalizeSwitchMode('TOGGLE'), 'toggle');
  assert.equal(normalizeSwitchMode('off'), 'off');
  assert.equal(normalizeSwitchMode('invalid'), 'ask');
});

test('isFreshEyeAgentName identifies fresheye agent variants', () => {
  assert.equal(isFreshEyeAgentName('fresheye'), true);
  assert.equal(isFreshEyeAgentName('cyclops-fresheye:fresheye'), true);
  assert.equal(isFreshEyeAgentName('FreshEye · Fresh Context'), true);
  assert.equal(isFreshEyeAgentName('self'), false);
  assert.equal(isFreshEyeAgentName('research'), false);
});

test('originFor prevents FreshEye -> FreshEye chaining and links back to true original', () => {
  const pairs = {
    'fresh-1': { originId: 'origin-root', createdAt: '2026-10-23T12:00:00.000Z' },
  };
  assert.equal(originFor(pairs, 'origin-root'), 'origin-root');
  assert.equal(originFor(pairs, 'fresh-1'), 'origin-root');
  assert.equal(originFor(pairs, 'unrelated-session'), 'unrelated-session');
});

test('pickTarget resolves return and enter deterministically without guessing', () => {
  const pairs = {
    'fresh-older': { originId: 'origin-1', createdAt: '2026-10-23T12:00:00.000Z' },
    'fresh-newer': { originId: 'origin-1', createdAt: '2026-10-23T12:05:00.000Z' },
  };

  // From FreshEye -> return to origin-1
  const fromFresh = pickTarget(pairs, 'fresh-older');
  assert.equal(fromFresh?.direction, 'return');
  assert.equal(fromFresh?.targetId, 'origin-1');
  assert.equal(fromFresh?.freshId, 'fresh-older');

  // From original -> enter newest child FreshEye
  const fromOrigin = pickTarget(pairs, 'origin-1');
  assert.equal(fromOrigin?.direction, 'enter');
  assert.equal(fromOrigin?.targetId, 'fresh-newer');
  assert.equal(fromOrigin?.freshId, 'fresh-newer');

  // Unpaired session -> null (never guesses)
  assert.equal(pickTarget(pairs, 'unpaired-999'), null);
});

test('recordOpenPair fails closed on identical or empty IDs and links chained opens to true origin', () => {
  const store = defaultStore();

  // Fail closed when freshId === originId
  const sameRes = recordOpenPair(store, {
    freshId: 'session-1',
    originId: 'session-1',
    prompt: 'Review parser',
  });
  assert.equal(sameRes.ok, false);
  assert.equal(store.ledger.at(-1)?.event, 'open-failed');

  // Valid open
  const ok1 = recordOpenPair(store, {
    freshId: 'fresh-1',
    originId: 'origin-1',
    model: 'Gemini 4 Argon (High)',
    prompt: 'First review prompt',
    mode: 'subagent',
    createdAt: '2026-10-23T14:00:00.000Z',
  });
  assert.equal(ok1.ok, true);
  assert.equal(store.pairs['fresh-1']?.originId, 'origin-1');
  assert.equal(store.ledger.at(-1)?.event, 'open');

  // Chained open from inside fresh-1 links to origin-1, not fresh-1
  const ok2 = recordOpenPair(store, {
    freshId: 'fresh-2',
    originId: 'fresh-1',
    model: 'Gemini 4 Argon (High)',
    prompt: 'Second review prompt from inside FreshEye',
    mode: 'session',
    createdAt: '2026-10-23T14:10:00.000Z',
  });
  assert.equal(ok2.ok, true);
  assert.equal(store.pairs['fresh-2']?.originId, 'origin-1');
  assert.equal(store.ledger.at(-1)?.fromId, 'fresh-1');
  assert.equal(store.ledger.at(-1)?.originId, 'origin-1');
});

test('stripFreshEyeContext, stripFreshEyeSections, and filterFreshEyeAttachments', () => {
  const ctx = stripFreshEyeContext({
    claudeMd: 'secret',
    agentsMd: 'rules',
    geminiMd: 'gemini rules',
    memory: { notes: 'remembered' },
    gitStatus: 'clean',
  });
  assert.equal('claudeMd' in ctx, false);
  assert.equal('agentsMd' in ctx, false);
  assert.equal('geminiMd' in ctx, false);
  assert.equal(ctx.memory, null);
  assert.equal(ctx.gitStatus, 'clean');

  const sections = stripFreshEyeSections([
    { key: 'claudeMd' },
    { id: 'AGENTSmd' },
    { name: 'geminiMd' },
    { key: 'memory' },
    { key: 'workspace' },
  ]);
  assert.deepEqual(sections, [{ key: 'workspace' }]);

  const attachments = filterFreshEyeAttachments([
    { type: 'hook_additional_context', content: 'remembered' },
    { type: 'agentsmd', content: 'rules' },
    { type: 'hook_blocking_error', content: 'safety block' },
    { type: 'file', path: 'src/index.js' },
  ]);
  assert.equal(attachments.length, 2);
  assert.equal(attachments[0].type, 'hook_blocking_error');
  assert.equal(attachments[1].type, 'file');
});

test('buildAgyStatusLine renders FreshEye strip, 8s restore notice, and empty string when idle', () => {
  const store = defaultStore();
  const baseMs = Date.parse('2026-10-23T17:30:00.000Z');
  recordOpenPair(store, {
    freshId: '3c82a10d-1111-2222-3333-444444444444',
    originId: '9f31c8ab-aaaa-bbbb-cccc-dddddddddddd',
    model: 'Gemini 4 Argon (High)',
    prompt: 'Audit auth',
    mode: 'session',
    createdAt: '2026-10-23T17:30:00.000Z',
  });

  // 1. Inside paired FreshEye session
  const freshLine = buildAgyStatusLine(
    store,
    { conversation_id: '3c82a10d-1111-2222-3333-444444444444' },
    baseMs + 1000,
  );
  assert.match(freshLine, /◎ FreshEye · Fresh Context \(3c82a10d\)/);
  assert.match(freshLine, /original 9f31c8ab kept/);

  // 2. Inside ordinary session with no restore notice -> empty string
  const idleLine = buildAgyStatusLine(
    store,
    { conversation_id: '9f31c8ab-aaaa-bbbb-cccc-dddddddddddd' },
    baseMs + 1000,
  );
  assert.equal(idleLine, '');

  // 3. Within 8s of restoring original session
  store.lastRestored = {
    originId: '9f31c8ab-aaaa-bbbb-cccc-dddddddddddd',
    freshId: '3c82a10d-1111-2222-3333-444444444444',
    restoredAt: new Date(baseMs + 2000).toISOString(),
  };
  const restoredLine = buildAgyStatusLine(
    store,
    { conversation_id: '9f31c8ab-aaaa-bbbb-cccc-dddddddddddd' },
    baseMs + 5000,
    RESTORE_NOTICE_MS,
  );
  assert.equal(
    restoredLine,
    '✓ Original conversation 9f31c8ab restored · FreshEye 3c82a10d kept',
  );

  // 4. After 8s restore notice expires -> empty string again
  const expiredLine = buildAgyStatusLine(
    store,
    { conversation_id: '9f31c8ab-aaaa-bbbb-cccc-dddddddddddd' },
    baseMs + 2000 + RESTORE_NOTICE_MS + 100,
    RESTORE_NOTICE_MS,
  );
  assert.equal(expiredLine, '');

  // 5. New ordinary session with no conversation_id does NOT leak store.activeSession.id
  store.activeSession = { id: '3c82a10d-1111-2222-3333-444444444444', agent: 'fresheye' };
  const newOrdinaryLine = buildAgyStatusLine(store, {}, baseMs + 1000);
  assert.equal(newOrdinaryLine, '');
});

test('saveStore and loadStore round-trip with 0600 permissions and pruning bounds', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fresheye-agy-test-'));
  try {
    const storePath = defaultStorePath({ CYCLOPS_FRESHEYE_STORE: path.join(tmpDir, 'store.json') });
    const store = defaultStore();

    for (let i = 0; i < MAX_PAIRS + 10; i += 1) {
      store.pairs[`fresh-${i}`] = {
        originId: 'origin-main',
        createdAt: new Date(1700000000000 + i * 1000).toISOString(),
      };
    }
    for (let i = 0; i < MAX_LEDGER + 25; i += 1) {
      appendLedger(store.ledger, {
        at: new Date(1700000000000 + i * 1000).toISOString(),
        event: 'open',
        fromId: 'origin-main',
        toId: `fresh-${i}`,
      });
    }
    // appendLedger truncates in-place immediately without waiting for saveStore
    assert.equal(store.ledger.length, MAX_LEDGER);

    saveStore(storePath, store);
    const stat = fs.statSync(storePath);
    assert.equal(stat.mode & 0o777, 0o600);

    const loaded = loadStore(storePath);
    assert.equal(Object.keys(loaded.pairs).length, MAX_PAIRS);
    assert.equal(loaded.ledger.length, MAX_LEDGER);
    assert.match(formatLedger(loaded.ledger, 5), /Cyclops FreshEye Ledger/);

    // Verify loadStore guards against arrays in object fields
    fs.writeFileSync(
      storePath,
      JSON.stringify({
        activeSession: ['bad'],
        pendingOpen: ['bad'],
        pendingSwitch: ['bad'],
        lastRestored: ['bad'],
      }),
    );
    const sanitized = loadStore(storePath);
    assert.equal(sanitized.activeSession, null);
    assert.equal(sanitized.pendingOpen, null);
    assert.equal(sanitized.pendingSwitch, null);
    assert.equal(sanitized.lastRestored, null);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('isCliEntrypoint resolves symlinks and paths with spaces', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fresheye entrypoint space-'));
  try {
    const realFile = path.join(tmpDir, 'real script.js');
    const symlinkFile = path.join(tmpDir, 'linked script.js');
    fs.writeFileSync(realFile, '// test\n');
    fs.symlinkSync(realFile, symlinkFile);
    const metaUrl = new URL(`file://${encodeURI(realFile)}`).href;
    assert.equal(isCliEntrypoint(metaUrl, symlinkFile), true);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('buildSessionBanner, buildConfirmPrompt, and conversationExistsOnDisk', () => {
  const banner = buildSessionBanner(
    {
      originId: '9f31c8ab-0000',
      model: 'Gemini 4 Argon',
      createdAt: '2026-10-23T14:15:00.000Z',
    },
    '3c82a10d-0000',
  );
  assert.equal(banner.length, 2);
  assert.match(banner[0], /◎ FreshEye · Fresh Context \(3c82a10d\)/);

  const confirm = buildConfirmPrompt({ direction: 'return', targetId: '9f31c8ab-0000' });
  assert.equal(confirm?.cancelLabel, 'Stay here');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fresheye-conv-test-'));
  try {
    fs.writeFileSync(path.join(tmpDir, 'conv-123.pb'), 'proto');
    assert.equal(
      conversationExistsOnDisk('conv-123', { env: { CYCLOPS_FRESHEYE_CONVERSATIONS_DIR: tmpDir } }),
      true,
    );
    assert.equal(
      conversationExistsOnDisk('conv-missing', { env: { CYCLOPS_FRESHEYE_CONVERSATIONS_DIR: tmpDir } }),
      false,
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
