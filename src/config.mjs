import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import dotenv from 'dotenv';

dotenv.config();

export function getHomeDir() {
  return process.env.OPENUNUM_HOME || path.join(os.homedir(), '.openunum');
}

export function ensureHome() {
  const home = getHomeDir();
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(path.join(home, 'logs'), { recursive: true });
  fs.mkdirSync(path.join(home, 'skills'), { recursive: true });
  return home;
}

export function getConfigPath() {
  return path.join(getHomeDir(), 'openunum.json');
}

export function defaultConfig() {
  const envPort = Number(process.env.OPENUNUM_PORT || 18880);
  return {
    server: { host: '127.0.0.1', port: Number.isFinite(envPort) ? envPort : 18880 },
    browser: { cdpUrl: 'http://127.0.0.1:9222', fallbackEnabled: true },
    runtime: { maxToolIterations: 4, shellEnabled: false },
    model: {
      provider: 'ollama',
      model: 'ollama/minimax-m2.7:cloud',
      ollamaBaseUrl: process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434',
      openrouterBaseUrl: process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
      nvidiaBaseUrl: process.env.NVIDIA_BASE_URL || 'https://integrate.api.nvidia.com/v1',
      genericBaseUrl: process.env.GENERIC_BASE_URL || '',
      openrouterApiKey: process.env.OPENROUTER_API_KEY || '',
      nvidiaApiKey: process.env.NVIDIA_API_KEY || '',
      genericApiKey: process.env.GENERIC_API_KEY || ''
    },
    channels: {
      telegram: { botToken: process.env.TELEGRAM_BOT_TOKEN || '', enabled: false }
    }
  };
}

export function loadConfig() {
  ensureHome();
  const configPath = getConfigPath();
  if (!fs.existsSync(configPath)) {
    const cfg = defaultConfig();
    fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2));
    return cfg;
  }
  const raw = fs.readFileSync(configPath, 'utf8');
  return JSON.parse(raw);
}

export function saveConfig(config) {
  ensureHome();
  fs.writeFileSync(getConfigPath(), JSON.stringify(config, null, 2));
}
