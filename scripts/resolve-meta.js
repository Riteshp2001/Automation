const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");

function extractMultilineJsonEnv(text, key) {
  const marker = `${key}=`;
  const startIndex = text.indexOf(marker);

  if (startIndex === -1) {
    return {
      text,
      value: undefined
    };
  }

  const valueStart = startIndex + marker.length;
  if (text[valueStart] !== "{") {
    return {
      text,
      value: undefined
    };
  }

  let depth = 0;
  let endIndex = valueStart;

  for (; endIndex < text.length; endIndex += 1) {
    const char = text[endIndex];
    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        endIndex += 1;
        break;
      }
    }
  }

  const extractedValue = text.slice(valueStart, endIndex).trim();
  const lineEndIndex = text.indexOf("\n", endIndex);
  const removeUntil = lineEndIndex === -1 ? text.length : lineEndIndex + 1;

  return {
    value: extractedValue,
    text: `${text.slice(0, startIndex)}${text.slice(removeUntil)}`
  };
}

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return {};
  }

  const rawText = fs.readFileSync(filePath, "utf8");
  const extracted = extractMultilineJsonEnv(rawText, "GOOGLE_SERVICE_ACCOUNT_JSON");
  const parsed = dotenv.parse(extracted.text);

  if (extracted.value && parsed.GOOGLE_SERVICE_ACCOUNT_JSON === undefined) {
    parsed.GOOGLE_SERVICE_ACCOUNT_JSON = extracted.value;
  }

  return parsed;
}

function loadProjectEnv() {
  const examplePath = path.join(process.cwd(), ".env.example");
  const envPath = path.join(process.cwd(), ".env");

  return {
    ...parseEnvFile(examplePath),
    ...parseEnvFile(envPath),
    ...process.env
  };
}

function parseCliArgs(argv) {
  const parsed = {};

  for (let index = 0; index < argv.length; index += 1) {
    const entry = argv[index];

    if (!entry.startsWith("--")) {
      continue;
    }

    const withoutPrefix = entry.slice(2);
    const separatorIndex = withoutPrefix.indexOf("=");

    if (separatorIndex >= 0) {
      parsed[withoutPrefix.slice(0, separatorIndex)] = withoutPrefix.slice(separatorIndex + 1);
      continue;
    }

    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      parsed[withoutPrefix] = next;
      index += 1;
      continue;
    }

    parsed[withoutPrefix] = true;
  }

  return parsed;
}

function maskToken(token) {
  if (!token) {
    return "";
  }

  if (token.length <= 12) {
    return `${token.slice(0, 4)}...${token.slice(-2)}`;
  }

  return `${token.slice(0, 8)}...${token.slice(-6)}`;
}

function isNumericId(value) {
  return /^\d+$/.test(String(value || ""));
}

function readErrorMessage(error) {
  if (error && error.payload && error.payload.error && error.payload.error.message) {
    return error.payload.error.message;
  }

  return error.message || "Unknown error";
}

async function graphGetFromHost(baseUrl, version, endpoint, accessToken, params = {}) {
  const url = new URL(`${baseUrl}/${version}${endpoint}`);

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, value);
    }
  }

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });

  const raw = await response.text();
  let payload;

  try {
    payload = JSON.parse(raw);
  } catch (error) {
    payload = {
      raw
    };
  }

  if (!response.ok) {
    const requestError = new Error(`Graph request failed with status ${response.status}.`);
    requestError.status = response.status;
    requestError.payload = payload;
    throw requestError;
  }

  return payload;
}

async function graphGet(version, endpoint, accessToken, params = {}) {
  return graphGetFromHost("https://graph.facebook.com", version, endpoint, accessToken, params);
}

async function probeInstagramLoginToken(version, accessToken, instagramUserId) {
  const profile = await graphGetFromHost("https://graph.instagram.com", version, "/me", accessToken, {
    fields: "id,username,account_type"
  });

  const lookup = instagramUserId
    ? await graphGetFromHost(
        "https://graph.instagram.com",
        version,
        `/${instagramUserId}`,
        accessToken,
        {
          fields: "id,username,account_type"
        }
      )
    : profile;

  return {
    profile,
    lookup
  };
}

