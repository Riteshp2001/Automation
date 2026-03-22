const { getBearerToken, isAuthorized, readRequestBody, writeJson } = require("../lib/http");
const { getStatus, runOnce } = require("../lib/automation");
const { loadEnv } = require("../lib/env");

module.exports = async function manualHandler(req, res) {
  if (!["GET", "POST"].includes(req.method)) {
    writeJson(res, 405, { ok: false, error: "Method not allowed." });
    return;
  }

  const env = loadEnv();
  const token = getBearerToken(req);

  if (env.adminSecret && !isAuthorized(token, env.adminSecret)) {
    writeJson(res, 401, { ok: false, error: "Unauthorized manual request." });
    return;
  }

  try {
    const body = req.method === "POST" ? await readRequestBody(req) : {};
    const mode = String(req.query.mode || body.mode || "run").toLowerCase();
    const force = String(req.query.force || body.force || "") === "1" || body.force === true;
    const dryRun = String(req.query.dryRun || body.dryRun || "") === "1" || body.dryRun === true;
    const fileId = String(req.query.fileId || body.fileId || "");

    const result =
      mode === "status"
        ? await getStatus()
        : await runOnce({
            force,
            dryRun,
            fileId: fileId || undefined,
            previewOnly: mode === "preview"
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
