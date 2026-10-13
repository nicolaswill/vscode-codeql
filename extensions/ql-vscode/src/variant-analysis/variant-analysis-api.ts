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
  VariantAnalysisSubmissionRequest,
} from "./gh-api/variant-analysis";
import { requestVariantAnalysisServer } from "./gh-api/variant-analysis-server-client";
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

export async function submitVariantAnalysis(
  credentials: Credentials,
  submission: VariantAnalysisSubmission,
): Promise<ApiVariantAnalysis> {
  const server = getVariantAnalysisServerConfig();
  if (!server) {
    return submitGitHubVariantAnalysis(credentials, submission);
  }

  const { actionRepoRef, language, pack, databases, controllerRepoId } =
    submission;
  const data: VariantAnalysisSubmissionRequest = {
    action_repo_ref: actionRepoRef,
    language,
    query_pack: pack,
    repositories: databases.repositories,
    repository_lists: databases.repositoryLists,
    repository_owners: databases.repositoryOwners,
  };
  return requestVariantAnalysisServer<ApiVariantAnalysis>(
    server,
    "POST",
    variantAnalysesPath(controllerRepoId),
    data,
  );
}

export async function getVariantAnalysis(
  credentials: Credentials,
  controllerRepoId: number,
  variantAnalysisId: number,
): Promise<ApiVariantAnalysis> {
  const server = getVariantAnalysisServerConfig();
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
): Promise<ApiVariantAnalysisRepoTask> {
  const server = getVariantAnalysisServerConfig();
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
  const server = getVariantAnalysisServerConfig();
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
  );
}

export async function createGist(
  credentials: Credentials,
  description: string,
  files: { [key: string]: { content: string } },
): Promise<string | undefined> {
  // Results from a custom server must not be uploaded to GitHub.
  if (getVariantAnalysisServerConfig()) {
    throw new Error(
      "Exporting to a gist is not supported when using a custom variant analysis server.",
    );
  }
  return createGitHubGist(credentials, description, files);
}
