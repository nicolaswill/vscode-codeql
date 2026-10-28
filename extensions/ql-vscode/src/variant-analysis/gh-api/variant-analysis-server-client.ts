import { extensions } from "vscode";
import { RequestError } from "@octokit/request-error";
import type { VariantAnalysisServerConfig } from "../../config";

/**
 * INTERNAL AND UNSUPPORTED: client for a self-hosted variant analysis server
 * that implements the GitHub variant analysis REST endpoints. See
 * docs/variant-analysis-custom-server.md.
 *
 * The export that the configured token provider extension must implement.
 */
export interface VariantAnalysisServerTokenProvider {
  getVariantAnalysisServerToken(serverUrl: string): Promise<string | undefined>;
}

/** The server does not use controller repositories, so this ID is sent instead. */
export const SERVER_CONTROLLER_REPO_ID = 0;

const MAX_ERROR_BODY_LENGTH = 500;

async function getToken(server: VariantAnalysisServerConfig): Promise<string> {
  const extensionId = server.tokenProviderExtensionId;
  if (!extensionId) {
    throw new Error(
      "No token provider is configured for the variant analysis server. Set codeQL.variantAnalysis.serverTokenProvider in your user settings.",
    );
  }

  const extension =
    extensions.getExtension<Partial<VariantAnalysisServerTokenProvider>>(
      extensionId,
    );
  if (!extension) {
    throw new Error(
      `The variant analysis server token provider extension '${extensionId}' is not installed.`,
    );
  }

  const api = extension.isActive
    ? extension.exports
    : await extension.activate();
  if (typeof api?.getVariantAnalysisServerToken !== "function") {
    throw new Error(
      `The extension '${extensionId}' does not provide a variant analysis server token.`,
    );
  }

  const token = await api.getVariantAnalysisServerToken(server.url);
  if (typeof token !== "string" || !token) {
    throw new Error(
      `The extension '${extensionId}' did not return a variant analysis server token. Check that you are signed in.`,
    );
  }
  return token;
}

/**
 * Sends a request to the variant analysis server. Neither the request body
 * nor the token is logged or included in errors.
 */
export async function requestVariantAnalysisServer<T>(
  server: VariantAnalysisServerConfig,
  method: "GET" | "POST",
  path: string,
  body?: unknown,
  allowEmptyResponse = false,
): Promise<T> {
  const token = await getToken(server);
  const url = `${server.url}${path}`;

  const response = await fetch(url, {
    redirect: "error",
    method,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await response.text();
  let data: unknown = undefined;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch (cause) {
      if (response.ok) {
        throw new Error("Variant analysis server returned invalid JSON.", {
          cause,
        });
      }
      data = text;
    }
  }

  if (!response.ok) {
    throw new RequestError(
      `Variant analysis server request failed: ${method} ${path}: ${response.status} ${response.statusText}${describeErrorBody(data)}`,
      response.status,
      {
        request: { method, url, headers: {} },
        response: {
          status: response.status,
          url,
          headers: {},
          data,
          retryCount: 0,
        },
      },
    );
  }

  if (!text && !allowEmptyResponse) {
    throw new Error("Variant analysis server returned an empty response.");
  }

  return data as T;
}

function describeErrorBody(data: unknown): string {
  const message =
    typeof data === "object" &&
    data !== null &&
    "message" in data &&
    typeof data.message === "string"
      ? data.message
      : typeof data === "string"
        ? data
        : undefined;
  return message ? `: ${message.slice(0, MAX_ERROR_BODY_LENGTH)}` : "";
}
