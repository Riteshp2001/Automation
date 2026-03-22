const { parseConfig } = require("./config");

function buildDriveListOptions(env, extra = {}) {
  const options = {
    supportsAllDrives: env.supportsAllDrives,
    includeItemsFromAllDrives: env.supportsAllDrives,
    ...extra
  };

  if (env.GOOGLE_DRIVE_SHARED_DRIVE_ID) {
    options.corpora = "drive";
    options.driveId = env.GOOGLE_DRIVE_SHARED_DRIVE_ID;
  }

  return options;
}

async function streamToText(stream) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function fetchConfigFile(drive, env) {
  if (env.GOOGLE_DRIVE_CONFIG_FILE_ID) {
    const response = await drive.files.get(
      buildDriveListOptions(env, {
        fileId: env.GOOGLE_DRIVE_CONFIG_FILE_ID,
        alt: "media"
      }),
      { responseType: "stream" }
    );

    const body = await streamToText(response.data);
    return {
      source: `drive:file:${env.GOOGLE_DRIVE_CONFIG_FILE_ID}`,
      raw: JSON.parse(body)
    };
  }

  const response = await drive.files.list(
    buildDriveListOptions(env, {
      q: [
        `'${env.GOOGLE_DRIVE_SOURCE_FOLDER_ID}' in parents`,
        "trashed = false",
        `name = '${env.GOOGLE_DRIVE_CONFIG_FILE_NAME.replace(/'/g, "\\'")}'`
      ].join(" and "),
      fields: "files(id,name)",
      pageSize: 1
    })
  );

  const file = response.data.files && response.data.files[0];
  if (!file) {
    return {
      source: "env-defaults",
      raw: {}
    };
  }

  const fileResponse = await drive.files.get(
    buildDriveListOptions(env, {
      fileId: file.id,
      alt: "media"
    }),
    { responseType: "stream" }
  );

  const body = await streamToText(fileResponse.data);
  return {
    source: `drive:file:${file.id}`,
    raw: JSON.parse(body)
  };
}

async function findChildFileByName(drive, env, fileName) {
  return findChildFileByNameInFolder(drive, env, env.GOOGLE_DRIVE_SOURCE_FOLDER_ID, fileName);
}

async function findChildFileByNameInFolder(drive, env, folderId, fileName) {
  const response = await drive.files.list(
    buildDriveListOptions(env, {
      q: [
        `'${folderId}' in parents`,
        "trashed = false",
        `name = '${String(fileName).replace(/'/g, "\\'")}'`
      ].join(" and "),
      fields: "files(id,name,mimeType)",
      pageSize: 1
    })
  );

  return response.data.files && response.data.files[0] ? response.data.files[0] : null;
}

async function readJsonFile(drive, env, fileId) {
  const response = await drive.files.get(
    buildDriveListOptions(env, {
      fileId,
      alt: "media"
    }),
    { responseType: "stream" }
  );

  const body = await streamToText(response.data);
  return JSON.parse(body);
}

async function loadChannelConfig(drive, env) {
  const loaded = await fetchConfigFile(drive, env);
  return {
    source: loaded.source,
    config: parseConfig(loaded.raw, env)
  };
}

function resolveStateFolderId(env, config) {
  return config.queue.stateFolderId || env.GOOGLE_DRIVE_STATE_FOLDER_ID || env.GOOGLE_DRIVE_SOURCE_FOLDER_ID;
}

async function loadPostingState(drive, env, config) {
  const stateFileName = config.queue.stateFileName || ".car-reels-state.json";
  const stateFolderId = resolveStateFolderId(env, config);
  const file = await findChildFileByNameInFolder(drive, env, stateFolderId, stateFileName);

  if (!file) {
    return {
      fileId: null,
      folderId: stateFolderId,
      state: {
        postedFileIds: [],
        history: []
      }
    };
  }

  const rawState = await readJsonFile(drive, env, file.id);
  return {
    fileId: file.id,
    folderId: stateFolderId,
    state: {
      postedFileIds: Array.isArray(rawState.postedFileIds)
        ? [...new Set(rawState.postedFileIds.map((value) => String(value)))]
        : [],
      history: Array.isArray(rawState.history) ? rawState.history : []
    }
  };
}

