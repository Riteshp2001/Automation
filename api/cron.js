const { getBearerToken, isAuthorized, writeJson } = require("../lib/http");
const { runOnce } = require("../lib/automation");
const { loadEnv } = require("../lib/env");

module.exports = async function cronHandler(req, res) {
  if (!["GET", "POST"].includes(req.method)) {
    writeJson(res, 405, { ok: false, error: "Method not allowed." });
    return;
  }

  const env = loadEnv();
  const token = getBearerToken(req);

  if (env.cronSecret && !isAuthorized(token, env.cronSecret)) {
    writeJson(res, 401, { ok: false, error: "Unauthorized cron request." });
    return;
  }

  try {
    const result = await runOnce({
      force: String(req.query.force || "") === "1"
    });

    writeJson(res, 200, result);
  } catch (error) {
    console.error(error);
    writeJson(res, 500, {
      ok: false,
      error: error.message
    });
  }
};
