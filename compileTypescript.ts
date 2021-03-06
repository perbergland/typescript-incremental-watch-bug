#!/usr/bin/env ts-node-script

// Code mostly from the typescript-wiki, unmerged PR #225
// https://github.com/microsoft/TypeScript-wiki/blob/ad7afb1b7049be5ac59ba55dce9a647390ee8481/Using-the-Compiler-API.md

// run from root dir, i.e. ./compileTypescript.ts incremental

import * as ts from "typescript";
import readLine from "readline";

const cachePath = "output";

const isBuildInfo = (path: string) => path.includes("buildinfo");

const system: ts.System = {
  ...ts.sys,
  //  write: (s) => console.log(s),
  readFile: (path, encoding) => {
    if (isBuildInfo(path)) {
      console.log(`reading buildinfo from ${path}`);
    }
    return ts.sys.readFile(path, encoding);
  },
  writeFile: (path, data, writeByteOrderMark) => {
    if (!isBuildInfo(path)) {
      // console.log(`skipping writing of ${path} (${data.length} chars)`);
      // return;
    }
    return ts.sys.writeFile(path, data, writeByteOrderMark);
  },
};

function writeDiagnosticMessage(
  diagnostics: ts.Diagnostic,
  customMessage?: string
) {
  const message =
    customMessage ||
    ts.flattenDiagnosticMessageText(diagnostics.messageText, system.newLine);
  switch (diagnostics.category) {
    case ts.DiagnosticCategory.Error:
      return console.error(message);
    case ts.DiagnosticCategory.Warning:
    case ts.DiagnosticCategory.Suggestion:
    case ts.DiagnosticCategory.Message:
      return console.info(message);
  }
}

function reportDiagnostic(diagnostic: ts.Diagnostic) {
  console.error(
    "Error",
    diagnostic.code,
    ":",
    ts.flattenDiagnosticMessageText(
      diagnostic.messageText,
      formatHost.getNewLine()
    )
  );
}

let triggerBug = false;

const myResolvePath = (s: string) => (triggerBug ? s : system.resolvePath(s));

const compilerOptions = (): ts.CompilerOptions => ({
  tsBuildInfoFile: myResolvePath(`${cachePath}/buildfile.tsbuildinfo`),
  incremental: true,
  noEmit: false,
  outDir: myResolvePath(`${cachePath}/out`),
  sourceMap: true,
});

function writeDiagnostics(diagnostics: ReadonlyArray<ts.Diagnostic>) {
  diagnostics.forEach((diagnostic) => {
    if (diagnostic.file) {
      let { line, character } = diagnostic.file.getLineAndCharacterOfPosition(
        diagnostic.start!
      );
      let message = ts.flattenDiagnosticMessageText(
        diagnostic.messageText,
        "\n"
      );
      writeDiagnosticMessage(
        diagnostic,
        `${diagnostic.file.fileName} (${line + 1},${character + 1}): ${message}`
      );
    } else {
      writeDiagnosticMessage(diagnostic);
    }
  });
}

const emitFile: ts.WriteFileCallback = (
  fileName,
  data,
  writeByteOrderMark,
  _,
  sourceFiles
) => {
  console.log(
    `emitting ${fileName} for ${
      sourceFiles?.map((f) => f.fileName).join("+") ?? "??"
    }`
  );
  system.writeFile(fileName, data, writeByteOrderMark);
};

function emitAllAffectedFiles<T extends ts.BuilderProgram>(program: T) {
  console.log("emitAllAffectedFiles invoked");
  const diagnostics = [
    ...program.getConfigFileParsingDiagnostics(),
    ...program.getSyntacticDiagnostics(),
    ...program.getOptionsDiagnostics(),
    ...program.getGlobalDiagnostics(),
    ...program.getSemanticDiagnostics(), // Get the diagnostics before emit to cache them in the buildInfo file.
  ];
  writeDiagnostics(diagnostics);

  /**
   * "emit" without a sourcefile will process all changed files, including the buildinfo file
   */
  const emitResult = program.emit(undefined, emitFile);
  emitResult.emittedFiles?.forEach((emittedFile) =>
    console.log(`Emitted ${emittedFile}`)
  );
  console.log(`Emitting complete`);
  writeDiagnostics(emitResult.diagnostics);
  return emitResult;
}

