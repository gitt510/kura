import { expect, test } from "bun:test";
import { parseTrending } from "./parse-trending.ts";

test("範囲外のnumeric HTML entityを例外にせず保持する", () => {
  const html = `
    <article class="Box-row">
      <a href="/owner/repo/stargazers">123</a>
      <p class="col-9 color-fg-muted">bad &#1114112; and &#55296;</p>
    </article>
  `;

  expect(parseTrending(html)[0]!.description).toBe("bad &#1114112; and &#55296;");
});
