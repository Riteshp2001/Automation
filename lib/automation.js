const { loadEnv } = require("./env");
const { createGoogleClients } = require("./google");
const { generateCaption } = require("./caption");
const { computeScheduleState } = require("./schedule");
const {
  createDriveDownloadStream,
  listQueuedVideos,
  loadChannelConfig,
  loadPostingState,
  markFileAsPosted,
  moveFileToFolder,
  resolveWorkflowFolders
} = require("./drive");
const { buildMediaProxyUrl } = require("./media-proxy");
const {
  createMediaContainer,
  publishContainer,
  uploadVideo,
  waitForProcessing
} = require("./instagram");

async function getRuntimeState(options = {}) {
  const env = loadEnv();
  const google = await createGoogleClients(env);
  const loadedConfig = await loadChannelConfig(google.drive, env);
  const postingState = await loadPostingState(google.drive, env, loadedConfig.config);
  const schedule = computeScheduleState(
    loadedConfig.config.schedule.cron,
    loadedConfig.config.schedule.timezone,
    options.now || new Date()
  );
  const allQueuedVideos = await listQueuedVideos(google.drive, env, loadedConfig.config);
  const postedFileIds = new Set(postingState.state.postedFileIds || []);
  const queuedVideos = allQueuedVideos.filter((file) => !postedFileIds.has(String(file.id)));

  return {
    env,
    google,
    schedule,
    configSource: loadedConfig.source,
    config: loadedConfig.config,
    postingState,
    queuedVideos
  };
}

function summarizeFile(file) {
  if (!file) {
    return null;
  }

  return {
    id: file.id,
    uploadFileId: file.uploadFileId || file.id,
    name: file.name,
    mimeType: file.mimeType,
    queueItemType: file.queueItemType || "file",
    sizeBytes: Number(file.size || 0),
    createdTime: file.createdTime,
    modifiedTime: file.modifiedTime
  };
}

async function getStatus(options = {}) {
  const state = await getRuntimeState(options);
  const nextFile = state.queuedVideos[0] || null;
  const captionPreview = nextFile ? await generateCaption(nextFile, state.config, state.env) : null;

  return {
    ok: true,
    configSource: state.configSource,
    schedule: state.schedule,
    uploadsEnabled: state.env.enableUploads,
    dryRun: state.config.dryRun,
    postedHandling: state.config.queue.postedHandling,
    postedCount: state.postingState.state.postedFileIds.length,
    queueLength: state.queuedVideos.length,
    nextFile: summarizeFile(nextFile),
    captionPreview
  };
}

async function runOnce(options = {}) {
  const state = await getRuntimeState(options);
  const effectiveDryRun = Boolean(options.dryRun || state.config.dryRun || !state.env.enableUploads);

  if (!state.config.enabled) {
    return {
      ok: true,
      skipped: true,
      reason: "automation-disabled",
      configSource: state.configSource
    };
  }

  if (!options.force && !state.schedule.isDue) {
    return {
      ok: true,
      skipped: true,
      reason: "schedule-not-due",
      schedule: state.schedule,
      configSource: state.configSource
    };
  }

  const file = options.fileId
    ? state.queuedVideos.find((item) => item.id === options.fileId)
    : state.queuedVideos[0];

  if (!file) {
    return {
      ok: true,
      skipped: true,
      reason: options.fileId ? "requested-file-not-found-in-source-folder" : "no-queued-videos",
      queueLength: state.queuedVideos.length
    };
  }

  if (Number(file.size || 0) > state.env.maxVideoSizeBytes) {
    throw new Error(
      `File ${file.name} exceeds MAX_VIDEO_SIZE_MB. Size=${file.size} bytes limit=${state.env.maxVideoSizeBytes} bytes.`
    );
  }

  const captionPackage = await generateCaption(file, state.config, state.env);
  const isInstagramLogin = state.env.instagramAuthMode === "instagram-login";
  const useStateFileTracking = state.config.queue.postedHandling === "state-file";
  const publicVideoUrl = isInstagramLogin
    ? buildMediaProxyUrl(state.env, file.uploadFileId || file.id)
    : undefined;

  if (effectiveDryRun || options.previewOnly) {
    return {
      ok: true,
      dryRun: true,
      configSource: state.configSource,
      schedule: state.schedule,
      file: summarizeFile(file),
      captionSource: captionPackage.source,
      caption: captionPackage.caption,
      hashtags: captionPackage.hashtags,
      warning: captionPackage.warning,
      uploadMode: isInstagramLogin ? "public-drive-video-url" : "resumable-upload",
      postedHandling: state.config.queue.postedHandling
    };
  }

  let folders = null;

  if (!useStateFileTracking) {
    try {
      folders = await resolveWorkflowFolders(state.google.drive, state.env, state.config);
      await moveFileToFolder(
        state.google.drive,
        state.env,
        file.id,
        folders.processingFolderId,
        folders.sourceFolderId
      );
    } catch (error) {
      throw new Error(
        `Drive write access is required for automation. Share the source folder with the Google service account as Editor. Original error: ${error.message}`
      );
    }
  }

  try {
    const container = await createMediaContainer(state.env, state.config, captionPackage.caption, {
      videoUrl: publicVideoUrl
    });

    if (!isInstagramLogin) {
      await uploadVideo(state.env, container, Number(file.size || 0), (offset) =>
        createDriveDownloadStream(state.google.auth, file.uploadFileId || file.id, offset)
      );
    }

    await waitForProcessing(state.env, container.id);
    const publishResult = await publishContainer(state.env, container.id);

    if (useStateFileTracking) {
      await markFileAsPosted(
        state.google.drive,
        state.env,
        state.config,
        state.postingState,
        file,
        publishResult
      );
    } else {
      await moveFileToFolder(
        state.google.drive,
        state.env,
        file.id,
        folders.archiveFolderId,
        folders.processingFolderId
      );
    }

    return {
      ok: true,
      posted: true,
      configSource: state.configSource,
      schedule: state.schedule,
      postedHandling: state.config.queue.postedHandling,
      file: summarizeFile(file),
      containerId: container.id,
      instagramMediaId: publishResult.id,
      captionSource: captionPackage.source,
      caption: captionPackage.caption,
      hashtags: captionPackage.hashtags,
      warning: captionPackage.warning
    };
  } catch (error) {
    if (!useStateFileTracking && folders) {
      try {
        await moveFileToFolder(
          state.google.drive,
          state.env,
          file.id,
          folders.sourceFolderId,
          folders.processingFolderId
        );
      } catch (moveError) {
        console.error("Failed to move file back to source folder after publish error.", moveError);
      }
    }

    throw error;
  }
}

module.exports = {
  getStatus,
  runOnce
};
