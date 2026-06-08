/**
 * Configure Monaco to run fully offline using locally-bundled web workers,
 * rather than @monaco-editor/react's default CDN loader. This keeps the app
 * local-first with no network dependency.
 *
 * We import only the editor core + the SQL language grammar (not the full
 * `monaco-editor` barrel, which bundles every language and balloons startup).
 *
 * Importing this module for its side effects (e.g. in the SQL preview) is
 * enough; it must run before the first <Editor> mounts.
 */
import { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor/esm/vs/editor/editor.api";
import "monaco-editor/esm/vs/basic-languages/sql/sql.contribution";
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";

// SQL needs no language service, so the base editor worker suffices.
self.MonacoEnvironment = {
  getWorker: () => new EditorWorker(),
};

loader.config({ monaco });
