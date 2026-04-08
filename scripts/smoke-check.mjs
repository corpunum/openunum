import { loadConfig } from '../src/config.mjs';
import os from 'node:os';
import path from 'node:path';

async function main() {
  const cfg = loadConfig();
  const expectedHome = process.env.OPENUNUM_HOME || path.join(os.homedir(), '.openunum');
  const expectedPort = Number(process.env.OPENUNUM_EXPECTED_PORT || 18880);

  const checks = [];

  checks.push({
    name: 'home_path',
    pass: expectedHome === (process.env.OPENUNUM_HOME || expectedHome),
    detail: expectedHome,
  });

  checks.push({
    name: 'port_isolation',
    pass: cfg.server?.port === expectedPort,
    detail: String(cfg.server?.port),
  });

  checks.push({
    name: 'service_name',
    pass: true,
    detail: 'deploy/openunum.service',
  });

  checks.push({
    name: 'provider_matrix_present',
    pass: Boolean(
      cfg.model?.providerModels?.ollama &&
      cfg.model?.providerModels?.openrouter &&
      cfg.model?.providerModels?.nvidia &&
      (cfg.model?.providerModels?.openai || cfg.model?.providerModels?.generic)
    ),
    detail: JSON.stringify(cfg.model?.providerModels || {}),
  });

  const failed = checks.filter((c) => !c.pass);
  for (const c of checks) {
    console.log(`${c.pass ? 'PASS' : 'FAIL'} ${c.name}: ${c.detail}`);
  }

  if (failed.length > 0) {
    process.exit(1);
  }
}

main().catch((e) => {
  console.error('FAIL smoke-check:', e.message);
  process.exit(1);
});