function pickTargetPage(pages, env) {
  const targetPageId = String(env.META_TARGET_PAGE_ID || "").trim();
  const targetPageName = String(env.META_TARGET_PAGE_NAME || "").trim().toLowerCase();

  if (targetPageId) {
    return pages.find((page) => page.id === targetPageId) || null;
  }

  if (targetPageName) {
    return (
      pages.find((page) => String(page.name || "").trim().toLowerCase() === targetPageName) || null
    );
  }

  const pagesWithInstagram = pages.filter((page) => page.instagramAccount);

  if (pagesWithInstagram.length === 1) {
    return pagesWithInstagram[0];
  }

  if (pages.length === 1) {
    return pages[0];
  }

  return null;
}

function describeTasks(page) {
  if (!Array.isArray(page.tasks) || page.tasks.length === 0) {
    return "unknown";
  }

  return page.tasks.join(", ");
}

async function resolveFacebookLogin(version, resolverToken, currentInstagramUserId, env) {
  const actor = await graphGet(version, "/me", resolverToken, {
    fields: "id,name"
  });

  console.log(`Token subject: ${actor.name} (${actor.id})`);

  const pageResponse = await graphGet(version, "/me/accounts", resolverToken, {
    fields:
      "id,name,access_token,tasks,instagram_business_account{id,username,name},connected_instagram_account{id,username}"
  });

  const pages = Array.isArray(pageResponse.data)
    ? pageResponse.data.map((page) => ({
        ...page,
        instagramAccount: page.instagram_business_account || page.connected_instagram_account || null
      }))
    : [];

  console.log("");
  console.log(`Accessible Pages: ${pages.length}`);

  if (!pages.length) {
    console.log("No Pages were returned for this token.");
    console.log(
      "This usually means the token is a user token without page permissions, or the logged-in Facebook user does not manage the Page linked to Instagram."
    );
    process.exitCode = 1;
    return;
  }

  for (const page of pages) {
    const instagramPart = page.instagramAccount
      ? `connected Instagram @${page.instagramAccount.username || "unknown"} (${page.instagramAccount.id})`
      : "no connected professional Instagram account detected";
    console.log(`- ${page.name} (${page.id}) | tasks: ${describeTasks(page)} | ${instagramPart}`);
  }

  const selectedPage = pickTargetPage(pages, env);

  if (!selectedPage) {
    console.log("");
    console.log("I found multiple possible Pages and could not safely choose one.");
    console.log("Set META_TARGET_PAGE_NAME or META_TARGET_PAGE_ID in .env, then run this again.");
    process.exitCode = 1;
    return;
  }

  if (!selectedPage.instagramAccount) {
    console.log("");
    console.log(`Selected Page: ${selectedPage.name} (${selectedPage.id})`);
    console.log("That Page does not expose a connected professional Instagram account yet.");
    console.log("Reconnect the Instagram professional account to this Facebook Page inside Meta Business settings.");
    process.exitCode = 1;
    return;
  }

  let verifiedInstagramAccount = selectedPage.instagramAccount;

  try {
    const pageDetails = await graphGet(version, `/${selectedPage.id}`, selectedPage.access_token, {
      fields:
        "id,name,instagram_business_account{id,username,name},connected_instagram_account{id,username}"
    });

    verifiedInstagramAccount =
      pageDetails.instagram_business_account ||
      pageDetails.connected_instagram_account ||
      selectedPage.instagramAccount;
  } catch (error) {
    console.log("");
    console.log("Page token verification was skipped because the follow-up check failed.");
    console.log(readErrorMessage(error));
  }

  console.log("");
  console.log("Resolved publish target");
  console.log(`- Facebook Page: ${selectedPage.name} (${selectedPage.id})`);
  console.log(
    `- Instagram account: @${verifiedInstagramAccount.username || "unknown"} (${verifiedInstagramAccount.id})`
  );

  if (currentInstagramUserId && currentInstagramUserId !== verifiedInstagramAccount.id) {
    console.log(`- Current INSTAGRAM_USER_ID differs from resolved value: ${currentInstagramUserId}`);
  }

  console.log("");
  console.log("Paste these into .env or Vercel:");
  console.log("INSTAGRAM_AUTH_MODE=facebook-login");
  console.log(`INSTAGRAM_PAGE_ACCESS_TOKEN=${selectedPage.access_token}`);
  console.log(`INSTAGRAM_USER_ID=${verifiedInstagramAccount.id}`);

  const hasCreateContentTask =
    !Array.isArray(selectedPage.tasks) ||
    selectedPage.tasks.includes("CREATE_CONTENT") ||
    selectedPage.tasks.includes("MANAGE");

  if (!hasCreateContentTask) {
    console.log("");
    console.log("Warning: the selected Page token does not report CREATE_CONTENT or MANAGE in its tasks.");
    console.log("Publishing may still fail until the logged-in Facebook user has Page publishing permissions.");
  }
}

