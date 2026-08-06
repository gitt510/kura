// server.ts — companion の local 配信面。GET / が self-contained HTML、
// GET /events が SSE。接続時に既存 card を replay してから live 配信する。
// 外部 asset なし・localhost bind のみ。

type Client = ReadableStreamDefaultController<Uint8Array>;

export interface ServerHandle {
  url: string;
  broadcast(event: unknown): void;
  stop(): void;
}

const encoder = new TextEncoder();

function sseChunk(event: unknown): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(event)}\n\n`);
}

export function startServer(port: number, replay: () => unknown[]): ServerHandle {
  const clients = new Set<Client>();

  const server = Bun.serve({
    port,
    hostname: "127.0.0.1",
    fetch(request: Request): Response {
      const path = new URL(request.url).pathname;
      if (path === "/events") {
        let self: Client;
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            self = controller;
            for (const event of replay()) controller.enqueue(sseChunk(event));
            clients.add(controller);
          },
          cancel() {
            clients.delete(self);
          },
        });
        return new Response(stream, {
          headers: {
            "content-type": "text/event-stream",
            "cache-control": "no-store",
          },
        });
      }
      if (path === "/") {
        return new Response(PAGE, { headers: { "content-type": "text/html; charset=utf-8" } });
      }
      return new Response("not found", { status: 404 });
    },
  });

  // 中間 proxy や idle timeout に SSE を切られないための keepalive。
  const heartbeat = setInterval(() => {
    for (const client of clients) {
      try {
        client.enqueue(encoder.encode(": ping\n\n"));
      } catch {
        clients.delete(client);
      }
    }
  }, 30_000);

  return {
    url: `http://127.0.0.1:${port}`,
    broadcast(event: unknown): void {
      const chunk = sseChunk(event);
      for (const client of clients) {
        try {
          client.enqueue(chunk);
        } catch {
          clients.delete(client);
        }
      }
    },
    stop(): void {
      clearInterval(heartbeat);
      server.stop(true);
    },
  };
}

const PAGE = `<!doctype html>
<html lang="ja">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>kura companion</title>
<style>
  :root {
    --bg: #faf9f6; --card: #ffffff; --ink: #1c1b1a; --sub: #6b675f;
    --line: #e5e2da; --accent: #8a6d3b; --en: #1f5c46; --err: #a04040;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #16181d; --card: #1e2128; --ink: #e8e6e1; --sub: #98938a;
      --line: #2c303a; --accent: #c9a86a; --en: #7fc8a9; --err: #d98a8a;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--bg); color: var(--ink);
    font: 15px/1.65 -apple-system, "Hiragino Sans", "Noto Sans JP", sans-serif;
  }
  header {
    padding: 14px 20px; border-bottom: 1px solid var(--line);
    display: flex; align-items: baseline; gap: 10px;
  }
  header h1 { font-size: 15px; margin: 0; letter-spacing: .04em; }
  header .state { font-size: 12px; color: var(--sub); }
  main { max-width: 720px; margin: 0 auto; padding: 20px 16px 60px; }
  .empty { color: var(--sub); text-align: center; padding: 48px 0; font-size: 13px; }
  article {
    background: var(--card); border: 1px solid var(--line); border-radius: 10px;
    padding: 14px 16px; margin-bottom: 14px;
  }
  .meta { display: flex; gap: 8px; align-items: center; font-size: 11px; color: var(--sub); margin-bottom: 8px; }
  .badge {
    border: 1px solid var(--line); border-radius: 4px; padding: 0 6px;
    font-family: ui-monospace, monospace; font-size: 10px;
  }
  .badge.ja { color: var(--accent); border-color: var(--accent); }
  .input { white-space: pre-wrap; overflow-wrap: anywhere; color: var(--sub); font-size: 13px; }
  .english {
    white-space: pre-wrap; overflow-wrap: anywhere; margin-top: 8px;
    color: var(--en); font-size: 15px; font-weight: 550;
  }
  .note { margin-top: 6px; font-size: 12.5px; color: var(--sub); }
  .pending .english { color: var(--sub); font-weight: 400; }
  .pending .english::after { content: " …"; animation: blink 1.2s infinite; }
  .error .english { color: var(--err); }
  @keyframes blink { 50% { opacity: .2; } }
</style>
<header><h1>蔵 companion</h1><span class="state" id="state">connecting…</span></header>
<main><div class="empty" id="empty">prompt を打つとここに card が届きます</div><div id="cards"></div></main>
<script>
  const cards = document.getElementById("cards");
  const empty = document.getElementById("empty");
  const state = document.getElementById("state");

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function render(data) {
    empty.style.display = "none";
    const key = data.key || (data.card && data.card.key);
    let article = document.getElementById("k-" + key);
    if (!article) {
      article = el("article");
      article.id = "k-" + key;
      cards.prepend(article);
    }
    article.textContent = "";
    const isPending = data.type === "pending";
    const card = isPending ? data : data.card;
    article.className = isPending ? "pending" : card.status === "error" ? "error" : "";

    const meta = el("div", "meta");
    meta.append(el("span", "badge" + (card.lang === "ja" ? " ja" : ""), card.lang));
    if (card.cwd) meta.append(el("span", "badge", card.cwd.split("/").pop()));
    meta.append(el("span", null, new Date(card.created_at).toLocaleTimeString()));
    article.append(meta);

    article.append(el("div", "input", card.input));
    if (isPending) {
      article.append(el("div", "english", "generating"));
    } else if (card.status === "error") {
      article.append(el("div", "english", "generation failed"));
    } else {
      article.append(el("div", "english", card.english));
      if (card.note) article.append(el("div", "note", card.note));
    }
  }

  const source = new EventSource("/events");
  source.onopen = () => { state.textContent = "live"; };
  source.onerror = () => { state.textContent = "reconnecting…"; };
  source.onmessage = (message) => render(JSON.parse(message.data));
</script>
`;
