const fs = require("fs");
const fsPromises = require("fs/promises");
const os = require("os");
const path = require("path");
const { Readable } = require("stream");
const { pipeline } = require("stream/promises");
const { createDriveDownloadStream } = require("./drive");
const { buildMediaProxyUrl } = require("./media-proxy");

function sanitizeFileName(value) {
  return String(value || "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 120);
}

function parseRepository(env) {
  const repository = String(env.githubMediaRepository || "").trim();
  const [owner, repo] = repository.split("/");

  if (!owner || !repo) {
    throw new Error(
      "GITHUB_MEDIA_REPOSITORY or GITHUB_REPOSITORY must be set to owner/repo for GitHub-only uploads."
    );
  }

  return {
    owner,
    repo
  };
}

async function readGitHubResponse(response, fallbackMessage) {
  const raw = await response.text();

  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw);
  } catch (error) {
    if (!response.ok) {
      throw new Error(`${fallbackMessage}: ${raw}`);
    }

    return raw;
  }
}

async function githubRequest(env, pathname, options = {}) {
  if (!env.githubToken) {
    throw new Error("GITHUB_TOKEN is required for GitHub-only public media hosting.");
  }

  const response = await fetch(`https://api.github.com${pathname}`, {
    method: options.method || "GET",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${env.githubToken}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(options.headers || {})
    },
    body: options.body,
    duplex: options.body ? "half" : undefined
  });

  if (!response.ok) {
    const body = await readGitHubResponse(response, "GitHub API request failed");
    const detail = typeof body === "string" ? body : JSON.stringify(body);
    throw new Error(`GitHub API request failed: ${response.status} ${detail}`);
  }

  return readGitHubResponse(response, "GitHub API response parsing failed");
}

async function getRepositoryInfo(env) {
  const { owner, repo } = parseRepository(env);
  return githubRequest(env, `/repos/${owner}/${repo}`);
}

async function ensureRelease(env) {
  const { owner, repo } = parseRepository(env);
  const tag = env.githubMediaReleaseTag;

  try {
    return await githubRequest(env, `/repos/${owner}/${repo}/releases/tags/${encodeURIComponent(tag)}`);
  } catch (error) {
    if (!String(error.message || "").includes("404")) {
      throw error;
    }
  }

  return githubRequest(env, `/repos/${owner}/${repo}/releases`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      tag_name: tag,
      name: env.githubMediaReleaseName,
      draft: false,
      prerelease: false,
      make_latest: "legacy"
    })
  });
}

async function listReleaseAssets(env, releaseId) {
  const { owner, repo } = parseRepository(env);
  return githubRequest(env, `/repos/${owner}/${repo}/releases/${releaseId}/assets?per_page=100`);
}

async function deleteReleaseAsset(env, assetId) {
  const { owner, repo } = parseRepository(env);
  await githubRequest(env, `/repos/${owner}/${repo}/releases/assets/${assetId}`, {
    method: "DELETE"
  });
}

function buildAssetName(env, file) {
  const sourceName = file.targetName || file.name || "video.mp4";
  const extension = path.extname(sourceName) || ".mp4";
  return `${env.githubMediaAssetPrefix}-${String(file.uploadFileId || file.id)}${extension.toLowerCase()}`;
}

async function downloadFileToTemp(auth, file) {
  const tmpDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), "car-reels-"));
  const sourceName = sanitizeFileName(file.targetName || file.name || "video.mp4") || "video.mp4";
  const filePath = path.join(tmpDir, sourceName);
  const body = await createDriveDownloadStream(auth, file.uploadFileId || file.id);
  await pipeline(Readable.fromWeb(body), fs.createWriteStream(filePath));

  return {
    filePath,
    cleanup: async () => {
      await fsPromises.rm(tmpDir, { recursive: true, force: true });
    }
  };
}

async function uploadReleaseAsset(env, release, file, tempFilePath) {
  const assetName = buildAssetName(env, file);
  const existingAssets = await listReleaseAssets(env, release.id);

  for (const asset of existingAssets) {
    if (asset && asset.name === assetName) {
      await deleteReleaseAsset(env, asset.id);
    }
  }

  const uploadUrl = String(release.upload_url || "").replace(/\{.*$/, "");
  const targetUrl = new URL(uploadUrl);
  targetUrl.searchParams.set("name", assetName);

  const stats = await fsPromises.stat(tempFilePath);
  const response = await fetch(targetUrl, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${env.githubToken}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": file.mimeType || "application/octet-stream",
      "Content-Length": String(stats.size)
    },
    body: fs.createReadStream(tempFilePath),
    duplex: "half"
  });

  if (!response.ok) {
    const body = await readGitHubResponse(response, "GitHub release asset upload failed");
    const detail = typeof body === "string" ? body : JSON.stringify(body);
    throw new Error(`GitHub release asset upload failed: ${response.status} ${detail}`);
  }

  return readGitHubResponse(response, "GitHub release asset response parsing failed");
}

async function cleanupAutomationAssets(env, releaseId, keepAssetIds = []) {
  const keep = new Set(keepAssetIds.map((value) => Number(value)));
  const assets = await listReleaseAssets(env, releaseId);

  for (const asset of assets) {
    if (!asset || keep.has(Number(asset.id))) {
      continue;
    }

    if (String(asset.name || "").startsWith(`${env.githubMediaAssetPrefix}-`)) {
      await deleteReleaseAsset(env, asset.id);
    }
  }
}

async function prepareGitHubReleaseMedia(env, auth, file) {
  const repository = await getRepositoryInfo(env);
  if (repository.private) {
    throw new Error(
      `GitHub-only media hosting needs a public repository. ${repository.full_name} is private, so Instagram cannot fetch release assets from it.`
    );
  }

  const release = await ensureRelease(env);
  await cleanupAutomationAssets(env, release.id);

  const temp = await downloadFileToTemp(auth, file);

  try {
    const asset = await uploadReleaseAsset(env, release, file, temp.filePath);

    return {
      provider: "github-release",
      url: asset.browser_download_url,
      cleanup: async () => {
        await deleteReleaseAsset(env, asset.id);
      }
    };
  } finally {
    await temp.cleanup();
  }
}

async function preparePublicMedia(env, auth, file) {
  if (env.publicMediaProvider === "github-release") {
    return prepareGitHubReleaseMedia(env, auth, file);
  }

  return {
    provider: "vercel-proxy",
    url: buildMediaProxyUrl(env, file.uploadFileId || file.id)
  };
}

module.exports = {
  preparePublicMedia
};
