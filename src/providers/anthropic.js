export class AnthropicProvider {
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
    if (!this.apiKey) throw new Error("ANTHROPIC_API_KEY is not configured");
    if (!this.#client) {
      const { default: Anthropic } = await import("@anthropic-ai/sdk");
      this.#client = new Anthropic({ apiKey: this.apiKey, baseURL: this.baseURL || undefined });
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const selectedModel = model || this.defaultModel;
      const response = await this.#client.messages.create(
        {
          model: selectedModel,
          max_tokens: this.maxOutputTokens,
          system: systemPrompt,
          messages: [{ role: "user", content: prompt }]
        },
        { signal: controller.signal }
      );

      const text = response.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("\n")
        .trim();
      if (!text) throw new Error("Anthropic returned an empty response");
      return { text, model: response.model || selectedModel, provider: "anthropic" };
    } finally {
      clearTimeout(timer);
    }
  }
}
