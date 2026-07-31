export interface HourTarget {
  date: string;
  hour: number;
  windowStart: string;
}

export function previousCompletedHour(now = Date.now()): HourTarget {
  const jst = new Date(now - 3_600_000).toLocaleString("sv-SE", {
    timeZone: "Asia/Tokyo",
  });
  return hourTarget(jst.slice(0, 10), Number.parseInt(jst.slice(11, 13), 10));
}

export function hourTarget(date: string, hour: number): HourTarget {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isInteger(hour) || hour < 0 || hour > 23) {
    throw new Error(`invalid JST hour: ${date} ${hour}`);
  }
  return {
    date,
    hour,
    windowStart: `${date} ${String(hour).padStart(2, "0")}:00:00`,
  };
}

export function resolveHourArgs(args: string[]): HourTarget {
  if (args.length === 0) return previousCompletedHour();
  if (args.length !== 2 || !/^\d{1,2}$/.test(args[1])) {
    throw new Error("expected [<YYYY-MM-DD> <hour 0-23>]");
  }
  return hourTarget(args[0], Number.parseInt(args[1], 10));
}
