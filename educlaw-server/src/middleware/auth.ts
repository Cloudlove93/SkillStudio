import type { NextFunction, Response } from "express";
import { getRequestId } from "../lib/request-context.js";
import type { AuthedRequest } from "../types.js";

export interface GatewayAuthedRequest extends AuthedRequest {
  username?: string;
  email?: string;
}

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const trimmed = item.trim();
      if (trimmed.length > 0) {
        return trimmed;
      }
    }
  }
  return undefined;
}

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const userId = firstHeaderValue(req.headers["x-user-id"]);
  if (!userId) {
    const requestId = getRequestId();
    res
      .status(401)
      .json(
        requestId
          ? { error: "Authentication required", requestId }
          : { error: "Authentication required" },
      );
    return;
  }

  const gatewayReq = req as GatewayAuthedRequest;
  gatewayReq.userId = userId;
  gatewayReq.username = firstHeaderValue(req.headers["x-user-username"]) || userId;
  gatewayReq.email = firstHeaderValue(req.headers["x-user-email"]);
  next();
}
