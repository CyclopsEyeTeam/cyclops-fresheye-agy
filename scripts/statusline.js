#!/usr/bin/env node
/**
 * statusline.js - Custom statusline renderer for Antigravity (`agy`).
 *
 * Reads Antigravity's StatusLineData JSON from stdin, checks if the active session
 * is a paired FreshEye session (or within 8s of restoring the original session),
 * and prints the `◎ FreshEye · Fresh Context` strip. Prints nothing in ordinary
 * conversations so `stack_with_default: true` adds zero visual clutter when idle.
 */

import fs from 'node:fs';
import { buildAgyStatusLine, defaultStorePath, loadStore } from './core.js';

function readStdinJson() {
  try {
    const raw = fs.readFileSync(0, 'utf8');
    if (!raw || !raw.trim()) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function main() {
  try {
    const statusData = readStdinJson();
    const storePath = defaultStorePath(process.env);
    const store = loadStore(storePath);
    const line = buildAgyStatusLine(store, statusData, Date.now());
    if (line) {
      process.stdout.write(`${line}\n`);
    }
  } catch {
    // Silent fallback on error so statusline never shows error hints
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