export const formatHost: ts.FormatDiagnosticsHost = {
  getCanonicalFileName: (path) => path,
  getCurrentDirectory: ts.sys.getCurrentDirectory,
  getNewLine: () => ts.sys.newLine,
};

function watchMain() {
  const configPath = ts.findConfigFile(
    /*searchPath*/ "./",
    system.fileExists,
    "tsconfig.json"
  );
  if (!configPath) {
    throw new Error("Could not find a valid 'tsconfig.json'.");
  }

  const createProgram = ts.createEmitAndSemanticDiagnosticsBuilderProgram;

  // Note that there is another overload for `createWatchCompilerHost` that takes
  // a set of root files.
  const host = ts.createWatchCompilerHost(
    configPath,
    compilerOptions(),
    system,
    createProgram,
    reportDiagnostic,
    reportWatchStatusChanged
  );

  // You can technically override any given hook on the host, though you probably
  // don't need to.
  // Note that we're assuming `origCreateProgram` and `origPostProgramCreate`
  // doesn't use `this` at all.
  const origCreateProgram = host.createProgram;
  host.createProgram = (rootNames, options, host, oldProgram) => {
    console.log("** We're about to create the program! **");
    return origCreateProgram(rootNames, options, host, oldProgram);
  };

  host.afterProgramCreate = emitAllAffectedFiles;

  // `createWatchProgram` creates an initial program, watches files, and updates
  // the program over time.
  return ts.createWatchProgram(host);
}

/**
 * Performs one incremental compilation of the sources
 */
function incrementalMain() {
  const configPath = ts.findConfigFile(
    /*searchPath*/ "./",
    system.fileExists,
    "tsconfig.json"
  );
  if (!configPath) {
    throw new Error("Could not find a valid 'tsconfig.json'.");
  }

  const config = ts.getParsedCommandLineOfConfigFile(
    configPath,
    /*optionsToExtend*/ compilerOptions(),
    /*host*/ {
      ...ts.sys,
      onUnRecoverableConfigFileDiagnostic: (d) => writeDiagnosticMessage(d),
    }
  );
  if (!config) {
    throw new Error("Could not parse 'tsconfig.json'.");
  }

  const host = ts.createIncrementalCompilerHost(config.options, system);
  const program = ts.createIncrementalProgram({
    host,
    rootNames: config.fileNames,
    options: config.options,
    configFileParsingDiagnostics: ts.getConfigFileParsingDiagnostics(config),
    projectReferences: config.projectReferences,
    createProgram: ts.createEmitAndSemanticDiagnosticsBuilderProgram,
  });
  const emitResult = emitAllAffectedFiles(program);
  console.log(
    `Incremental compilation ${emitResult.emitSkipped ? "failed" : "succeeded"}`
  );
}

/**
 * Prints a diagnostic every time the watch status changes.
 * This is mainly for messages like "Starting compilation" or "Compilation completed".
 */
function reportWatchStatusChanged(diagnostic: ts.Diagnostic) {
  console.info(
    `reportWatchStatusChanged: ${ts.formatDiagnostic(diagnostic, formatHost)}`
  );
}
const rl = readLine.createInterface({
  input: process.stdin,
  output: process.stdout,
});

// const variant = (process.argv[2] || "watch").toLowerCase();
// console.log(`Compiling using ${variant} mode`);
const variant: string = "incremental";

console.log(`Typescript ${ts.version}`);
if (process.argv[2]?.toLowerCase() === "triggerbug") {
  triggerBug = true;
  console.log(`Triggering the bug by not resolving paths`);
}

switch (variant) {
  case "watch":
    const watch = watchMain();
    rl.question("Press enter to exit", () => {
      watch.close();
    });
    break;
  case "incremental":
    incrementalMain();
    break;
  default:
    console.error(`Unknown variant ${variant}`);
    process.exit(2);
    break;
}

rl.close();
