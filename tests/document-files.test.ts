import { File } from "expo-file-system";
import { describe, expect, it, vi } from "vitest";

import { replaceDocument } from "@/src/data/document-files";

const created = vi.hoisted(() => [] as { uri: string; data?: unknown }[]);

vi.mock("expo-file-system", () => ({
  File: class File {
    uri: string;
    name: string;
    data?: unknown;
    constructor(directory: { uri: string } | string, name?: string) {
      this.uri = typeof directory === "string" ? directory : `${directory.uri}/${name}`;
      this.name = name ?? this.uri.split("/").pop()!;
    }
    create() {
      created.push(this);
    }
    write(data: unknown) {
      this.data = data;
    }
    delete = vi.fn();
  },
}));

describe("replaceDocument", () => {
  it("deletes the previous Android document of that name before creating a new one", () => {
    const events: string[] = [];
    const old = new File("content://p/tree/t/document/t%2Fyonder-backup.db");
    Object.assign(old, { name: "yonder-backup.db", delete: () => events.push("delete old") });
    const other = new File("content://p/tree/t/document/t%2Fnotes.txt");
    Object.assign(other, { name: "notes.txt", delete: () => events.push("delete other") });
    const written = { uri: "content://p/tree/t/document/t%2Fyonder-backup.db", write: (data: unknown) => events.push(`write ${String(data)}`), delete: vi.fn() };
    const directory = {
      uri: "content://p/tree/t",
      list: () => [old, other],
      createFile: (name: string) => {
        events.push(`create ${name}`);
        return written;
      },
    };

    const name = replaceDocument(directory as never, "yonder-backup.db", "application/octet-stream", "data");

    expect(events).toEqual(["delete old", "create yonder-backup.db", "write data"]);
    expect(name).toBe("yonder-backup.db");
  });

  it("overwrites by path in app-accessible folders", () => {
    created.length = 0;
    const name = replaceDocument({ uri: "file:///synthetic/Documents" } as never, "yonder-points.gpx", "application/gpx+xml", "<gpx/>");

    expect(name).toBe("yonder-points.gpx");
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ uri: "file:///synthetic/Documents/yonder-points.gpx", data: "<gpx/>" });
  });
});
