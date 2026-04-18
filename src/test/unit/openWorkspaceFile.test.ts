import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Mock } from 'vitest';
import * as vscode from 'vscode';
import { openWorkspaceFile } from '../../core/openWorkspaceFile';
import { resetAllMocks } from '../mocks/vscode';

// `showTextDocument` is not on the shared mock — install it once for this suite.
const showTextDocument = vi.fn();
(vscode.window as unknown as { showTextDocument: Mock }).showTextDocument = showTextDocument;

// The vscode mock has a mutable workspaceFolders, but TS types it as readonly.
const mockWorkspace = vscode.workspace as {
  workspaceFolders: vscode.WorkspaceFolder[] | undefined;
};

function setWorkspaceFolders(paths: string[]): void {
  mockWorkspace.workspaceFolders = paths.map((p) => ({
    uri: { fsPath: p } as vscode.Uri,
    name: p.split('/').pop() ?? p,
    index: 0,
  }));
}

describe('openWorkspaceFile', () => {
  beforeEach(() => {
    resetAllMocks();
    showTextDocument.mockReset();
    mockWorkspace.workspaceFolders = undefined;
  });

  it('does nothing when relativePath is empty', async () => {
    setWorkspaceFolders(['/repo']);
    await openWorkspaceFile(undefined, null);
    await openWorkspaceFile('', null);
    expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
    expect(showTextDocument).not.toHaveBeenCalled();
  });

  it('warns and returns when no workspace folders are open', async () => {
    await openWorkspaceFile('src/file.ts', null);
    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith('No workspace folder is open.');
    expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
  });

  it('opens the file via vscode.open when no fragment is given', async () => {
    setWorkspaceFolders(['/repo']);
    (vscode.workspace.fs.stat as Mock).mockResolvedValueOnce({ type: 1 });

    await openWorkspaceFile('src/file.ts', null);

    expect(vscode.workspace.fs.stat).toHaveBeenCalledWith(
      expect.objectContaining({ fsPath: '/repo/src/file.ts' })
    );
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
      'vscode.open',
      expect.objectContaining({ fsPath: '/repo/src/file.ts' })
    );
    expect(showTextDocument).not.toHaveBeenCalled();
  });

  it('jumps to a single-line range when fragment is L42', async () => {
    setWorkspaceFolders(['/repo']);
    (vscode.workspace.fs.stat as Mock).mockResolvedValueOnce({ type: 1 });

    await openWorkspaceFile('src/file.ts', 'L42');

    expect(showTextDocument).toHaveBeenCalledTimes(1);
    const [uriArg, optionsArg] = showTextDocument.mock.calls[0];
    expect(uriArg).toMatchObject({ fsPath: '/repo/src/file.ts' });
    expect(optionsArg.selection.start).toMatchObject({ line: 41, character: 0 });
    expect(optionsArg.selection.end).toMatchObject({ line: 41, character: 0 });
    expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
  });

  it('jumps to a multi-line range when fragment is L10-L20', async () => {
    setWorkspaceFolders(['/repo']);
    (vscode.workspace.fs.stat as Mock).mockResolvedValueOnce({ type: 1 });

    await openWorkspaceFile('src/file.ts', 'L10-L20');

    const [, optionsArg] = showTextDocument.mock.calls[0];
    expect(optionsArg.selection.start).toMatchObject({ line: 9, character: 0 });
    expect(optionsArg.selection.end).toMatchObject({ line: 19, character: 0 });
  });

  it('falls back to vscode.open when fragment is not a line range', async () => {
    setWorkspaceFolders(['/repo']);
    (vscode.workspace.fs.stat as Mock).mockResolvedValueOnce({ type: 1 });

    await openWorkspaceFile('docs/guide.md', 'section-heading');

    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
      'vscode.open',
      expect.objectContaining({ fsPath: '/repo/docs/guide.md' })
    );
  });

  it('tries each workspace folder until the file is found', async () => {
    setWorkspaceFolders(['/first', '/second']);
    (vscode.workspace.fs.stat as Mock)
      .mockRejectedValueOnce(new Error('ENOENT'))
      .mockResolvedValueOnce({ type: 1 });

    await openWorkspaceFile('src/file.ts', null);

    expect(vscode.workspace.fs.stat).toHaveBeenCalledTimes(2);
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
      'vscode.open',
      expect.objectContaining({ fsPath: '/second/src/file.ts' })
    );
  });

  it('warns when the file is not found in any workspace folder', async () => {
    setWorkspaceFolders(['/first', '/second']);
    (vscode.workspace.fs.stat as Mock)
      .mockRejectedValueOnce(new Error('ENOENT'))
      .mockRejectedValueOnce(new Error('ENOENT'));

    await openWorkspaceFile('missing.ts', null);

    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      'File not found in workspace: missing.ts'
    );
    expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
  });
});
