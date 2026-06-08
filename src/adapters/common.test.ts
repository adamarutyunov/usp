import { describe, expect, it } from "vitest";
import { PartialPublishError, publishThread } from "./common.js";

describe("publishThread", () => {
  it("returns posts for every unit on success", async () => {
    const posts = await publishThread(["a", "b", "c"], async (unit, index) => ({ id: `${index}`, text: unit }));
    expect(posts).toEqual([
      { id: "0", text: "a" },
      { id: "1", text: "b" },
      { id: "2", text: "c" },
    ]);
  });

  it("rethrows the original error when the first unit fails (nothing posted yet)", async () => {
    const failure = new Error("boom");
    await expect(
      publishThread(["a", "b"], async () => {
        throw failure;
      })
    ).rejects.toBe(failure);
  });

  it("throws PartialPublishError carrying already-posted units when a later unit fails", async () => {
    const failure = new Error("network down");
    let calls = 0;
    const promise = publishThread(["a", "b", "c"], async (unit) => {
      calls += 1;
      if (calls === 2) {
        throw failure;
      }
      return { id: `id-${unit}`, text: unit };
    });

    await expect(promise).rejects.toBeInstanceOf(PartialPublishError);
    await promise.catch((error: PartialPublishError) => {
      expect(error.cause).toBe(failure);
      expect(error.posts).toEqual([{ id: "id-a", text: "a" }]);
    });
  });
});
