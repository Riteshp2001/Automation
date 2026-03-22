const { Readable } = require("stream");
const { createGoogleClients } = require("../lib/google");
const { createDriveDownloadStream } = require("../lib/drive");
const { loadEnv } = require("../lib/env");
const { verifyMediaProxySignature } = require("../lib/media-proxy");
const { writeJson } = require("../lib/http");

module.exports = async function mediaHandler(req, res) {
  if (req.method !== "GET") {
    writeJson(res, 405, { ok: false, error: "Method not allowed." });
    return;
  }

  const env = loadEnv();
  const fileId = String(req.query.fileId || "");
  const expires = String(req.query.expires || "");
  const sig = String(req.query.sig || "");

  if (!verifyMediaProxySignature(env, fileId, expires, sig)) {
    writeJson(res, 401, { ok: false, error: "Invalid or expired media proxy signature." });
    return;
  }

  try {
    const google = await createGoogleClients(env);
    const metadata = await google.drive.files.get({
      fileId,
      supportsAllDrives: env.supportsAllDrives,
      fields: "id,name,mimeType,size"
    });
    const stream = await createDriveDownloadStream(google.auth, fileId);

    res.statusCode = 200;
    res.setHeader("Content-Type", metadata.data.mimeType || "application/octet-stream");
    res.setHeader("Cache-Control", "private, max-age=300");
    if (metadata.data.size) {
      res.setHeader("Content-Length", String(metadata.data.size));
    }
    if (metadata.data.name) {
      res.setHeader("Content-Disposition", `inline; filename="${String(metadata.data.name).replace(/"/g, "")}"`);
    }

    Readable.fromWeb(stream).pipe(res);
  } catch (error) {
    console.error(error);
    writeJson(res, 500, {
      ok: false,
      error: error.message
    });
  }
};
