import assert from "node:assert/strict";
import test from "node:test";
import { AgentRouter } from "../src/agent-router.js";

const definition = {
  command: "/ores-chatgpt",
  provider: "openai",
  profile: "ores"
};
const context = { teamId: "T_SECRET", channelId: "C_SECRET", userId: "U_SECRET" };

function fixture(includeSlackIdentifiers = false) {
  const calls = [];
  return {
    calls,
    router: new AgentRouter({
      includeSlackIdentifiers,
      profiles: { ores: { systemPrompt: "system" } },
      providers: {
        openai: {
          async generate(payload) {
            calls.push(payload);
            return { provider: "openai", model: "test", text: "ok" };
          }
        }
      }
    })
  };
}

test("does not disclose Slack identifiers to providers by default", async () => {
  const data = fixture();
  await data.router.run({ definition, prompt: "hello", context });
  const prompt = data.calls[0].systemPrompt;
  assert.match(prompt, /command=\/ores-chatgpt/);
  assert.doesNotMatch(prompt, /T_SECRET|C_SECRET|U_SECRET/);
});

test("can include Slack identifiers through an explicit opt-in", async () => {
  const data = fixture(true);
  await data.router.run({ definition, prompt: "hello", context });
  assert.match(data.calls[0].systemPrompt, /team=T_SECRET channel=C_SECRET user=U_SECRET/);
});
