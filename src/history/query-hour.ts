#!/usr/bin/env bun
// query-hour.ts — JST hour bucket を全 session 横断で読む CLI。

import { resolveHourArgs } from "../lib/clock.ts";
import { getHourWindow } from "./query.ts";

let target;
try {
  target = resolveHourArgs(process.argv.slice(2));
} catch (error) {
  process.stderr.write(`usage: bun query-hour.ts [<YYYY-MM-DD> <hour 0-23>]\n${error}\n`);
  process.exit(1);
}

process.stdout.write(JSON.stringify(getHourWindow(target.date, target.hour)) + "\n");
