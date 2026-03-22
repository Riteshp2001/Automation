const { sleep } = require("./utils");

async function readJson(response, fallbackMessage) {
  const raw = await response.text();
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`${fallbackMessage}: ${raw}`);
  }
}

function buildFormBody(payload) {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(payload)) {
    if (value !== undefined && value !== null && value !== "") {
      params.set(key, String(value));
    }
  }

  return params;
}

async function createMediaContainer(env, config, caption, options = {}) {
  const payload =
    env.instagramAuthMode === "instagram-login"
      ? {
          media_type: config.instagram.mediaType,
          caption,
          video_url: options.videoUrl
        }
      : {
          media_type: config.instagram.mediaType,
          upload_type: "resumable",
          caption
        };

  if (config.instagram.thumbOffsetMs !== undefined) {
    payload.thumb_offset = config.instagram.thumbOffsetMs;
  }

  if (config.instagram.audioName) {
    payload.audio_name = config.instagram.audioName;
  }

  const response = await fetch(
    `${env.instagramGraphBaseUrl}/${env.META_API_VERSION}/${env.INSTAGRAM_USER_ID}/media`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.instagramAccessToken}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: buildFormBody(payload).toString()
    }
  );

  if (!response.ok) {
    const body = await readJson(response, "Meta container creation failed");
    throw new Error(`Meta container creation failed: ${JSON.stringify(body)}`);
  }

  return readJson(response, "Meta container response parsing failed");
}

async function getContainerStatus(env, containerId) {
  const fields =
    env.instagramAuthMode === "instagram-login"
      ? "id,status,status_code,error_message"
      : "id,status,status_code,video_status";
  const response = await fetch(
    `${env.instagramGraphBaseUrl}/${env.META_API_VERSION}/${containerId}?fields=${fields}`,
    {
      headers: {
        Authorization: `Bearer ${env.instagramAccessToken}`
      }
    }
  );

  if (!response.ok) {
    const body = await readJson(response, "Meta status request failed");
    throw new Error(`Meta status request failed: ${JSON.stringify(body)}`);
  }

  return readJson(response, "Meta status response parsing failed");
}

async function uploadVideo(env, container, fileSize, createStream) {
  if (env.instagramAuthMode === "instagram-login") {
    return {
      success: true,
      skipped: true
    };
  }

  let offset = 0;

  for (let attempt = 1; attempt <= env.maxUploadRetries; attempt += 1) {
    const body = await createStream(offset);
    let response;

    try {
      response = await fetch(container.uri, {
        method: "POST",
        headers: {
          Authorization: `OAuth ${env.instagramAccessToken}`,
          offset: String(offset),
          file_size: String(fileSize)
        },
        body,
        duplex: "half"
      });
    } catch (error) {
      response = null;
    }

    if (response && response.ok) {
      return readJson(response, "Meta upload response parsing failed");
    }

    const status = await getContainerStatus(env, container.id);
    const transferred = Number(status.video_status && status.video_status.uploading_phase && status.video_status.uploading_phase.bytes_transferred) || 0;

    if (transferred >= fileSize) {
      return {
        success: true,
        resumed: attempt > 1
      };
    }

    if (transferred <= offset) {
      if (response) {
        const text = await response.text();
        throw new Error(`Meta upload failed without progress: ${response.status} ${text}`);
      }

      throw new Error("Meta upload failed before any upload progress was recorded.");
    }

    offset = transferred;
  }

  throw new Error("Meta upload exhausted all retries.");
}

async function waitForProcessing(env, containerId) {
  let latestStatus;

  for (let attempt = 1; attempt <= env.statusPollAttempts; attempt += 1) {
    latestStatus = await getContainerStatus(env, containerId);
    const code = latestStatus.status_code;

    if (code === "FINISHED" || code === "PUBLISHED") {
      return latestStatus;
    }

    if (code === "ERROR" || code === "EXPIRED") {
      throw new Error(`Meta container entered terminal state ${code}: ${JSON.stringify(latestStatus)}`);
    }

    await sleep(env.statusPollIntervalMs);
  }

  throw new Error(`Meta container did not finish processing in time: ${JSON.stringify(latestStatus)}`);
}

async function publishContainer(env, containerId) {
  const response = await fetch(
    `${env.instagramGraphBaseUrl}/${env.META_API_VERSION}/${env.INSTAGRAM_USER_ID}/media_publish`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.instagramAccessToken}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: buildFormBody({
        creation_id: containerId
      }).toString()
    }
  );

  if (!response.ok) {
    const body = await readJson(response, "Meta publish failed");
    throw new Error(`Meta publish failed: ${JSON.stringify(body)}`);
  }

  return readJson(response, "Meta publish response parsing failed");
}

module.exports = {
  createMediaContainer,
  publishContainer,
  uploadVideo,
  waitForProcessing
};
