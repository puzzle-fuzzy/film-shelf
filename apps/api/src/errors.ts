import type { ContentfulStatusCode } from "hono/utils/http-status";

export class ApiException extends Error {
  constructor(
    public readonly status: ContentfulStatusCode,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiException";
  }
}
