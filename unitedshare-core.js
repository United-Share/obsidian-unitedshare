"use strict";

class UnitedShareError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "UnitedShareError";
    this.status = status;
  }
}

function chatCompletionsUrl(baseUrl) {
  return `${String(baseUrl || "").replace(/\/+$/, "")}/chat/completions`;
}

function parseContent(data) {
  const content = data && data.choices && data.choices[0] && data.choices[0].message
    ? data.choices[0].message.content
    : undefined;
  if (typeof content === "string" && content.trim()) return content.trim();
  if (Array.isArray(content)) {
    const text = content
      .map((part) => (typeof part === "string" ? part : (part && part.text) || ""))
      .join("")
      .trim();
    if (text) return text;
  }
  throw new UnitedShareError("Das Modell hat keine Antwort geliefert.", 0);
}

function messageForStatus(status) {
  if (status === 401 || status === 403) return "Der UnitedShare-API-Key wurde abgelehnt.";
  if (status === 404) return "Das Modell ist auf api.unitedshare.ai nicht vorhanden.";
  return `Modellaufruf fehlgeschlagen, Status ${status}.`;
}

async function completeChat({
  baseUrl,
  apiKey,
  model,
  messages,
  timeoutMs = 90000,
  fetchImpl = globalThis.fetch,
}) {
  if (!apiKey) throw new UnitedShareError("Der UnitedShare-API-Key fehlt.", 0);
  if (!model) throw new UnitedShareError("Die Modell-Kennung fehlt.", 0);
  if (typeof fetchImpl !== "function") {
    throw new UnitedShareError("api.unitedshare.ai ist nicht erreichbar.", 0);
  }

  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error("timeout");
      error.name = "AbortError";
      reject(error);
    }, timeoutMs);
  });

  let response;
  try {
    response = await Promise.race([
      fetchImpl(chatCompletionsUrl(baseUrl), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          temperature: 0.2,
          max_tokens: 1200,
          messages,
        }),
      }),
      timeout,
    ]);
  } catch (error) {
    if (error && error.name === "AbortError") {
      throw new UnitedShareError("Das Modell hat nicht rechtzeitig geantwortet.", 0);
    }
    throw new UnitedShareError("api.unitedshare.ai ist nicht erreichbar.", 0);
  } finally {
    clearTimeout(timer);
  }

  if (!response || !response.ok) {
    const status = response && response.status ? response.status : 0;
    if (response && typeof response.text === "function") {
      try {
        await response.text();
      } catch (_err) {
        /* Rohtext bleibt ungelesen. */
      }
    }
    throw new UnitedShareError(messageForStatus(status), status);
  }

  const data = typeof response.json === "function" ? await response.json() : response;
  return parseContent(data);
}

module.exports = {
  UnitedShareError,
  chatCompletionsUrl,
  completeChat,
  parseContent,
  messageForStatus,
};
