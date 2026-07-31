import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dbModule = join(
  import.meta.dir,
  "..",
  "..",
  "src",
  "features",
  "briefing",
  "db.ts",
);

test("briefing の生成物と publish 状態を SQLite に保存する", () => {
  const root = mkdtempSync(join(tmpdir(), "kura-briefing-db-"));
  try {
    const code = `
const db = await import(${JSON.stringify(dbModule)});
const payload = { date: "2026-07-23", repos: [{ repo: "owner/repo" }] };
db.upsertBriefing("2026-07-23", payload, 25, "model-fixture", "high");
const stored = db.getBriefing("2026-07-23");
db.markBriefingPublished("2026-07-23");
const published = db.getBriefing("2026-07-23");
process.stdout.write(JSON.stringify({ stored, published }));
`;
    const result = Bun.spawnSync([process.execPath, "-e", code], {
      env: {
        ...process.env,
        HOME: root,
        XDG_STATE_HOME: root,
      },
    });
    expect(result.exitCode).toBe(0);

    const output = JSON.parse(result.stdout.toString());
    expect(output.stored).toMatchObject({
      date: "2026-07-23",
      trending_count: 25,
      gen_model: "model-fixture",
      gen_effort: "high",
      published_at: null,
    });
    expect(JSON.parse(output.stored.payload)).toEqual({
      date: "2026-07-23",
      repos: [{ repo: "owner/repo" }],
    });
    expect(output.published.published_at).toBeString();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
