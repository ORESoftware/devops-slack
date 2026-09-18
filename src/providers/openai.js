export class OpenAIProvider {
  /** @type {any} */
  #client;

  /**
   * @param {{
   *   apiKey?: string,
   *   baseURL?: string,
   *   defaultModel: string,
   *   timeoutMs: number,
   *   maxOutputTokens: number,
   *   client?: any
   * }} options
   */
  constructor({ apiKey, baseURL, defaultModel, timeoutMs, maxOutputTokens, client }) {
    this.apiKey = apiKey;
    this.baseURL = baseURL;
    this.defaultModel = defaultModel;
    this.timeoutMs = timeoutMs;
    this.maxOutputTokens = maxOutputTokens;
    this.#client = client;
  }

  /** @param {{ prompt: string, systemPrompt: string, model?: string }} options */
  async generate({ prompt, systemPrompt, model }) {
    if (!this.apiKey) throw new Error("OPENAI_API_KEY is not configured");
    if (!this.#client) {
      const { default: OpenAI } = await import("openai");
      this.#client = new OpenAI({ apiKey: this.apiKey, baseURL: this.baseURL || undefined });
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const selectedModel = model || this.defaultModel;
      const response = await this.#client.responses.create(
        {
          model: selectedModel,
          instructions: systemPrompt,
          input: prompt,
          max_output_tokens: this.maxOutputTokens,
          store: false
        },
        { signal: controller.signal }
      );

      const text = response.output_text?.trim();
      if (!text) throw new Error("OpenAI returned an empty response");
      return { text, model: response.model || selectedModel, provider: "openai" };
    } finally {
      clearTimeout(timer);
    }
  }
}
