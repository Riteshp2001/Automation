const cronParser = require("cron-parser");

function parseCronExpression(expression, options) {
  if (typeof cronParser.parseExpression === "function") {
    return cronParser.parseExpression(expression, options);
  }

  if (cronParser.CronExpressionParser && typeof cronParser.CronExpressionParser.parse === "function") {
    return cronParser.CronExpressionParser.parse(expression, options);
  }

  throw new Error("Unsupported cron-parser API version.");
}

function computeScheduleState(expression, timezone, now = new Date()) {
  const normalizedExpression = String(expression || "").trim();
  const normalizedTimezone = String(timezone || "UTC").trim() || "UTC";
  const minuteStart = new Date(now);
  minuteStart.setSeconds(0, 0);

  const previousMinute = new Date(minuteStart.getTime() - 60 * 1000);
  const interval = parseCronExpression(normalizedExpression, {
    currentDate: previousMinute,
    tz: normalizedTimezone
  });

  const next = interval.next();
  const nextDate = typeof next.toDate === "function" ? next.toDate() : new Date(next);
  const isDue = nextDate.getTime() === minuteStart.getTime();

  const futureInterval = parseCronExpression(normalizedExpression, {
    currentDate: minuteStart,
    tz: normalizedTimezone
  });
  const future = futureInterval.next();
  const nextRun = typeof future.toDate === "function" ? future.toDate() : new Date(future);

  return {
    expression: normalizedExpression,
    timezone: normalizedTimezone,
    now: minuteStart.toISOString(),
    isDue,
    nextRun: nextRun.toISOString()
  };
}

module.exports = {
  computeScheduleState
};
