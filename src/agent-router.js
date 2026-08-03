export class AgentRouter {
  /**
   * @param {{ providers: Record<string, any>, profiles: Record<string, any>, includeSlackIdentifiers?: boolean }} options
   */
  constructor({ providers, profiles, includeSlackIdentifiers = false }) {
    this.providers = providers;
    this.profiles = profiles;
    this.includeSlackIdentifiers = includeSlackIdentifiers;
  }

  /**
   * @param {{
   *   definition: any,
   *   prompt: string,
   *   model?: string,
   *   context: { teamId?: string, channelId?: string, userId?: string }
   * }} options
   */
  async run({ definition, prompt, model, context }) {
    const provider = this.providers[definition.provider];
    const profile = this.profiles[definition.profile];
    if (!provider) throw new Error(`Provider ${definition.provider} is not registered`);
    if (!profile) throw new Error(`Profile ${definition.profile} is not registered`);

    const contextParts = ["Slack slash command context:", `command=${definition.command}`];
    if (this.includeSlackIdentifiers) {
      contextParts.push(
        `team=${context.teamId || "unknown"}`,
        `channel=${context.channelId || "unknown"}`,
        `user=${context.userId || "unknown"}`
      );
    }
    const contextNote = contextParts.join(" ");

    return provider.generate({
      prompt,
      model,
      systemPrompt: `${profile.systemPrompt}\n\n${contextNote}`
    });
  }
}
