#!/usr/bin/env bun
import { describe, expect, test } from "bun:test";

import {
  LinearFailure,
  buildIssueCreateInput,
  buildIssueUpdateInput,
  controlCharacters,
  discoverCredential,
  errorPayload,
  filterForList,
  guardAuthorityLabels,
  labelNames,
  parseCli,
  renderIssueRows,
} from "./linear";

describe("authority labels", () => {
  test("adding Agent labels is refused without the explicit flag", () => {
    expect(() => guardAuthorityLabels(["Agent: Ready"], false)).toThrow(LinearFailure);
    try {
      guardAuthorityLabels(["Agent: Land", "Improvement"], false);
      throw new Error("should have thrown");
    } catch (error) {
      expect((error as LinearFailure).kind).toBe("authority-label");
      expect((error as LinearFailure).message).toContain("Agent: Land");
      expect((error as LinearFailure).message).toContain("--authorize-agent-work");
    }
  });

  test("adding Agent labels is allowed with the explicit flag", () => {
    expect(() => guardAuthorityLabels(["Agent: Review"], true)).not.toThrow();
  });

  test("ordinary labels never need the flag", () => {
    expect(() => guardAuthorityLabels(["Improvement", "Audio / Native"], false)).not.toThrow();
  });
});

describe("list filters", () => {
  test("defaults to open work only", () => {
    expect(filterForList({})).toEqual({ state: { type: { nin: ["completed", "canceled"] } } });
  });

  test("--all drops the state filter", () => {
    expect(filterForList({ all: true })).toEqual({});
  });

  test("an explicit state replaces the open-state filter", () => {
    expect(filterForList({ state: "Backlog" })).toEqual({ state: { name: { eq: "Backlog" } } });
  });

  test("project, label, and assignee compose", () => {
    expect(
      filterForList({ project: "Cantrip", label: "Improvement", assignee: "me" }),
    ).toEqual({
      project: { name: { eq: "Cantrip" } },
      labels: { name: { eq: "Improvement" } },
      assignee: { isMe: { eq: true } },
      state: { type: { nin: ["completed", "canceled"] } },
    });
  });
});

describe("mutation inputs", () => {
  test("create carries only the fields it was given", () => {
    expect(buildIssueCreateInput({ title: "T", teamId: "team" })).toEqual({
      title: "T",
      teamId: "team",
    });
    expect(
      buildIssueCreateInput({
        title: "T",
        teamId: "team",
        description: "body",
        projectId: "project",
        labelIds: ["a"],
        stateId: "s",
        assigneeId: "u",
      }),
    ).toEqual({
      title: "T",
      teamId: "team",
      description: "body",
      projectId: "project",
      labelIds: ["a"],
      stateId: "s",
      assigneeId: "u",
    });
  });

  test("update distinguishes an absent assignee from an explicit unassign", () => {
    expect(buildIssueUpdateInput({ stateId: "s" })).toEqual({ stateId: "s" });
    expect(buildIssueUpdateInput({ assigneeId: null })).toEqual({ assigneeId: null });
    expect(buildIssueUpdateInput({ addedLabelIds: ["a"], removedLabelIds: ["b"] })).toEqual({
      addedLabelIds: ["a"],
      removedLabelIds: ["b"],
    });
  });
});

describe("json contract", () => {
  test("failures are values with a kind", () => {
    expect(errorPayload("authority-label", "nope")).toEqual({
      error: { kind: "authority-label", message: "nope" },
    });
  });
});

describe("credentials", () => {
  const envRun = (value: string) => (_command: string, args: string[]) => ({
    status: args[args.length - 1].endsWith("LINEAR_KEY") ? 0 : 1,
    stdout: value,
  });

  test("environment wins over pass", () => {
    const found = discoverCredential({ LINEAR_API_KEY: "from-env" }, () => {
      throw new Error("pass must not be consulted");
    });
    expect(found).toEqual({ name: "LINEAR_API_KEY", value: "from-env" });
  });

  test("a trailing newline from pass is stripped", () => {
    const found = discoverCredential({}, envRun("lin_api_key\n"));
    expect(found.value).toBe("lin_api_key");
  });

  test("an embedded control character is refused rather than sent", () => {
    expect(() => discoverCredential({}, envRun("lin_api\u0000key"))).toThrow(LinearFailure);
    expect(controlCharacters("clean")).toBe(false);
    expect(controlCharacters("bad\n")).toBe(true);
  });

  test("no credential anywhere is a named failure, not a crash", () => {
    try {
      discoverCredential({}, () => ({ status: 1, stdout: "" }));
      throw new Error("should have thrown");
    } catch (error) {
      expect((error as LinearFailure).kind).toBe("credential");
    }
  });
});

describe("arguments", () => {
  test("help is not an error", () => {
    expect(parseCli([]).command).toBe("help");
    expect(parseCli(["--help"]).command).toBe("help");
  });

  test("an unknown command is a usage failure", () => {
    expect(() => parseCli(["frobnicate"])).toThrow(LinearFailure);
  });

  test("a command that needs an issue refuses without one", () => {
    expect(() => parseCli(["show"])).toThrow(LinearFailure);
    expect(parseCli(["show", "MIS-1"]).positionals).toEqual(["MIS-1"]);
  });

  test("flags that belong to another command are rejected", () => {
    expect(() => parseCli(["ls", "--title", "x"])).toThrow(LinearFailure);
  });

  test("repeatable labels collect in order", () => {
    const cli = parseCli(["create", "--label", "Improvement", "--label", "Spike"]);
    expect(cli.values.label).toEqual(["Improvement", "Spike"]);
  });
});

describe("rendering", () => {
  test("labels read out of the connection shape", () => {
    expect(labelNames({ labels: { nodes: [{ name: "Bug" }, { name: "Spike" }] } })).toEqual([
      "Bug",
      "Spike",
    ]);
    expect(labelNames(undefined)).toEqual([]);
  });

  test("an empty list says so instead of printing nothing", () => {
    expect(renderIssueRows([])).toBe("(no issues)");
  });

  test("rows align identifier, state, and labels", () => {
    const rows = renderIssueRows([
      {
        identifier: "MIS-1",
        title: "first",
        state: { name: "Todo" },
        labels: { nodes: [{ name: "Bug" }] },
      },
      {
        identifier: "MIS-1000",
        title: "second",
        state: { name: "In Progress" },
        labels: { nodes: [{ name: "Improvement" }] },
      },
    ]).split("\n");
    expect(rows[0].startsWith("MIS-1     ")).toBe(true);
    expect(rows[1].startsWith("MIS-1000  ")).toBe(true);
    expect(rows[0]).toContain("first");
    expect(rows[1]).toContain("In Progress");
  });
});
