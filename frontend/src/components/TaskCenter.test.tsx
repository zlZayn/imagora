// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import TaskCenter from "./TaskCenter";

afterEach(cleanup);

describe("TaskCenter", () => {
  it("shows the complete error with a wrapping width bound for failed tasks", () => {
    const error = "Provider rejected the request because the output directory is unavailable";
    render(
      <TaskCenter
        tasks={[{ taskId: "task-1", status: "failed", error }]}
        onCancel={vi.fn()}
        onRetryFailed={vi.fn()}
      />,
    );

    const detail = screen.getByText(error);
    expect(detail.className).toContain("break-words");
    expect(detail.className).toContain("min-w-0");
  });
});
