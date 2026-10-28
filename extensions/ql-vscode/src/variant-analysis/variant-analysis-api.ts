import type { Credentials } from "../common/authentication";
import { getVariantAnalysisServerConfig } from "../config";
import { cancelVariantAnalysis as cancelGitHubVariantAnalysis } from "./gh-api/gh-actions-api-client";
import {
  createGist as createGitHubGist,
  getVariantAnalysis as getGitHubVariantAnalysis,
  getVariantAnalysisRepo as getGitHubVariantAnalysisRepo,
  submitVariantAnalysis as submitGitHubVariantAnalysis,
} from "./gh-api/gh-api-client";
import type {
  VariantAnalysis as ApiVariantAnalysis,
  VariantAnalysisRepoTask as ApiVariantAnalysisRepoTask,
} from "./gh-api/variant-analysis";
import { requestVariantAnalysisServer } from "./gh-api/variant-analysis-server-client";
import { mapVariantAnalysisSubmission } from "./variant-analysis-mapper";
import type {
  VariantAnalysis,
  VariantAnalysisSubmission,
} from "./shared/variant-analysis";

/**
 * Variant analysis API calls. These go to GitHub, unless an internal custom
 * variant analysis server is configured (see config.ts), in which case they
 * go to that server and the GitHub credentials are not used.
 */

function variantAnalysesPath(controllerRepoId: number): string {
  return `/repositories/${controllerRepoId}/code-scanning/codeql/variant-analyses`;
}

export function getServerForVariantAnalysis(serverUrl: string | undefined) {
  const server = getVariantAnalysisServerConfig();
  if (server?.url !== serverUrl) {
    throw new Error(
      "This variant analysis belongs to a different server. Restore the server setting used to submit it before retrying.",
    );
  }
  return server;
}

export async function submitVariantAnalysis(
  credentials: Credentials,
  submission: VariantAnalysisSubmission,
): Promise<ApiVariantAnalysis> {
  const server = getServerForVariantAnalysis(submission.serverUrl);
  if (!server) {
    return submitGitHubVariantAnalysis(credentials, submission);
  }

  return requestVariantAnalysisServer<ApiVariantAnalysis>(
    server,
    "POST",
    variantAnalysesPath(submission.controllerRepoId),
    mapVariantAnalysisSubmission(submission),
  );
}

export async function getVariantAnalysis(
  credentials: Credentials,
  controllerRepoId: number,
  variantAnalysisId: number,
  serverUrl?: string,
): Promise<ApiVariantAnalysis> {
  const server = getServerForVariantAnalysis(serverUrl);
  if (!server) {
    return getGitHubVariantAnalysis(
      credentials,
      controllerRepoId,
      variantAnalysisId,
    );
  }

  return requestVariantAnalysisServer<ApiVariantAnalysis>(
    server,
    "GET",
    `${variantAnalysesPath(controllerRepoId)}/${variantAnalysisId}`,
  );
}

export async function getVariantAnalysisRepo(
  credentials: Credentials,
  controllerRepoId: number,
  variantAnalysisId: number,
  repoId: number,
  serverUrl?: string,
): Promise<ApiVariantAnalysisRepoTask> {
  const server = getServerForVariantAnalysis(serverUrl);
  if (!server) {
    return getGitHubVariantAnalysisRepo(
      credentials,
      controllerRepoId,
      variantAnalysisId,
      repoId,
    );
  }

  return requestVariantAnalysisServer<ApiVariantAnalysisRepoTask>(
    server,
    "GET",
    `${variantAnalysesPath(controllerRepoId)}/${variantAnalysisId}/repositories/${repoId}`,
  );
}

export async function cancelVariantAnalysis(
  credentials: Credentials,
  variantAnalysis: VariantAnalysis,
): Promise<void> {
  const server = getServerForVariantAnalysis(variantAnalysis.serverUrl);
  if (!server) {
    return cancelGitHubVariantAnalysis(credentials, variantAnalysis);
  }

  const {
    actionsWorkflowRunId,
    controllerRepo: { fullName },
  } = variantAnalysis;
  await requestVariantAnalysisServer(
    server,
    "POST",
    `/repos/${fullName}/actions/runs/${actionsWorkflowRunId}/cancel`,
    undefined,
    true,
  );
}

export async function createGist(
  credentials: Credentials,
  description: string,
  files: { [key: string]: { content: string } },
  serverUrl?: string,
): Promise<string | undefined> {
  // Results from a custom server must not be uploaded to GitHub.
  if (serverUrl) {
    throw new Error(
      "Exporting to a gist is not supported when using a custom variant analysis server.",
    );
  }
  return createGitHubGist(credentials, description, files);
}
