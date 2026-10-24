import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadStore } from '../scripts/core.js';
import { handleHookPayload } from '../scripts/hook.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = path.resolve(__dirname, '..');
const CTL_PATH = path.join(PLUGIN_ROOT, 'scripts', 'fresheye-ctl.js');
const STATUSLINE_PATH = path.join(PLUGIN_ROOT, 'scripts', 'statusline.js');

test('hook.js correlates PostToolUse(invoke_subagent) -> SessionStart(freshId) -> Stop(freshId)', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fresheye-hook-test-'));
  const storePath = path.join(tmpDir, 'store.json');
  const env = { ...process.env, CYCLOPS_FRESHEYE_STORE: storePath };

  try {
    // 1. Builder session starts
    handleHookPayload(
      {
        conversationId: 'origin-builder-11111111',
        modelName: 'Gemini 4 Argon (High)',
        workspacePaths: ['/workspace/demo'],
        invocationNum: 1,
      },
      'PreInvocation',
      env,
    );

    // 2. Builder invokes `fresheye` subagent
    handleHookPayload(
      {
        conversationId: 'origin-builder-11111111',
        modelName: 'Gemini 4 Argon (High)',
        workspacePaths: ['/workspace/demo'],
        toolCall: {
          name: 'invoke_subagent',
          args: {
            TypeName: 'fresheye',
            Role: 'FreshEye · Fresh Context',
            Model: 'inherit',
            Prompt: 'Review src/parser.ts and tests/parser.test.ts for missed edge cases',
          },
        },
      },
      'PostToolUse',
      env,
    );

    // 3. Subagent trajectory starts with its own isolated conversationId
    handleHookPayload(
      {
        conversationId: 'fresh-subagent-22222222',
        modelName: 'Gemini 4 Argon (High)',
        workspacePaths: ['/workspace/demo'],
      },
      'SessionStart',
      env,
    );

    let store = loadStore(storePath);
    assert.equal(store.pairs['fresh-subagent-22222222']?.originId, 'origin-builder-11111111');
    assert.equal(store.pairs['fresh-subagent-22222222']?.mode, 'subagent');
    assert.equal(store.ledger.at(-1)?.event, 'open');

    // 4. Subagent completes (`Stop`) -> logs `return` and sets `lastRestored`
    handleHookPayload(
      {
        conversationId: 'fresh-subagent-22222222',
        modelName: 'Gemini 4 Argon (High)',
        terminationReason: 'NO_TOOL_CALL',
      },
      'Stop',
      env,
    );

    store = loadStore(storePath);
    assert.equal(store.ledger.at(-1)?.event, 'return');
    assert.equal(store.lastRestored?.originId, 'origin-builder-11111111');
    assert.equal(store.lastRestored?.freshId, 'fresh-subagent-22222222');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('fresheye-ctl.js and statusline.js end-to-end session pairing, switching, and stale detection', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fresheye-ctl-test-'));
  const storePath = path.join(tmpDir, 'store.json');
  const convDir = path.join(tmpDir, 'conversations');
  fs.mkdirSync(convDir, { recursive: true });
  fs.writeFileSync(path.join(convDir, 'origin-aaaa1111.pb'), 'proto');
  fs.writeFileSync(path.join(convDir, 'fresh-bbbb2222.pb'), 'proto');

  const env = {
    ...process.env,
    CYCLOPS_FRESHEYE_STORE: storePath,
    CYCLOPS_FRESHEYE_CONVERSATIONS_DIR: convDir,
  };

  try {
    // 1. Prepare open from origin-aaaa1111
    const originOut = execFileSync(
      'node',
      [
        CTL_PATH,
        'prepare-open',
        '--origin',
        'origin-aaaa1111',
        '--model',
        'Gemini 4 Argon (High)',
        '--prompt',
        'Audit auth token validation',
        '--mode',
        'session',
      ],
      { env, encoding: 'utf8' },
    ).trim();
    assert.equal(originOut, 'origin-aaaa1111');

    // 2. Simulate new FreshEye session starting via hook.js
    handleHookPayload(
      {
        conversationId: 'fresh-bbbb2222',
        modelName: 'Gemini 4 Argon (High)',
        workspacePaths: [tmpDir],
      },
      'SessionStart',
      env,
    );

    // 3. Verify statusline.js outputs the ◎ FreshEye strip for fresh-bbbb2222
    const statusLineOut = execFileSync('node', [STATUSLINE_PATH], {
      env,
      input: JSON.stringify({ conversation_id: 'fresh-bbbb2222', model: 'Gemini 4 Argon (High)' }),
      encoding: 'utf8',
    }).trim();
    assert.match(statusLineOut, /◎ FreshEye · Fresh Context \(fresh-bb\)/);
    assert.match(statusLineOut, /original origin-a kept/);

    // 4. Verify switch in `toggle` mode returns to origin-aaaa1111
    execFileSync('node', [CTL_PATH, 'mode', 'toggle'], { env, encoding: 'utf8' });
    const switchReturnOut = execFileSync(
      'node',
      [CTL_PATH, 'switch', '--session', 'fresh-bbbb2222', '--check-disk'],
      { env, encoding: 'utf8' },
    ).trim();
    assert.equal(switchReturnOut, 'origin-aaaa1111');

    // 5. Verify statusline.js now shows the 8-second restore notice on origin-aaaa1111
    const restoredLineOut = execFileSync('node', [STATUSLINE_PATH], {
      env,
      input: JSON.stringify({ conversation_id: 'origin-aaaa1111' }),
      encoding: 'utf8',
    }).trim();
    assert.equal(
      restoredLineOut,
      '✓ Original conversation origin-a restored · FreshEye fresh-bb kept',
    );

    // 6. Delete fresh-bbbb2222.pb from disk and verify `--check-disk` catches stale target cleanly
    fs.unlinkSync(path.join(convDir, 'fresh-bbbb2222.pb'));
    assert.throws(
      () => {
        execFileSync(
          'node',
          [CTL_PATH, 'switch', '--session', 'origin-aaaa1111', '--check-disk'],
          { env, encoding: 'utf8', stdio: 'pipe' },
        );
      },
      (err) => err.status === 3,
    );

    // 7. Verify ledger contains open, return, and stale events
    const logOut = execFileSync('node', [CTL_PATH, 'log', '10'], {
      env,
      encoding: 'utf8',
    });
    assert.match(logOut, /open/);
    assert.match(logOut, /return/);
    assert.match(logOut, /stale/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('hook.js does not hijack pendingOpen for an existing multi-turn conversation in another terminal', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fresheye-concurrent-test-'));
  const storePath = path.join(tmpDir, 'store.json');
  const env = { ...process.env, CYCLOPS_FRESHEYE_STORE: storePath };

  try {
    // 1. User runs prepare-open in /workspace/draw from origin-draw-1111
    execFileSync(
      'node',
      [
        CTL_PATH,
        'prepare-open',
        '--origin',
        'origin-draw-1111',
        '--workspace',
        '/workspace/draw',
        '--interactive',
        '--mode',
        'session',
      ],
      { env, encoding: 'utf8' },
    );

    // 2. Meanwhile, an existing long-running conversation in another terminal fires PreInvocation
    handleHookPayload(
      {
        conversationId: 'existing-other-chat-9999',
        modelName: 'Gemini 4 Argon (High)',
        workspacePaths: ['/workspace/other'],
        invocationNum: 4,
        initialNumSteps: 120,
      },
      'PreInvocation',
      env,
    );

    // Verify existing-other-chat-9999 did NOT consume pendingOpen
    let store = loadStore(storePath);
    assert.equal(Boolean(store.pairs['existing-other-chat-9999']), false);
    assert.equal(store.pendingOpen?.originId, 'origin-draw-1111');

    // 3. Now the actual new FreshEye session in /workspace/draw fires its first PreInvocation (invocationNum: 1)
    // First, verify a brand-new turn (invocationNum: 1) in a DIFFERENT workspace (/workspace/other-new) does NOT hijack pendingOpen!
    handleHookPayload(
      {
        conversationId: 'brand-new-other-workspace-8888',
        modelName: 'Gemini 4 Argon (High)',
        workspacePaths: ['/workspace/other-new'],
        invocationNum: 1,
        initialNumSteps: 1,
      },
      'PreInvocation',
      env,
    );
    store = loadStore(storePath);
    assert.equal(Boolean(store.pairs['brand-new-other-workspace-8888']), false);
    assert.equal(store.pendingOpen?.originId, 'origin-draw-1111');

    // Now the actual new FreshEye session in /workspace/draw fires its first PreInvocation (invocationNum: 1)
    handleHookPayload(
      {
        conversationId: 'fresh-draw-2222',
        modelName: 'Gemini 4 Argon (High)',
        workspacePaths: ['/workspace/draw'],
        invocationNum: 1,
        initialNumSteps: 1,
      },
      'PreInvocation',
      env,
    );

    store = loadStore(storePath);
    assert.equal(store.pairs['fresh-draw-2222']?.originId, 'origin-draw-1111');
    assert.equal(store.pendingOpen, null);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('hook.js correlates subagents via payload.result, handles >15s subagent Stop before PostToolUse, and ignores non-FreshEye subagents', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fresheye-subagent-race-test-'));
  const storePath = path.join(tmpDir, 'store.json');
  const env = { ...process.env, CYCLOPS_FRESHEYE_STORE: storePath };

  try {
    // 1. Builder starts in /workspace/app
    handleHookPayload(
      {
        conversationId: 'builder-root-1000',
        modelName: 'Gemini 4 Argon (High)',
        workspacePaths: ['/workspace/app'],
        invocationNum: 1,
      },
      'PreInvocation',
      env,
    );

    // 2. Non-FreshEye subagent (research) starts and finishes -> must NOT pair as FreshEye
    handleHookPayload(
      {
        conversationId: 'subagent-research-2000',
        modelName: 'Gemini 4 Argon (High)',
        workspacePaths: ['/workspace/app'],
      },
      'SessionStart',
      env,
    );
    handleHookPayload(
      {
        conversationId: 'builder-root-1000',
        modelName: 'Gemini 4 Argon (High)',
        workspacePaths: ['/workspace/app'],
        toolCall: {
          name: 'invoke_subagent',
          args: {
            TypeName: 'research',
            Role: 'Codebase Researcher',
            Prompt: 'Find all auth handlers',
          },
        },
      },
      'PostToolUse',
      env,
    );

    let store = loadStore(storePath);
    assert.equal(Boolean(store.pairs['subagent-research-2000']), false);
    assert.equal(store.activeSession?.lastUnpairedStart, undefined);

    // 3. Direct payload.result correlation on invoke_subagent(fresheye)
    handleHookPayload(
      {
        conversationId: 'builder-root-1000',
        modelName: 'Gemini 4 Argon (High)',
        workspacePaths: ['/workspace/app'],
        toolCall: {
          name: 'invoke_subagent',
          args: {
            TypeName: 'fresheye',
            Role: 'FreshEye · Fresh Context',
            Prompt: 'Audit token verification',
          },
        },
        result: {
          conversationId: 'fresh-from-result-3000',
        },
      },
      'PostToolUse',
      env,
    );

    store = loadStore(storePath);
    assert.equal(store.pairs['fresh-from-result-3000']?.originId, 'builder-root-1000');

    // 4. Long-running subagent where SessionStart AND Stop fire before PostToolUse arrives
    handleHookPayload(
      {
        conversationId: 'fresh-long-4000',
        modelName: 'Gemini 4 Argon (High)',
        workspacePaths: ['/workspace/app'],
      },
      'SessionStart',
      env,
    );
    handleHookPayload(
      {
        conversationId: 'fresh-long-4000',
        modelName: 'Gemini 4 Argon (High)',
        workspacePaths: ['/workspace/app'],
        terminationReason: 'NO_TOOL_CALL',
      },
      'Stop',
      env,
    );
    handleHookPayload(
      {
        conversationId: 'builder-root-1000',
        modelName: 'Gemini 4 Argon (High)',
        workspacePaths: ['/workspace/app'],
        toolCall: {
          name: 'invoke_subagent',
          args: {
            TypeName: 'fresheye',
            Role: 'FreshEye · Fresh Context',
            Prompt: 'Deep review after 45s',
          },
        },
      },
      'PostToolUse',
      env,
    );

    store = loadStore(storePath);
    assert.equal(store.pairs['fresh-long-4000']?.originId, 'builder-root-1000');
    assert.equal(store.lastRestored?.originId, 'builder-root-1000');
    assert.equal(store.lastRestored?.freshId, 'fresh-long-4000');
    assert.equal(store.activeSession?.id, 'builder-root-1000');
    assert.equal(store.ledger.at(-1)?.event, 'return');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('CLI scripts work via symlinks in paths with spaces, handle EOF on switch, and parse flags cleanly', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fresheye space symlink-'));
  const storePath = path.join(tmpDir, 'store.json');
  const convDir = path.join(tmpDir, 'conversations');
  fs.mkdirSync(convDir, { recursive: true });
  fs.writeFileSync(path.join(convDir, 'origin-eof-1111.pb'), 'proto');
  fs.writeFileSync(path.join(convDir, 'fresh-eof-2222.pb'), 'proto');

  const hookLink = path.join(tmpDir, 'hook link.js');
  const ctlLink = path.join(tmpDir, 'ctl link.js');
  const statusLink = path.join(tmpDir, 'status link.js');
  fs.symlinkSync(path.join(PLUGIN_ROOT, 'scripts', 'hook.js'), hookLink);
  fs.symlinkSync(CTL_PATH, ctlLink);
  fs.symlinkSync(STATUSLINE_PATH, statusLink);

  const env = {
    ...process.env,
    CYCLOPS_FRESHEYE_STORE: storePath,
    CYCLOPS_FRESHEYE_CONVERSATIONS_DIR: convDir,
    ANTIGRAVITY_CONVERSATION_ID: 'origin-eof-1111',
  };

  try {
    // 1. hook.js via symlink with space outputs "{}\n"
    const hookOut = execFileSync('node', [hookLink, '--event', 'SessionStart'], {
      env,
      input: JSON.stringify({ conversationId: 'origin-eof-1111', workspacePaths: [tmpDir] }),
      encoding: 'utf8',
    });
    assert.equal(hookOut, '{}\n');

    // 2. prepare-open with --prompt starting with "--" and ANTIGRAVITY_CONVERSATION_ID detection
    const prepOut = execFileSync(
      'node',
      [ctlLink, 'prepare-open', '--prompt', '--foo flag edge case', '--workspace', tmpDir],
      { env, encoding: 'utf8' },
    ).trim();
    assert.equal(prepOut, 'origin-eof-1111');

    // 3. Pair fresh-eof-2222 via hookLink
    execFileSync('node', [hookLink, '--event', 'SessionStart'], {
      env,
      input: JSON.stringify({ conversationId: 'fresh-eof-2222', workspacePaths: [tmpDir] }),
      encoding: 'utf8',
    });

    // 4. statusline.js via symlink with space outputs FreshEye strip
    const statusOut = execFileSync('node', [statusLink], {
      env,
      input: JSON.stringify({ conversation_id: 'fresh-eof-2222' }),
      encoding: 'utf8',
    }).trim();
    assert.match(statusOut, /◎ FreshEye · Fresh Context \(fresh-eo\)/);

    // 5. switch in default "ask" mode with closed stdin (EOF) exits with code 5 (confirm-cancelled) immediately
    assert.throws(
      () => {
        execFileSync('node', [ctlLink, 'switch', '--session', 'fresh-eof-2222'], {
          env,
          input: '',
          encoding: 'utf8',
          stdio: 'pipe',
          timeout: 3000,
        });
      },
      (err) => err.status === 5,
    );

    const storeAfterCancel = loadStore(storePath);
    assert.equal(storeAfterCancel.ledger.at(-1)?.event, 'confirm-cancelled');

    // 6. switch-failed records switch-failed and restores activeSession.id
    execFileSync(
      'node',
      [ctlLink, 'switch-failed', '--from', 'fresh-eof-2222', '--to', 'origin-eof-1111', '--note', 'test failure'],
      { env, encoding: 'utf8' },
    );
    const jsonLog = JSON.parse(
      execFileSync('node', [ctlLink, 'log', '--json', '2'], { env, encoding: 'utf8' }),
    );
    assert.equal(jsonLog.length, 2);
    assert.equal(jsonLog[0].event, 'switch-failed');
    assert.equal(jsonLog[0].promptPreview, '');
    assert.equal(loadStore(storePath).activeSession?.id, 'fresh-eof-2222');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('agents/fresheye.md preserves inheritCustomizations: false while enabling full tools, MCP, and browser', () => {
  const agentMd = fs.readFileSync(path.join(PLUGIN_ROOT, 'agents', 'fresheye.md'), 'utf8');
  assert.match(agentMd, /^inheritCustomizations:\s*false$/m);
  assert.match(agentMd, /^inheritMcp:\s*true$/m);
  for (const requiredTool of [
    'read_file',
    'view_file',
    'write_file',
    'edit_file',
    'run_command',
    'manage_task',
    'invoke_subagent',
    'search_web',
    'read_url_content',
  ]) {
    assert.match(agentMd, new RegExp(`^\\s*-\\s*${requiredTool}$`, 'm'));
  }
  assert.match(agentMd, /^\s*-\s*browser$/m);
  assert.match(agentMd, /^\s*-\s*name:\s*chrome_devtools$/m);
  assert.match(agentMd, /chrome-devtools-mcp@latest/);
});
