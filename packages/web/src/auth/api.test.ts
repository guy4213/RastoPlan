import { describe, expect, it, vi } from "vitest";
import { AuthError, createAuthApi } from "./api.js";
import { MISSING_API_URL_MESSAGE } from "./config.js";

describe("auth API", () => {
  it("registers through the configured server and includes the session cookie", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({ id: "user-1", email: "user@example.com" })
    );
    const api = createAuthApi("https://api.example.com///", fetchMock);

    await expect(
      api.register({ email: "user@example.com", password: "password-123" })
    ).resolves.toEqual({
      id: "user-1",
      email: "user@example.com",
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.example.com/api/auth/register");
    expect(init).toMatchObject({
      method: "POST",
      credentials: "include",
      body: JSON.stringify({ email: "user@example.com", password: "password-123" }),
    });
    expect(new Headers(init?.headers).get("Content-Type")).toBe("application/json");
  });

  it("treats an unauthorized session check as signed out", async () => {
    const api = createAuthApi(
      "https://api.example.com",
      vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 401 }))
    );

    await expect(api.me()).resolves.toBeUndefined();
  });

  it("logs out through the configured server and rejects a failed logout", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(Response.json({ error: "לא ניתן להתנתק" }, { status: 500 }));
    const api = createAuthApi("https://api.example.com", fetchMock);

    await expect(api.logout()).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://api.example.com/api/auth/logout",
      expect.objectContaining({ method: "POST", credentials: "include" })
    );
    await expect(api.logout()).rejects.toThrow("לא ניתן להתנתק");
  });

  it("surfaces the server error from a failed login", async () => {
    const api = createAuthApi(
      "https://api.example.com",
      vi.fn<typeof fetch>().mockResolvedValue(
        Response.json({ error: "אימייל או סיסמה שגויים" }, { status: 401 })
      )
    );

    await expect(api.login("user@example.com", "wrong-password")).rejects.toThrow(
      "אימייל או סיסמה שגויים"
    );
  });

  it("rejects before fetching when the API URL is missing", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const api = createAuthApi("", fetchMock);

    await expect(api.me()).rejects.toEqual(new AuthError(MISSING_API_URL_MESSAGE));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
