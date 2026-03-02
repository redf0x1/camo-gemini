#!/usr/bin/env node

/**
 * CamoGemini Setup Wizard
 * Checks prerequisites and outputs per-client MCP config
 */

import { existsSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';

const CAMOFOX_URL = process.env.CAMOFOX_URL || 'http://localhost:9377';

interface ClientInfo {
  name: string;
  configPath: string;
  configKey: 'servers' | 'mcpServers';
  detected: boolean;
}

function detectClients(): ClientInfo[] {
  const home = homedir();
  const os = platform();

  const clients: ClientInfo[] = [
    {
      name: 'VS Code',
      configPath: os === 'darwin'
        ? join(home, 'Library', 'Application Support', 'Code', 'User')
        : os === 'win32'
          ? join(home, 'AppData', 'Roaming', 'Code', 'User')
          : join(home, '.config', 'Code', 'User'),
      configKey: 'servers',
      detected: false,
    },
    {
      name: 'Claude Desktop',
      configPath: os === 'darwin'
        ? join(home, 'Library', 'Application Support', 'Claude')
        : os === 'win32'
          ? join(home, 'AppData', 'Roaming', 'Claude')
          : join(home, '.config', 'Claude'),
      configKey: 'mcpServers',
      detected: false,
    },
    {
      name: 'Cursor',
      configPath: join(home, '.cursor'),
      configKey: 'mcpServers',
      detected: false,
    },
    {
      name: 'Windsurf',
      configPath: os === 'darwin'
        ? join(home, '.codeium', 'windsurf')
        : os === 'win32'
          ? join(home, '.codeium', 'windsurf')
          : join(home, '.codeium', 'windsurf'),
      configKey: 'mcpServers',
      detected: false,
    },
  ];

  for (const client of clients) {
    client.detected = existsSync(client.configPath);
  }

  return clients;
}

function generateConfig(configKey: 'servers' | 'mcpServers'): string {
  if (configKey === 'servers') {
    return JSON.stringify({
      servers: {
        "camo-gemini": {
          type: 'stdio',
          command: 'npx',
          args: ['-y', 'camo-gemini@latest'],
          env: { CAMOFOX_URL },
        },
      },
    }, null, 2);
  }
  return JSON.stringify({
    mcpServers: {
      "camo-gemini": {
        command: 'npx',
        args: ['-y', 'camo-gemini@latest'],
        env: { CAMOFOX_URL },
      },
    },
  }, null, 2);
}

async function checkCamofox(): Promise<boolean> {
  try {
    const response = await fetch(`${CAMOFOX_URL}/health`, { signal: AbortSignal.timeout(5000) });
    return response.ok;
  } catch {
    return false;
  }
}

function checkNodeVersion(): boolean {
  const [major] = process.versions.node.split('.').map(Number);
  return major >= 18;
}

function printHeader(): void {
  console.log('');
  console.log('  ╔══════════════════════════════════════╗');
  console.log('  ║       CamoGemini Setup Wizard        ║');
  console.log('  ╚══════════════════════════════════════╝');
  console.log('');
}

function printCheck(ok: boolean, label: string, detail: string): void {
  const icon = ok ? '✅' : '❌';
  console.log(`  ${icon} ${label}: ${detail}`);
}

async function main(): Promise<void> {
  printHeader();
  console.log('  Checking prerequisites...\n');

  let allOk = true;

  const nodeOk = checkNodeVersion();
  printCheck(nodeOk, 'Node.js', nodeOk ? `v${process.versions.node} (OK)` : `v${process.versions.node} (require >= 18)`);
  if (!nodeOk) allOk = false;

  const camofoxOk = await checkCamofox();
  printCheck(camofoxOk, 'CamoFox Browser', camofoxOk ? `Running on ${CAMOFOX_URL}` : `Not reachable at ${CAMOFOX_URL}`);
  if (!camofoxOk) {
    allOk = false;
    console.log('');
    console.log('  💡 Start CamoFox with Docker:');
    console.log('');
    console.log('     docker run -d -p 9377:9377 --name camofox ghcr.io/redf0x1/camofox-browser:latest');
    console.log('');
  }

  if (!allOk) {
    console.log('  ⚠️  Fix the issues above and run setup again.\n');
    process.exit(1);
  }

  console.log('');
  console.log('  All checks passed! Add the config below to your MCP client:\n');

  const clients = detectClients();
  const detected = clients.filter(c => c.detected);
  const showAll = detected.length === 0;
  const clientsToShow = showAll ? clients : detected;

  if (showAll) {
    console.log('  (No MCP clients detected — showing all configs)\n');
  }

  for (const client of clientsToShow) {
    const marker = client.detected ? ' ← detected' : '';
    console.log(`  ── ${client.name}${marker} ${'─'.repeat(Math.max(1, 38 - client.name.length - marker.length))}`);
    console.log('');
    const config = generateConfig(client.configKey);
    for (const line of config.split('\n')) {
      console.log(`     ${line}`);
    }
    console.log('');
  }

  console.log('  ── Next Steps ─────────────────────────────');
  console.log('');
  console.log('  1. Copy the config above into your editor\'s MCP config file');
  console.log('  2. Restart your editor');
  console.log('  3. Use the gemini_login tool to authenticate with Google');
  console.log('');
  console.log('  ── Verify Installation ────────────────────');
  console.log('');
  console.log('  Paste this prompt into your AI agent:');
  console.log('');
  console.log('     Verify my CamoGemini setup:');
  console.log('     1) Call gemini_health — is CamoFox connected?');
  console.log('     2) Call gemini_login to authenticate');
  console.log('     3) Call gemini_generate with "Say hello in 5 words"');
  console.log('     Report pass/fail for each step.');
  console.log('');
}

main().catch((err) => {
  console.error('Setup failed:', err);
  process.exit(1);
});
