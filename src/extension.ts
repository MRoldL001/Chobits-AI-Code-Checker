import * as vscode from 'vscode';
import { AIService, getConfigFromVSCode } from './aiService';
import { getScoreLabel, getScoreColor } from './scoreSystem';

export interface CodeCheckerAPI {
  getCurrentScore: () => number;
  checkCodeQuality: () => Promise<number>;
  getScoreColor: (score: number) => string;
  getScoreLabel: (score: number) => string;
  checkCodeWithText: (code: string, languageId?: string) => Promise<number>;
}

let aiService: AIService | undefined;
let statusBarItem: vscode.StatusBarItem | undefined;
let debounceTimer: NodeJS.Timeout | null = null;
let currentScore: number = -1;
let currentDocumentUri: string | undefined = undefined;

function createStatusBarItem(context: vscode.ExtensionContext): vscode.StatusBarItem {
  if (statusBarItem) {
    statusBarItem.dispose();
  }

  const config = vscode.workspace.getConfiguration('codeChecker');
  const position = config.get<'left' | 'right'>('statusBarPosition', 'right');
  const alignment = position === 'left' ? vscode.StatusBarAlignment.Left : vscode.StatusBarAlignment.Right;

  statusBarItem = vscode.window.createStatusBarItem(alignment, 100);
  statusBarItem.command = 'codeChecker.checkCodeQuality';
  statusBarItem.text = '$(code) 检查代码';
  statusBarItem.tooltip = '检查代码质量';
  statusBarItem.show();

  context.subscriptions.push(statusBarItem);
  return statusBarItem;
}

export function activate(context: vscode.ExtensionContext): CodeCheckerAPI {
  console.log('代码检查器已激活！');

  try {
    const config = getConfigFromVSCode();
    aiService = new AIService(config);

    createStatusBarItem(context);

    const checkCommand = vscode.commands.registerCommand('codeChecker.checkCodeQuality', async () => {
      await checkCodeQuality();
    });

    context.subscriptions.push(checkCommand);

    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('codeChecker.statusBarPosition')) {
        createStatusBarItem(context);
        updateStatusBarItem(currentScore >= 0 ? currentScore : undefined);
      }
    });

    const editor = vscode.window.activeTextEditor;
    if (editor) {
      checkCodeQuality();
    }

    vscode.window.onDidChangeActiveTextEditor(() => {
      checkCodeQuality();
    });

    vscode.workspace.onDidChangeTextDocument(() => {
      debounceCheckCodeQuality();
    });

    context.subscriptions.push(checkCommand);

    if (statusBarItem) {
      context.subscriptions.push(statusBarItem);
    }

  } catch (error) {
    console.error('扩展激活错误:', error);
    vscode.window.showErrorMessage(`代码检查器激活失败: ${error}`);
  }

  return {
    getCurrentScore,
    checkCodeQuality,
    getScoreColor,
    getScoreLabel,
    checkCodeWithText
  };
}

function debounceCheckCodeQuality() {
  const config = vscode.workspace.getConfiguration('codeChecker');
  const autoUpdate = config.get<boolean>('autoUpdate', true);

  if (!autoUpdate || !statusBarItem) {
    return;
  }

  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }

  const debounceMs = config.get<number>('updateDebounceMs', 2000);
  debounceTimer = setTimeout(() => {
    checkCodeQuality();
  }, debounceMs);
}

export async function checkCodeQuality(): Promise<number> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || !statusBarItem) {
    return -1;
  }

  const documentUri = editor.document.uri.toString();

  const config = vscode.workspace.getConfiguration('codeChecker');
  const allowedExtensions = config.get<string[]>('codeFileExtensions', []);

  const fileName = editor.document.fileName;
  const fileExtension = fileName.split('.').pop()?.toLowerCase() || '';

  if (!allowedExtensions.includes(fileExtension)) {
    statusBarItem.text = '$(code) 非代码文件';
    statusBarItem.color = new vscode.ThemeColor('statusBar.foreground');
    currentScore = -1;
    return -1;
  }

  statusBarItem.text = '$(sync~spin) 检查中...';
  statusBarItem.color = new vscode.ThemeColor('statusBar.foreground');

  const code = editor.document.getText();
  const currentUri = editor.document.uri.toString();
  const allProblems = vscode.languages.getDiagnostics();
  const problems = allProblems.filter(([uri]) => uri.toString() === currentUri);

  try {
    if (!aiService) {
      aiService = new AIService(getConfigFromVSCode());
    }

    const score = await aiService.checkCodeQuality(code, problems);

    if (score >= 0 && documentUri === editor.document.uri.toString()) {
      currentScore = score;
      currentDocumentUri = documentUri;
      updateStatusBarItem(score);
    }
    return score;
  } catch (error) {
    console.error('代码质量检查错误:', error);
    if (statusBarItem) {
      statusBarItem.text = '$(error) 检查失败';
      statusBarItem.color = new vscode.ThemeColor('statusBar.foreground');
    }
    return -1;
  }
}

export async function checkCodeWithText(code: string, languageId?: string): Promise<number> {
  try {
    if (!aiService) {
      aiService = new AIService(getConfigFromVSCode());
    }
    const score = await aiService.checkCodeQuality(code, []);
    return score;
  } catch (error) {
    console.error('代码质量检查错误:', error);
    return -1;
  }
}

function updateStatusBarItem(score?: number) {
  if (!statusBarItem) {
    return;
  }

  if (score === undefined || score < 0) {
    statusBarItem.text = '$(code) 检查代码';
    statusBarItem.color = new vscode.ThemeColor('statusBar.foreground');
    return;
  }

  const label = getScoreLabel(score);
  statusBarItem.text = `$(code) ${score} ${label}`;
  statusBarItem.color = getScoreColor(score);
}

export function getCurrentScore(): number {
  return currentScore;
}

export function deactivate() {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }
}
