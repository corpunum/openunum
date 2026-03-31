import { loadConfig } from '../config.mjs';
import { ResearchManager } from '../research/manager.mjs';

const config = loadConfig();
const research = new ResearchManager({ config });

const simulate = process.argv.includes('--simulate');
const out = await research.runDailyResearch({ simulate });
console.log(JSON.stringify(out, null, 2));

