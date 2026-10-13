import { ConfigurationTarget, extensions, workspace } from "vscode";
import type { Extension } from "vscode";
import { RequestError } from "@octokit/request-error";
import { getVariantAnalysisServerConfig } from "../../../../src/config";
import {
  cancelVariantAnalysis,
  createGist,
  getVariantAnalysis,
  getVariantAnalysisRepo,
  submitVariantAnalysis,
} from "../../../../src/variant-analysis/variant-analysis-api";
import { isVariantAnalysisEnabledForGitHubHost } from "../../../../src/variant-analysis/ghec-dr";
import { createMockSubmission } from "../../../factories/variant-analysis/shared/variant-analysis-submission";
import { createMockVariantAnalysis } from "../../../factories/variant-analysis/shared/variant-analysis";
import { mockedObject } from "../../utils/mocking.helpers";
import { testCredentialsWithStub } from "../../../factories/authentication";
import type { VariantAnalysisServerTokenProvider } from "../../../../src/variant-analysis/gh-api/variant-analysis-server-client";

const SERVER_URL = "https://mrva.example.com";
const PROVIDER_ID = "example.token-provider";

async function setSetting(
  name: string,
  value: string,
  target = ConfigurationTarget.Global,
) {
  await workspace
    .getConfiguration("codeQL.variantAnalysis")
    .update(name, value, target);
}

describe("variant analysis custom server", () => {
  let fetchSpy: jest.SpiedFunction<typeof fetch>;
  let getVariantAnalysisServerToken: jest.Mock<
    Promise<string | undefined>,
    [string]
  >;
  let credentials: ReturnType<typeof testCredentialsWithStub>;

  beforeEach(() => {
    credentials = testCredentialsWithStub();
    fetchSpy = jest
      .spyOn(global, "fetch")
      .mockImplementation(
        async () => new Response(JSON.stringify({ id: 123 })),
      );
    getVariantAnalysisServerToken = jest.fn().mockResolvedValue("the-token");
    jest.spyOn(extensions, "getExtension").mockImplementation((id: string) =>
      id === PROVIDER_ID
        ? mockedObject<Extension<VariantAnalysisServerTokenProvider>>({
            isActive: true,
            exports: { getVariantAnalysisServerToken },
          })
        : undefined,
    );
  });

  describe("configuration", () => {
    it("is not configured by default", () => {
      expect(getVariantAnalysisServerConfig()).toBeUndefined();
    });

    it("reads the server URL and token provider from user settings", async () => {
      await setSetting("serverUrl", `${SERVER_URL}/`);
      await setSetting("serverTokenProvider", PROVIDER_ID);

      expect(getVariantAnalysisServerConfig()).toEqual({
        url: SERVER_URL,
        tokenProviderExtensionId: PROVIDER_ID,
      });
      expect(isVariantAnalysisEnabledForGitHubHost()).toBe(true);
    });

    it("ignores workspace settings", async () => {
      await setSetting("serverUrl", SERVER_URL, ConfigurationTarget.Workspace);
      await setSetting(
        "serverUrl",
        SERVER_URL,
        ConfigurationTarget.WorkspaceFolder,
      );

      expect(getVariantAnalysisServerConfig()).toBeUndefined();
    });

    it("ignores a workspace token provider", async () => {
      await setSetting("serverUrl", SERVER_URL);
      await setSetting(
        "serverTokenProvider",
        PROVIDER_ID,
        ConfigurationTarget.Workspace,
      );

      expect(getVariantAnalysisServerConfig()?.tokenProviderExtensionId).toBe(
        undefined,
      );
    });

    it.each(["http://mrva.example.com", "https://user:pw@mrva.example.com"])(
      "rejects %s",
      async (url) => {
        await setSetting("serverUrl", url);
        expect(() => getVariantAnalysisServerConfig()).toThrow();
      },
    );
  });

  describe("when not configured", () => {
    it("does not call the server", async () => {
      await expect(
        submitVariantAnalysis(credentials, createMockSubmission()),
      ).rejects.toThrow("no stub was provided");
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  describe("when configured", () => {
    beforeEach(async () => {
      await setSetting("serverUrl", SERVER_URL);
      await setSetting("serverTokenProvider", PROVIDER_ID);
    });

    it("submits to the server with the provided token", async () => {
      const submission = createMockSubmission();
      submission.controllerRepoId = 0;

      const result = await submitVariantAnalysis(credentials, submission);

      expect(result).toEqual({ id: 123 });
      expect(getVariantAnalysisServerToken).toHaveBeenCalledWith(SERVER_URL);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, init] = fetchSpy.mock.calls[0];
      expect(url).toBe(
        `${SERVER_URL}/repositories/0/code-scanning/codeql/variant-analyses`,
      );
      expect(init?.method).toBe("POST");
      expect(init?.headers).toMatchObject({
        Authorization: "Bearer the-token",
        "Content-Type": "application/json",
      });
      expect(JSON.parse(init?.body as string)).toMatchObject({
        action_repo_ref: submission.actionRepoRef,
        language: submission.language,
        query_pack: submission.pack,
      });
    });

    it("gets a variant analysis and a repo task", async () => {
      await getVariantAnalysis(credentials, 0, 5);
      await getVariantAnalysisRepo(credentials, 0, 5, 7);

      expect(fetchSpy.mock.calls.map(([url]) => url)).toEqual([
        `${SERVER_URL}/repositories/0/code-scanning/codeql/variant-analyses/5`,
        `${SERVER_URL}/repositories/0/code-scanning/codeql/variant-analyses/5/repositories/7`,
      ]);
    });

    it("cancels on the server", async () => {
      const variantAnalysis = createMockVariantAnalysis({});

      await cancelVariantAnalysis(credentials, variantAnalysis);

      expect(fetchSpy).toHaveBeenCalledWith(
        `${SERVER_URL}/repos/${variantAnalysis.controllerRepo.fullName}/actions/runs/${variantAnalysis.actionsWorkflowRunId}/cancel`,
        expect.objectContaining({ method: "POST" }),
      );
    });

    it("does not export to a gist", async () => {
      await expect(createGist(credentials, "", {})).rejects.toThrow(
        /not supported/,
      );
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("fails without a token, without sending a request", async () => {
      getVariantAnalysisServerToken.mockResolvedValue(undefined);

      await expect(getVariantAnalysis(credentials, 0, 5)).rejects.toThrow(
        /did not return a variant analysis server token/,
      );
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("fails if no token provider is configured", async () => {
      await setSetting("serverTokenProvider", "");

      await expect(getVariantAnalysis(credentials, 0, 5)).rejects.toThrow(
        /No token provider/,
      );
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("fails if the token provider is not installed", async () => {
      await setSetting("serverTokenProvider", "other.extension");

      await expect(getVariantAnalysis(credentials, 0, 5)).rejects.toThrow(
        /not installed/,
      );
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("reports server errors with the status and message", async () => {
      fetchSpy.mockResolvedValue(
        new Response(JSON.stringify({ message: "Token expired" }), {
          status: 401,
          statusText: "Unauthorized",
        }),
      );

      const error = await getVariantAnalysis(credentials, 0, 5).catch(
        (e: unknown) => e,
      );

      expect(error).toBeInstanceOf(RequestError);
      expect((error as RequestError).status).toBe(401);
      expect((error as RequestError).message).toContain(
        "401 Unauthorized: Token expired",
      );
      expect((error as RequestError).message).not.toContain("the-token");
    });
  });
});
