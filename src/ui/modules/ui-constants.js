export const VIEW_META = {
  chat: ['Chat', 'Autonomous agent conversation'],
  operator: ['Execution Trace', 'Runtime, tools, and live execution state'],
  missions: ['Missions', 'Autonomous execution loops']
};

export const CATEGORY_TITLES = {
  general: 'General',
  'model-routing': 'Model Routing',
  'provider-vault': 'Providers & Vault',
  runtime: 'Runtime & Autonomy',
  tooling: 'Tools & Skills',
  browser: 'Browser / CDP',
  channels: 'Channels',
  developer: 'Developer'
};

export const DEFAULT_MODEL_PROVIDER_IDS = ['ollama-local', 'llama-cpp-local', 'ollama-cloud', 'nvidia', 'openrouter', 'xiaomimimo', 'openai'];
export const DEFAULT_SERVICE_PROVIDER_IDS = ['github', 'google-workspace', 'huggingface', 'elevenlabs', 'telegram', 'openai-oauth', 'github-copilot'];

export const SERVICE_SECRET_FIELD = {
  github: 'githubToken',
  'google-workspace': '',
  huggingface: 'huggingfaceApiKey',
  elevenlabs: 'elevenlabsApiKey',
  telegram: 'telegramBotToken',
  'openai-oauth': 'openaiOauthToken',
  'github-copilot': 'copilotGithubToken'
};

export const PROVIDER_SECRET_FIELD = {
  'ollama-local': '',
  'llama-cpp-local': '',
  'ollama-cloud': '',
  nvidia: 'nvidiaApiKey',
  openrouter: 'openrouterApiKey',
  xiaomimimo: 'xiaomimimoApiKey',
  openai: 'openaiApiKey'
};

export const PROVIDER_BASE_FIELD = {
  'ollama-local': 'ollamaLocalBaseUrl',
  'llama-cpp-local': 'llamaCppLocalBaseUrl',
  'ollama-cloud': 'ollamaCloudBaseUrl',
  nvidia: 'nvidiaBaseUrl',
  openrouter: 'openrouterBaseUrl',
  xiaomimimo: 'xiaomimimoBaseUrl',
  openai: 'openaiBaseUrl'
};