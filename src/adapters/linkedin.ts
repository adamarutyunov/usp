import type { SourceMedia } from "../types.js";
import { fetchWithTimeout, readJsonResponse } from "../util/http.js";
import { resolveSecret } from "../util/secrets.js";
import {
  dryRunResult,
  getReferencedMedia,
  publishResult,
  publishThread,
  requireAccount,
  requireMediaData,
  type PublishContext,
} from "./common.js";

type LinkedInImageInit = {
  value?: {
    uploadUrl?: string;
    image?: string;
  };
};

function getHeaders(accessToken: string, version: string, contentType = "application/json") {
  return {
    authorization: `Bearer ${accessToken}`,
    "content-type": contentType,
    "Linkedin-Version": version,
    "X-Restli-Protocol-Version": "2.0.0",
  };
}

async function uploadImage({
  accessToken,
  version,
  owner,
  item,
}: {
  accessToken: string;
  version: string;
  owner: string;
  item: SourceMedia;
}) {
  const data = requireMediaData(item, "linkedin");

  const init = await fetchWithTimeout("https://api.linkedin.com/rest/images?action=initializeUpload", {
    method: "POST",
    headers: getHeaders(accessToken, version),
    body: JSON.stringify({ initializeUploadRequest: { owner } }),
  });
  const { ok, status, data: initData, text } = await readJsonResponse<LinkedInImageInit>(init);
  if (!ok || !initData?.value?.uploadUrl || !initData.value.image) {
    throw new Error(`LinkedIn image initialize failed (${status}): ${text}`);
  }

  const upload = await fetchWithTimeout(initData.value.uploadUrl, {
    method: "PUT",
    headers: { "content-type": item.mime ?? "application/octet-stream" },
    body: new Uint8Array(data),
  });
  if (!upload.ok) {
    throw new Error(`LinkedIn image upload failed (${upload.status}): ${await upload.text()}`);
  }

  return initData.value.image;
}

export async function publishToLinkedIn(context: PublishContext) {
  if (context.dryRun) {
    return dryRunResult(context);
  }

  const account = requireAccount(
    context.config.accounts?.linkedin?.[context.target.account],
    "linkedin",
    context.target.account
  );
  const accessToken = resolveSecret(account.accessToken, "LinkedIn access token");
  const version = account.version ?? "202602";

  const posts = await publishThread(context.plan.units, async (unit) => {
    const media = getReferencedMedia(context.media, unit.mediaRefs);
    const imageUrns = await Promise.all(
      media.map((item) => uploadImage({ accessToken, version, owner: account.author, item }))
    );

    const body: Record<string, unknown> = {
      author: account.author,
      commentary: unit.text,
      visibility: "PUBLIC",
      distribution: {
        feedDistribution: "MAIN_FEED",
        targetEntities: [],
        thirdPartyDistributionChannels: [],
      },
      lifecycleState: "PUBLISHED",
      isReshareDisabledByAuthor: false,
    };

    if (imageUrns.length === 1) {
      body.content = { media: { id: imageUrns[0] } };
    } else if (imageUrns.length > 1) {
      body.content = { multiImage: { images: imageUrns.map((id) => ({ id })) } };
    }

    const response = await fetchWithTimeout("https://api.linkedin.com/rest/posts", {
      method: "POST",
      headers: getHeaders(accessToken, version),
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error(`LinkedIn post failed (${response.status}): ${await response.text()}`);
    }
    const id = response.headers.get("x-restli-id") ?? undefined;
    return {
      id,
      url: id ? `https://www.linkedin.com/feed/update/${encodeURIComponent(id)}` : undefined,
      text: unit.text,
    };
  });

  return publishResult(context, posts);
}
