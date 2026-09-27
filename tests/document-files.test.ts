import { File } from "expo-file-system";
import { describe, expect, it, vi } from "vitest";

import { createDocument, documentDisplayName, replaceDocument } from "@/src/data/document-files";

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
    const old = new File("content://p/tree/t/document/t%2Fyonder-points.gpx");
    Object.assign(old, { name: "yonder-points.gpx", delete: () => events.push("delete old") });
    const other = new File("content://p/tree/t/document/t%2Fnotes.txt");
    Object.assign(other, { name: "notes.txt", delete: () => events.push("delete other") });
    const written = { uri: "content://p/tree/t/document/t%2Fyonder-points.gpx", write: (data: unknown) => events.push(`write ${String(data)}`), delete: vi.fn() };
    const directory = {
      uri: "content://p/tree/t",
      list: () => [old, other],
      createFile: (name: string) => {
        events.push(`create ${name}`);
        return written;
      },
    };

    const name = replaceDocument(directory as never, "yonder-points.gpx", "application/gpx+xml", "data");

    expect(events).toEqual(["delete old", "create yonder-points.gpx", "write data"]);
    expect(name).toBe("yonder-points.gpx");
  });

  it("overwrites by path in app-accessible folders", () => {
    created.length = 0;
    const name = replaceDocument({ uri: "file:///synthetic/Documents" } as never, "yonder-points.gpx", "application/gpx+xml", "<gpx/>");

    expect(name).toBe("yonder-points.gpx");
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ uri: "file:///synthetic/Documents/yonder-points.gpx", data: "<gpx/>" });
  });
});

describe("createDocument", () => {
  it("creates Android documents through the storage provider and reports the name it chose", () => {
    const write = vi.fn();
    const createFile = vi.fn(() => ({
      uri: "content://com.example.documents/tree/primary%3ABackups/document/primary%3ABackups%2Fyonder-points%20(1).gpx",
      write,
    }));
    const directory = { uri: "content://com.example.documents/tree/primary%3ABackups", createFile };

    const document = createDocument(directory as never, "yonder-points.gpx", "application/gpx+xml");
    document.write("<gpx/>");

    expect(createFile).toHaveBeenCalledWith("yonder-points.gpx", "application/gpx+xml");
    expect(write).toHaveBeenCalledWith("<gpx/>");
    expect(document.name).toBe("yonder-points (1).gpx");
  });

  it("removes a partly written Android document when the write fails", () => {
    const remove = vi.fn();
    const file = {
      uri: "content://com.example.documents/tree/t/document/t%2Fyonder-points.gpx",
      write: () => { throw new Error("provider closed the stream"); },
      delete: remove,
    };
    const document = createDocument({ uri: "content://com.example.documents/tree/t", createFile: () => file } as never,
      "yonder-points.gpx", "application/gpx+xml");

    expect(() => document.write("<gpx/>")).toThrow("provider closed the stream");
    expect(remove).toHaveBeenCalledOnce();
  });
});

describe("documentDisplayName", () => {
  it("decodes the file name from path-like document IDs", () => {
    expect(documentDisplayName("content://p/tree/primary%3AA/document/primary%3AA%2FB%2Fyonder-points.gpx", "yonder-points.gpx"))
      .toBe("yonder-points.gpx");
    expect(documentDisplayName("content://p/document/raw%3Ayonder-points%20(2).gpx", "yonder-points.gpx"))
      .toBe("yonder-points (2).gpx");
  });

  it("falls back to the requested name for opaque document IDs", () => {
    expect(documentDisplayName("content://p/document/msf%3A1234", "yonder-points.gpx")).toBe("yonder-points.gpx");
    expect(documentDisplayName("content://p/document/%E0%A4%A", "yonder-points.gpx")).toBe("yonder-points.gpx");
  });
});
