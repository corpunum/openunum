export const VIEW_META = {
  chat: ['Chat Terminal', 'Autonomous agent conversation'],
  operator: ['Execution Trace', 'Runtime, tools, and live execution state'],
  'model-routing': ['Model Routing', 'Primary model selection and fallback strategy'],
  'provider-config': ['Provider Vault', 'Provider matrix, models, and secure auth vault'],
  'settings-tooling': ['Tooling and Skills', 'Agent tools, skills inventory, and model-backed rollout'],
  browser: ['Browser Ops', 'Browser and hardware control'],
  telegram: ['Telegram Bridge', 'Channel connectivity and polling control'],
  missions: ['Mission Runner', 'Autonomous execution loops'],
  'control-plane': ['Control Plane API', 'Backend operations and full API access']
};

export const DEFAULT_MODEL_PROVIDER_IDS = ['ollama-local', 'ollama-cloud', 'nvidia', 'openrouter', 'xiaomimimo', 'openai'];
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
  'ollama-cloud': '',
  nvidia: 'nvidiaApiKey',
  openrouter: 'openrouterApiKey',
  xiaomimimo: 'xiaomimimoApiKey',
  openai: 'openaiApiKey'
};

export const PROVIDER_BASE_FIELD = {
  'ollama-local': 'ollamaLocalBaseUrl',
  'ollama-cloud': 'ollamaCloudBaseUrl',
  nvidia: 'nvidiaBaseUrl',
  openrouter: 'openrouterBaseUrl',
  xiaomimimo: 'xiaomimimoBaseUrl',
  openai: 'openaiBaseUrl'
};

