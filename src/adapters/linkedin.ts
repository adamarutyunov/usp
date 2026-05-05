import { resolveSecret } from "../util/secrets.js";
import { dryRunResult, getReferencedMedia, type PublishContext } from "./common.js";

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
  item: { data?: Buffer; rawPath: string; resolvedPath: string; mime?: string; isRemote: boolean };
}) {
  if (!item.data) {
    throw new Error(`LinkedIn adapter could not load image: ${item.resolvedPath}`);
  }

  const init = await fetch("https://api.linkedin.com/rest/images?action=initializeUpload", {
    method: "POST",
    headers: getHeaders(accessToken, version),
    body: JSON.stringify({
      initializeUploadRequest: {
        owner,
      },
    }),
  });
  const initData = (await init.json().catch(() => null)) as LinkedInImageInit | null;
  if (!init.ok || !initData?.value?.uploadUrl || !initData.value.image) {
    throw new Error(`LinkedIn image initialize failed (${init.status}): ${JSON.stringify(initData)}`);
  }

  const upload = await fetch(initData.value.uploadUrl, {
    method: "PUT",
    headers: {
      "content-type": item.mime ?? "application/octet-stream",
    },
    body: new Uint8Array(item.data),
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

  const account = context.config.accounts?.linkedin?.[context.target.account];
  if (!account) {
    throw new Error(`Missing LinkedIn account "${context.target.account}".`);
  }
  const accessToken = resolveSecret(
    account.accessToken,
    account.accessTokenEnv,
    "LinkedIn access token",
    "LINKEDIN_ACCESS_TOKEN"
  );
  const version = account.version ?? "202602";
  const posts = [];

  for (const unit of context.plan.units) {
    const media = getReferencedMedia(context.media, unit.mediaRefs);
    const imageUrns = [];
    for (const item of media) {
      imageUrns.push(
        await uploadImage({
          accessToken,
          version,
          owner: account.author,
          item,
        })
      );
    }

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
      body.content = {
        media: {
          id: imageUrns[0],
        },
      };
    } else if (imageUrns.length > 1) {
      body.content = {
        multiImage: {
          images: imageUrns.map((id) => ({ id })),
        },
      };
    }

    const response = await fetch("https://api.linkedin.com/rest/posts", {
      method: "POST",
      headers: getHeaders(accessToken, version),
      body: JSON.stringify(body),
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`LinkedIn post failed (${response.status}): ${text}`);
    }
    const id = response.headers.get("x-restli-id") ?? undefined;
    posts.push({
      id,
      url: id ? `https://www.linkedin.com/feed/update/${encodeURIComponent(id)}` : undefined,
      text: unit.text,
    });
  }

  return {
    target: context.targetId,
    platform: "linkedin" as const,
    account: context.target.account,
    dryRun: false,
    posts,
  };
}
