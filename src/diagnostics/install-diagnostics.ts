// Imported first by the entry module so the process start is recorded before
// the background task or the router loads.
import { installDiagnostics } from "./diagnostics";

installDiagnostics();
