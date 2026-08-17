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
    idleTimeout: 0, // 既定 (~10s) だと SSE が切られて再接続を繰り返す

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


// tui.ts の log 形式 ([input] / [output] / [note]) を DADS (デジタル庁デザインシステム)
// 準拠で描く page。skills/candidate/dads-artifact.md の 3 層モデルに従う:
//   tokens     — @digital-go-jp/design-tokens (unpkg) から必要変数のみ inline
//   components — dads-chip-label / dads-heading を公式 CSS のクラス名ごと移植
//   逸脱       — CSP のため外部 asset なし (Google Fonts は fallback stack に置換)。
//                ダークテーマは公式に無いので、構造は無改変のまま primitive 変数の
//                値だけ light-dark() で差し替えた「DADS 準拠の拡張」(footer に明示)。
// 新しい entry を一番上に積む (replay は oldest-first で届くので prepend で最新が最上部)。
const PAGE = `<!doctype html>
<html lang="ja">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>kura companion</title>
<style>
  /* === DADS design-tokens (抜粋、dist/tokens.css より)。dark 値は独自拡張 === */
  :root {
    color-scheme: light dark;
    --font-family-sans: "Noto Sans JP", "Hiragino Sans", -apple-system, BlinkMacSystemFont, sans-serif;
    --color-neutral-white: light-dark(#ffffff, #1a1a1a);
    --color-neutral-solid-gray-50: light-dark(#f2f2f2, #262626);
    --color-neutral-solid-gray-100: light-dark(#e6e6e6, #333333);
    --color-neutral-solid-gray-536: light-dark(#767676, #9e9e9e);
    --color-neutral-solid-gray-700: light-dark(#4d4d4d, #a6a6a6);
    --color-neutral-solid-gray-800: light-dark(#333333, #cccccc);
    --color-primitive-blue-50: light-dark(#e8f1fe, #16264d);
    --color-primitive-blue-700: light-dark(#264af4, #7096f8);
    --color-primitive-blue-800: light-dark(#0031d8, #a8bffb);
    --color-primitive-green-50: light-dark(#e6f5ec, #123523);
    --color-primitive-green-800: light-dark(#197a4b, #2cac6e);
    --color-primitive-green-900: light-dark(#115a36, #71c598);
    --color-primitive-red-50: light-dark(#fdeeee, #3d1414);
    --color-primitive-red-900: light-dark(#ce0000, #e06666);
    --color-primitive-red-1000: light-dark(#a90000, #ff9696);
  }
  * { box-sizing: border-box; }
  /* DADS typography: 本文 16px / line-height 1.75 / letter-spacing 0.02em */
  body {
    margin: 0;
    background: var(--color-neutral-white);
    color: var(--color-neutral-solid-gray-800);
    font-family: var(--font-family-sans);
    font-size: 1rem;
    line-height: 1.75;
    letter-spacing: 0.02em;
  }

  /* === dads-heading (公式 heading.css より、使用分のみ) === */
  .dads-heading {
    color: var(--color-neutral-solid-gray-800);
    font-family: var(--font-family-sans);
  }
  .dads-heading[data-size="20"] {
    --_shoulder-size: calc(16 / 16 * 1rem);
    --_shoulder-line-height: 1.7;
    --_shoulder-letter-spacing: 0.02em;
    font-weight: bold;
    font-size: calc(20 / 16 * 1rem);
    line-height: 1.5;
    letter-spacing: 0.02em;
  }
  .dads-heading__heading { margin: 0; font: inherit; }

  /* === dads-chip-label (公式 chip-label.css より、使用分のみ) === */
  .dads-chip-label {
    display: inline-grid;
    grid-template-columns: auto auto;
    align-items: baseline;
    align-content: center;
    box-sizing: border-box;
    min-height: calc(32 / 16 * 1rem);
    border-radius: calc(8 / 16 * 1rem);
    padding: calc(3 / 16 * 1rem) calc(7 / 16 * 1rem);
    font-weight: normal;
    font-size: calc(16 / 16 * 1rem);
    line-height: 1;
    font-family: var(--font-family-sans);
    letter-spacing: 0.02em;
    overflow-wrap: anywhere;
  }
  .dads-chip-label[data-style="filled-1"] {
    border: 1px solid var(--_non-text, #000);
    background-color: var(--_bg, #eee);
    color: var(--_text-dark, #000);
  }
  .dads-chip-label[data-color="gray"] {
    --_non-text: var(--color-neutral-solid-gray-700);
    --_bg: var(--color-neutral-solid-gray-50);
    --_text-dark: var(--color-neutral-solid-gray-800);
  }
  .dads-chip-label[data-color="blue"] {
    --_non-text: var(--color-primitive-blue-700);
    --_bg: var(--color-primitive-blue-50);
    --_text-dark: var(--color-primitive-blue-800);
  }
  .dads-chip-label[data-color="green"] {
    --_non-text: var(--color-primitive-green-800);
    --_bg: var(--color-primitive-green-50);
    --_text-dark: var(--color-primitive-green-900);
  }
  .dads-chip-label[data-color="red"] {
    --_non-text: var(--color-primitive-red-900);
    --_bg: var(--color-primitive-red-50);
    --_text-dark: var(--color-primitive-red-1000);
  }

  /* === page 固有 (log の構造) === */
  header {
    position: sticky; top: 0;
    background: var(--color-neutral-white);
    border-bottom: 1px solid var(--color-neutral-solid-gray-100);
    padding: 12px 24px;
  }
  main { max-width: 44rem; margin: 0 auto; padding: 24px 24px 64px; }
  .empty { color: var(--color-neutral-solid-gray-536); padding: 8px 0; }
  article {
    padding: 16px 0;
    border-bottom: 1px solid var(--color-neutral-solid-gray-100);
  }
  .row {
    display: grid;
    grid-template-columns: calc(88 / 16 * 1rem) 1fr;
    gap: 0 12px;
    align-items: start;
  }
  .row + .row { margin-top: 8px; }
  .row .dads-chip-label { justify-self: start; }
  .row .text { padding-top: calc(2 / 16 * 1rem); overflow-wrap: anywhere; }
  .input .text { color: var(--color-neutral-solid-gray-536); }
  .output .text { font-weight: 500; }
  .error .text { color: var(--color-primitive-red-900); }
  .processing .text { color: var(--color-neutral-solid-gray-536); }
  .processing .text::after { content: " …"; animation: blink 1.1s steps(1) infinite; }
  @keyframes blink { 50% { opacity: 0; } }
  @media (prefers-reduced-motion: reduce) { .processing .text::after { animation: none; } }
  footer {
    max-width: 44rem; margin: 0 auto; padding: 0 24px 32px;
    font-size: calc(12 / 16 * 1rem); color: var(--color-neutral-solid-gray-536);
  }
</style>
<header>
  <div class="dads-heading" data-size="20"><h1 class="dads-heading__heading">kura companion</h1></div>
</header>
<main><div class="empty" id="empty">prompt を打つとここに card が届きます</div><div id="log"></div></main>
<footer>デジタル庁デザインシステム (DADS) の tokens / components (MIT) を使用。ダークテーマ配色は DADS 準拠の独自拡張。</footer>
<script>
  const log = document.getElementById("log");
  const empty = document.getElementById("empty");

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  // tui.ts の oneLine と同じ — 1 field = 1 段落、改行と連続空白は 1 空白に潰す。
  function oneLine(text) {
    return String(text == null ? "" : text).replace(/\\s+/g, " ").trim();
  }

  const CHIP_COLOR = { input: "gray", output: "green", note: "blue", error: "red", processing: "gray" };

  function line(label, kind, text) {
    const row = el("div", "row " + kind);
    const chip = el("span", "dads-chip-label", label);
    chip.setAttribute("data-style", "filled-1");
    chip.setAttribute("data-color", CHIP_COLOR[kind]);
    row.append(chip);
    row.append(el("div", "text", text));
    return row;
  }

  function render(data) {
    empty.hidden = true;
    const key = data.key || (data.card && data.card.key);
    let entry = document.getElementById("k-" + key);
    if (!entry) {
      entry = el("article");
      entry.id = "k-" + key;
      log.prepend(entry);
    }
    entry.textContent = "";

    if (data.type === "pending") {
      entry.append(line("input", "input", oneLine(data.input)));
      entry.append(line("output", "processing", "processing"));
    } else {
      const card = data.card;
      entry.append(line("input", "input", oneLine(card.input)));
      if (card.status === "error") {
        entry.append(line("output", "error", "generation failed"));
      } else {
        entry.append(line("output", "output", oneLine(card.output)));
        let notes = [];
        if (card.note) {
          try {
            const parsed = JSON.parse(card.note);
            notes = Array.isArray(parsed) ? parsed : [card.note];
          } catch {
            notes = [card.note]; // JSON 配列化以前の plain string row
          }
        }
        for (const item of notes) entry.append(line("note", "note", oneLine(item)));
      }
    }
  }

  // EventSource は切れても自動で再接続し、replay は key 単位で冪等に上書きされる。
  const source = new EventSource("/events");
  source.onmessage = (message) => render(JSON.parse(message.data));
</script>
`;