async function savePostingState(drive, env, config, stateFileId, state) {
  const body = JSON.stringify(state, null, 2);
  const stateFolderId = resolveStateFolderId(env, config);

  if (stateFileId) {
    const response = await drive.files.update(
      buildDriveListOptions(env, {
        fileId: stateFileId,
        media: {
          mimeType: "application/json",
          body
        },
        fields: "id"
      })
    );

    return response.data.id;
  }

  const created = await drive.files.create(
    buildDriveListOptions(env, {
      requestBody: {
        name: config.queue.stateFileName || ".car-reels-state.json",
        parents: [stateFolderId]
      },
      media: {
        mimeType: "application/json",
        body
      },
      fields: "id"
    })
  );

  return created.data.id;
}

async function markFileAsPosted(drive, env, config, postingState, file, publishResult) {
  const nextState = {
    postedFileIds: [...new Set([...postingState.state.postedFileIds, String(file.id)])],
    history: [
      ...(postingState.state.history || []),
      {
        fileId: String(file.id),
        uploadFileId: String(file.uploadFileId || file.id),
        name: file.name,
        postedAt: new Date().toISOString(),
        instagramMediaId: publishResult && publishResult.id ? String(publishResult.id) : undefined
      }
    ]
  };

  const nextFileId = await savePostingState(
    drive,
    env,
    config,
    postingState.fileId,
    nextState
  );

  return {
    fileId: nextFileId,
    folderId: postingState.folderId,
    state: nextState
  };
}

async function ensureFolder(drive, env, folderName, parentId) {
  const listResponse = await drive.files.list(
    buildDriveListOptions(env, {
      q: [
        `'${parentId}' in parents`,
        "trashed = false",
        "mimeType = 'application/vnd.google-apps.folder'",
        `name = '${folderName.replace(/'/g, "\\'")}'`
      ].join(" and "),
      fields: "files(id,name)",
      pageSize: 1
    })
  );

  if (listResponse.data.files && listResponse.data.files[0]) {
    return listResponse.data.files[0].id;
  }

  const created = await drive.files.create(
    buildDriveListOptions(env, {
      requestBody: {
        name: folderName,
        mimeType: "application/vnd.google-apps.folder",
        parents: [parentId]
      },
      fields: "id,name"
    })
  );

  return created.data.id;
}

async function resolveWorkflowFolders(drive, env, config) {
  const archiveFolderId =
    config.queue.archiveFolderId || (await ensureFolder(drive, env, "_posted", env.GOOGLE_DRIVE_SOURCE_FOLDER_ID));
  const processingFolderId =
    config.queue.processingFolderId || (await ensureFolder(drive, env, "_processing", env.GOOGLE_DRIVE_SOURCE_FOLDER_ID));

  return {
    sourceFolderId: env.GOOGLE_DRIVE_SOURCE_FOLDER_ID,
    archiveFolderId,
    processingFolderId
  };
}

function extensionOf(fileName) {
  const match = String(fileName || "").toLowerCase().match(/\.([^.]+)$/);
  return match ? match[1] : "";
}

function applyFilters(files, config) {
  const allowSet = new Set(config.queue.allowedExtensions.map((value) => String(value).toLowerCase()));
  const minBytes = config.queue.minSizeMb * 1024 * 1024;

  return files.filter((file) => {
    const name = String(file.name || "");
    const lowerName = name.toLowerCase();

    if (!allowSet.has(extensionOf(name))) {
      return false;
    }

    if (Number(file.size || 0) < minBytes) {
      return false;
    }

    if (config.filters.nameMustContain.length) {
      const matchesRequired = config.filters.nameMustContain.every((needle) =>
        lowerName.includes(String(needle).toLowerCase())
      );
      if (!matchesRequired) {
        return false;
      }
    }

    if (config.filters.nameMustNotContain.some((needle) => lowerName.includes(String(needle).toLowerCase()))) {
      return false;
    }

    return true;
  });
}