async function main() {
  const env = loadProjectEnv();
  const cliArgs = parseCliArgs(process.argv.slice(2));
  const version = env.META_API_VERSION || "v25.0";
  const currentInstagramUserId = env.INSTAGRAM_USER_ID || "";
  const resolverToken =
    cliArgs.token ||
    env.META_USER_ACCESS_TOKEN ||
    env.META_ACCESS_TOKEN ||
    env.INSTAGRAM_PAGE_ACCESS_TOKEN ||
    "";
  const targetPageName = cliArgs["page-name"] || env.META_TARGET_PAGE_NAME || "";
  const targetPageId = cliArgs["page-id"] || env.META_TARGET_PAGE_ID || "";
  const resolverTokenSource = cliArgs.token
    ? "cli --token"
    : env.META_USER_ACCESS_TOKEN
      ? "META_USER_ACCESS_TOKEN"
      : env.META_ACCESS_TOKEN
        ? "META_ACCESS_TOKEN"
        : "INSTAGRAM_PAGE_ACCESS_TOKEN";

  console.log("Meta resolver");
  console.log(`Graph API version: ${version}`);

  if (currentInstagramUserId) {
    if (isNumericId(currentInstagramUserId)) {
      console.log(`Current INSTAGRAM_USER_ID looks numeric: ${currentInstagramUserId}`);
    } else {
      console.log(`Current INSTAGRAM_USER_ID does not look numeric: ${currentInstagramUserId}`);
    }
  } else {
    console.log("Current INSTAGRAM_USER_ID is empty.");
  }

  if (!resolverToken) {
    console.log("");
    console.log("No resolver token found.");
    console.log("Set META_USER_ACCESS_TOKEN after you log in through Meta Graph API Explorer or Instagram Login.");
    process.exitCode = 1;
    return;
  }

  console.log(`Resolver token source: ${resolverTokenSource}`);
  console.log(`Resolver token preview: ${maskToken(resolverToken)}`);

  if (targetPageName) {
    console.log(`Target Page name hint: ${targetPageName}`);
  }

  if (targetPageId) {
    console.log(`Target Page ID hint: ${targetPageId}`);
  }

  try {
    await resolveFacebookLogin(version, resolverToken, currentInstagramUserId, {
      META_TARGET_PAGE_ID: targetPageId,
      META_TARGET_PAGE_NAME: targetPageName
    });
    process.exitCode = 0;
    return;
  } catch (facebookError) {
    try {
      const instagramProbe = await probeInstagramLoginToken(
        version,
        resolverToken,
        currentInstagramUserId
      );

      console.log("");
      console.log("This token is valid for Instagram Login.");
      console.log(
        `Instagram account: @${instagramProbe.profile.username || "unknown"} (${instagramProbe.profile.id})`
      );
      console.log(`Account type: ${instagramProbe.profile.account_type || "unknown"}`);

      if (currentInstagramUserId && currentInstagramUserId !== instagramProbe.lookup.id) {
        console.log(
          `Current INSTAGRAM_USER_ID is accepted, but the canonical profile ID is ${instagramProbe.lookup.id}.`
        );
      }

      console.log("");
      console.log("Use these settings for this app:");
      console.log("INSTAGRAM_AUTH_MODE=instagram-login");
      console.log(`INSTAGRAM_USER_ID=${instagramProbe.lookup.id}`);
      console.log("META_USER_ACCESS_TOKEN=<keep your generated Instagram token here>");
      console.log("");
      console.log(
        "No Facebook Page token is required in this mode. The app will publish through graph.instagram.com."
      );
      process.exitCode = 0;
      return;
    } catch (instagramError) {
      console.log("");
      console.log("Facebook Login resolution failed:");
      console.log(readErrorMessage(facebookError));
      console.log("");
      console.log("Instagram Login resolution also failed:");
      console.log(readErrorMessage(instagramError));
      process.exitCode = 1;
    }
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
