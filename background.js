chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((err) => console.error(err));

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== "extractMemories") return;

  const sys = `You are a memory extractor. Read the conversation and return ONLY JSON.
Schema: {"memories":[{"key":"snake_case_key","value":"short fact or preference","tags":["tag1"]}]}
Rules:
- Include only durable, reusable facts/preferences about the user (not small talk).
- Merge duplicates by key.
- Keep keys short and stable across sessions.
- If nothing is worth remembering, return {"memories":[]}`;

  (async () => {
    try {
      const res = await fetch("https://api.deepseek.com/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${msg.apiKey}`,
        },
        body: JSON.stringify({
          model: "deepseek-chat",
          messages: [
            { role: "system", content: sys },
            { role: "user", content: msg.conversation },
          ],
          response_format: { type: "json_object" },
          temperature: 0.2,
        }),
      });
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        return sendResponse({ ok: false, error: `API ${res.status}: ${t.slice(0, 120)}` });
      }
      const data = await res.json();
      const content = data.choices?.[0]?.message?.content || "{}";
      let parsed;
      try {
        parsed = JSON.parse(content);
      } catch {
        return sendResponse({ ok: false, error: "Model returned non-JSON" });
      }
      sendResponse({ ok: true, memories: Array.isArray(parsed.memories) ? parsed.memories : [] });
    } catch (err) {
      sendResponse({ ok: false, error: err.message });
    }
  })();

  return true; // keep the message channel open for async sendResponse
});