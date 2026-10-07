export const MAX_REQUEST_BYTES = 64 * 1024;
export const MAX_MESSAGES = 20;
export const MAX_MESSAGE_CHARACTERS = 4_000;
export const MAX_INPUT_CHARACTERS = 16_000;
export const MAX_OUTPUT_TOKENS = 1_024;
export const MAX_OUTPUT_CHARACTERS = 12_000;
export const PROVIDER_TIMEOUT_MS = 25_000;
// Two bounded Auto attempts plus the Ollama health check fit inside the 30s route budget.
export const AUTO_PROVIDER_TIMEOUT_MS = 12_000;
export const OLLAMA_HEALTH_TIMEOUT_MS = 1_500;
