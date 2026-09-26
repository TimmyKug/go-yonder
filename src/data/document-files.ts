import { type Directory, File } from "expo-file-system";

export type WrittenDocument = {
  /** The name the file ended up with; a provider may pick a unique one. */
  readonly name: string;
  write: (data: Uint8Array | string) => void;
};

function isDocumentProviderFolder(directory: Directory): boolean {
  return directory.uri.startsWith("content://");
}

/**
 * Creates a new file in a folder the user chose. Android folders are Storage
 * Access Framework content:// URIs; a child document can only be created
 * through the provider, which picks a unique name when one already exists
 * instead of overwriting it.
 */
export function createDocument(directory: Directory, name: string, mimeType: string): WrittenDocument {
  if (isDocumentProviderFolder(directory)) {
    const file = directory.createFile(name, mimeType);
    return {
      name: documentDisplayName(file.uri, name),
      write: (data) => {
        try {
          file.write(data);
        } catch (error: unknown) {
          // Never leave an empty or partial document behind.
          try {
            file.delete();
          } catch {
            // The write error is the one worth reporting.
          }
          throw error;
        }
      },
    };
  }
  const file = new File(directory, name);
  file.create({ overwrite: true });
  return { name, write: (data) => file.write(data) };
}

/**
 * Replaces `name` in the folder. Provider documents are never written over in
 * place, because some providers do not truncate them; the old file is deleted
 * and a new one created instead.
 */
export function replaceDocument(
  directory: Directory,
  name: string,
  mimeType: string,
  data: Uint8Array | string,
): string {
  if (isDocumentProviderFolder(directory)) {
    for (const entry of directory.list()) {
      if (entry instanceof File && entry.name === name) entry.delete();
    }
  }
  const document = createDocument(directory, name, mimeType);
  document.write(data);
  return document.name;
}

/** The file name inside an Android document URI such as `.../document/primary%3ADocs%2Fyonder-backup%20(1).db`. */
export function documentDisplayName(uri: string, fallback: string): string {
  const lastSegment = uri.split("/").pop() ?? "";
  let decoded = lastSegment;
  try {
    decoded = decodeURIComponent(lastSegment);
  } catch {
    // Keep the encoded segment; it still names the file.
  }
  // Some providers use opaque IDs such as `msf:1234` instead of a path.
  const name = decoded.split(/[/:]/).pop() ?? "";
  const extension = fallback.slice(fallback.lastIndexOf(".")).toLowerCase();
  return name.toLowerCase().endsWith(extension) ? name : fallback;
}
