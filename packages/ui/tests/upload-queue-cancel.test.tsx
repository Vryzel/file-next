import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useUploadQueue } from "../src/use-upload-queue";

class ImmediateXHR {
  status = 200;
  responseText = "";
  upload = { addEventListener() {} };
  private load: (() => void) | null = null;
  addEventListener(type: string, fn: () => void) {
    if (type === "load") this.load = fn;
  }
  open() {}
  setRequestHeader() {}
  send() { this.load?.(); }
  abort() {}
}

afterEach(() => vi.unstubAllGlobals());

async function uploading(settle: Promise<void>) {
  vi.stubGlobal("XMLHttpRequest", ImmediateXHR);
  let entered = false;
  const hook = renderHook(() => useUploadQueue({
    requestUpload: async () => ({ url: "https://upload.test/file" }),
    confirmUpload: () => { entered = true; return settle; },
  }));
  await act(async () => {
    hook.result.current.enqueue([new File(["a"], "a.txt")], null);
  });
  await vi.waitFor(() => expect(entered).toBe(true));
  act(() => hook.result.current.cancel());
  return hook;
}

describe("useUploadQueue cancel during confirm", () => {
  it("announces a confirm that resolves after cancel", async () => {
    let resolve: () => void = () => {};
    const hook = await uploading(new Promise<void>((done) => { resolve = done; }));
    const uploaded = vi.fn();
    window.addEventListener("file-next-uploaded", uploaded);
    expect(hook.result.current.items).toHaveLength(1);
    await act(async () => resolve());
    expect(uploaded).toHaveBeenCalledOnce();
    expect(hook.result.current.items[0]?.status).toBe("success");
    window.removeEventListener("file-next-uploaded", uploaded);
  });

  it("keeps a confirm failure on the row", async () => {
    let reject: (error: Error) => void = () => {};
    const hook = await uploading(new Promise<void>((_, fail) => { reject = fail; }));
    await act(async () => reject(new Error("confirm failed")));
    expect(hook.result.current.items[0]?.status).toBe("error");
    expect(hook.result.current.items[0]?.error).toBe("confirm failed");
  });
});
