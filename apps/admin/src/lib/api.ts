import type { ApiError } from "@film-shelf/shared";

export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...options,
      headers: { "Content-Type": "application/json", ...options?.headers },
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new Error("暂时无法连接服务，请确认本地服务已启动后重试。");
  }
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = (data as ApiError | null)?.error?.message;
    throw new Error(message || "请求未能完成，请稍后重试。");
  }
  return data as T;
}

export const errorMessage = (error: unknown) => error instanceof Error ? error.message : "请求未能完成，请重试。";