function sortFiles(files, order) {
  const items = [...files];

  if (order === "newest-first") {
    items.sort((left, right) => new Date(right.createdTime) - new Date(left.createdTime));
    return items;
  }

  if (order === "alphabetical") {
    items.sort((left, right) => String(left.name).localeCompare(String(right.name)));
    return items;
  }

  items.sort((left, right) => new Date(left.createdTime) - new Date(right.createdTime));
  return items;
}

async function listQueuedVideos(drive, env, config) {
  const response = await drive.files.list(
    buildDriveListOptions(env, {
      q: [
        `'${env.GOOGLE_DRIVE_SOURCE_FOLDER_ID}' in parents`,
        "trashed = false"
      ].join(" and "),
      fields: "files(id,name,mimeType,size,createdTime,modifiedTime,parents,shortcutDetails(targetId,targetMimeType))",
      pageSize: 100
    })
  );

  const rawFiles = response.data.files || [];
  const resolvedFiles = await Promise.all(
    rawFiles.map(async (file) => {
      if (file.mimeType !== "application/vnd.google-apps.shortcut" || !file.shortcutDetails || !file.shortcutDetails.targetId) {
        return {
          ...file,
          uploadFileId: file.id,
          resolvedMimeType: file.mimeType,
          queueItemType: "file"
        };
      }

      const target = await drive.files.get(
        buildDriveListOptions(env, {
          fileId: file.shortcutDetails.targetId,
          fields: "id,name,mimeType,size,createdTime,modifiedTime"
        })
      );

      return {
        ...file,
        uploadFileId: target.data.id,
        resolvedMimeType: target.data.mimeType || file.shortcutDetails.targetMimeType,
        resolvedSize: target.data.size,
        resolvedName: target.data.name,
        queueItemType: "shortcut"
      };
    })
  );

  const normalizedFiles = resolvedFiles.map((file) => ({
    ...file,
    mimeType: file.resolvedMimeType || file.mimeType,
    size: file.resolvedSize || file.size,
    name: file.name || file.resolvedName || "",
    targetName: file.resolvedName || file.name || ""
  }));

  return sortFiles(applyFilters(normalizedFiles, config), config.queue.order);
}

async function getDriveAccessToken(auth) {
  const token = await auth.getAccessToken();
  return typeof token === "string" ? token : token && token.token;
}

async function createDriveDownloadStream(auth, fileId, startByte = 0) {
  const accessToken = await getDriveAccessToken(auth);
  const response = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(startByte > 0 ? { Range: `bytes=${startByte}-` } : {})
    }
  });

  if (!response.ok || !response.body) {
    const text = await response.text();
    throw new Error(`Failed to stream file ${fileId} from Drive: ${response.status} ${text}`);
  }

  return response.body;
}

function buildPublicDriveDownloadUrl(fileId) {
  return `https://drive.usercontent.google.com/download?id=${encodeURIComponent(fileId)}&export=download&confirm=t`;
}

async function moveFileToFolder(drive, env, fileId, addParent, removeParent) {
  const response = await drive.files.update(
    buildDriveListOptions(env, {
      fileId,
      addParents: addParent,
      removeParents: removeParent,
      fields: "id,name,parents"
    })
  );

  return response.data;
}

module.exports = {
  buildPublicDriveDownloadUrl,
  createDriveDownloadStream,
  listQueuedVideos,
  loadChannelConfig,
  loadPostingState,
  markFileAsPosted,
  moveFileToFolder,
  resolveWorkflowFolders
};
