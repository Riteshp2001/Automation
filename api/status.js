const { getStatus } = require("../lib/automation");
const { loadEnv } = require("../lib/env");
const { getBearerToken, isAuthorized, writeJson } = require("../lib/http");

module.exports = async function statusHandler(req, res) {
  const env = loadEnv();
  const token = getBearerToken(req);

  if (env.adminSecret && !isAuthorized(token, env.adminSecret)) {
    writeJson(res, 401, { ok: false, error: "Unauthorized status request." });
    return;
  }

  try {
    const result = await getStatus();
    writeJson(res, 200, result);
  } catch (error) {
    console.error(error);
    writeJson(res, 500, {
      ok: false,
      error: error.message
    });
  }
};
