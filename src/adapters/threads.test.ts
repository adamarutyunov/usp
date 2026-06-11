import { describe, expect, it, vi } from "vitest";
import type { PublishContext } from "./common.js";
import { publishToThreads } from "./threads.js";

function context(): PublishContext {
  return {
    targetId: "threads-main",
    target: { platform: "threads", account: "main" },
    config: {
      accounts: {
        threads: {
          main: {
            accessToken: "token",
            userId: "me",
          },
        },
      },
    },
    plan: {
      units: [{ text: "First" }, { text: "Second" }],
    },
    media: [],
    dryRun: false,
  };
}

describe("publishToThreads", () => {
  it("creates and publishes a reply chain", async () => {
    const originalFetch = globalThis.fetch;
    const bodies: URLSearchParams[] = [];
    let containers = 0;
    let posts = 0;
    globalThis.fetch = vi.fn(async (url, init) => {
      const target = String(url);
      // Only the POST calls (container create / publish) carry a body we assert on.
      if (init?.body) {
        bodies.push(init.body as URLSearchParams);
      }
      if (target.includes("/threads_publish")) {
        posts += 1;
        return new Response(
          JSON.stringify({ id: `post-${posts}`, permalink: `https://threads.net/@u/post/${posts}` }),
          { status: 200 }
        );
      }
      if (target.includes("/threads")) {
        containers += 1;
        return new Response(JSON.stringify({ id: `container-${containers}` }), { status: 200 });
      }
      // GET poll for container status: always FINISHED.
      if (target.includes("fields=status")) {
        return new Response(JSON.stringify({ status: "FINISHED" }), { status: 200 });
      }
      // GET poll: parent post is retrievable, and permalink lookup.
      return new Response(
        JSON.stringify({ id: "post-1", permalink: "https://threads.net/@u/post/1" }),
        { status: 200 }
      );
    }) as typeof fetch;

    try {
      const result = await publishToThreads(context());

      expect(result.posts.map((post) => post.id)).toEqual(["post-1", "post-2"]);
      expect(bodies[0]?.get("media_type")).toBe("TEXT");
      expect(bodies[0]?.get("text")).toBe("First");
      expect(bodies[2]?.get("reply_to_id")).toBe("post-1");
      expect(bodies[2]?.get("text")).toBe("Second");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
