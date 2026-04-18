import * as vscode from 'vscode';

interface SluggerInstance {
  slug(value: string, maintainCase?: boolean): string;
  reset(): void;
}
type SluggerModule = {
  default: new () => SluggerInstance;
  slug: (value: string, maintainCase?: boolean) => string;
};
let sluggerModule: SluggerModule | null = null;
async function loadSlugger(): Promise<SluggerModule> {
  if (!sluggerModule) {
    sluggerModule = (await import('github-slugger')) as unknown as SluggerModule;
  }
  return sluggerModule;
}

/**
 * Open a workspace-relative file path in a VS Code editor, honoring an optional
 * fragment: either a `Lstart[-Lend]` line range, or — for markdown files — a
 * GitHub-style heading slug (`#my-heading`). Tries each workspace folder until
 * the file is found.
 */
export async function openWorkspaceFile(
  relativePath: string | undefined,
  fragment: string | null
): Promise<void> {
  if (!relativePath) return;

  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    vscode.window.showWarningMessage('No workspace folder is open.');
    return;
  }

  for (const folder of folders) {
    const uri = vscode.Uri.joinPath(folder.uri, relativePath);
    try {
      await vscode.workspace.fs.stat(uri);
    } catch {
      continue;
    }
    const range = await resolveRange(uri, relativePath, fragment);
    if (range) {
      const editor = await vscode.window.showTextDocument(uri, { selection: range });
      editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
    } else {
      await vscode.commands.executeCommand('vscode.open', uri);
    }
    return;
  }

  vscode.window.showWarningMessage(`File not found in workspace: ${relativePath}`);
}

async function resolveRange(
  uri: vscode.Uri,
  relativePath: string,
  fragment: string | null
): Promise<vscode.Range | undefined> {
  if (!fragment) return undefined;
  const lineRange = parseLineRange(fragment);
  if (lineRange) return lineRange;
  if (/\.(md|markdown)$/i.test(relativePath)) {
    return await findHeadingRange(uri, fragment);
  }
  return undefined;
}

function parseLineRange(fragment: string): vscode.Range | undefined {
  const match = fragment.match(/^L(\d+)(?:-L?(\d+))?$/i);
  if (!match) return undefined;
  const start = Math.max(0, parseInt(match[1], 10) - 1);
  const end = match[2] ? Math.max(start, parseInt(match[2], 10) - 1) : start;
  return new vscode.Range(new vscode.Position(start, 0), new vscode.Position(end, 0));
}

async function findHeadingRange(
  uri: vscode.Uri,
  fragment: string
): Promise<vscode.Range | undefined> {
  let content: string;
  try {
    const bytes = await vscode.workspace.fs.readFile(uri);
    content = new TextDecoder().decode(bytes);
  } catch {
    return undefined;
  }
  const { default: Slugger, slug: slugOnce } = await loadSlugger();
  const target = slugOnce(decodeURIComponent(fragment));
  const lines = content.split(/\r?\n/);
  const slugger = new Slugger();
  let inFence = false;
  let fenceMarker = '';
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = line.match(/^(\s*)(`{3,}|~{3,})/);
    if (fence) {
      if (!inFence) {
        inFence = true;
        fenceMarker = fence[2][0];
      } else if (fence[2][0] === fenceMarker) {
        inFence = false;
      }
      continue;
    }
    if (inFence) continue;
    const heading = line.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/);
    if (!heading) continue;
    if (slugger.slug(heading[1]) === target) {
      return new vscode.Range(new vscode.Position(i, 0), new vscode.Position(i, 0));
    }
  }
  return undefined;
}
