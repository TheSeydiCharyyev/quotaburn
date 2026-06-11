// VS Code surface for quotaburn: a status bar burn figure that's always on,
// and the full HTML dashboard in a webview. Reuses the CLI's core directly —
// same scan, same numbers, same report.
import * as vscode from 'vscode';
import { claudeProjectsDir } from '../../src/discover.js';
import { renderHtmlReport } from '../../src/report.js';
import { buildReportData, computeCost } from '../../src/reportdata.js';
import { scan } from '../../src/scan.js';

const REFRESH_MINUTES = 15;

let statusBar: vscode.StatusBarItem;
let extensionVersion = '0.0.0';

export function activate(context: vscode.ExtensionContext): void {
  extensionVersion = (context.extension.packageJSON as { version?: string }).version ?? '0.0.0';

  statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBar.command = 'quotaburn.showReport';
  context.subscriptions.push(statusBar);

  context.subscriptions.push(
    vscode.commands.registerCommand('quotaburn.showReport', () => showReport()),
    vscode.commands.registerCommand('quotaburn.refresh', () => refreshStatusBar()),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('quotaburn')) void refreshStatusBar();
    }),
  );

  void refreshStatusBar();
  const timer = setInterval(() => void refreshStatusBar(), REFRESH_MINUTES * 60 * 1000);
  context.subscriptions.push({ dispose: () => clearInterval(timer) });
}

export function deactivate(): void {}

function config(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration('quotaburn');
}

async function refreshStatusBar(): Promise<void> {
  if (!config().get<boolean>('statusBar.enabled', true)) {
    statusBar.hide();
    return;
  }
  const days = Math.max(1, config().get<number>('statusBar.days', 7));
  try {
    const r = await scan(claudeProjectsDir(), { cutoffMs: Date.now() - days * 86_400_000 });
    if (r.files === 0) {
      statusBar.hide();
      return;
    }
    const cost = computeCost(r);
    statusBar.text = `$(flame) $${cost.sum.total.toFixed(2)}`;
    statusBar.tooltip = new vscode.MarkdownString(
      `**quotaburn** — last ${days} day(s) at API list prices.\n\nClick for the full report.`,
    );
    statusBar.show();
  } catch {
    // never let a parsing hiccup break someone's editor chrome
    statusBar.hide();
  }
}

async function showReport(): Promise<void> {
  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'quotaburn: scanning your Claude Code logs…' },
    async () => {
      const root = claudeProjectsDir();
      const r = await scan(root);
      if (r.files === 0) {
        void vscode.window.showWarningMessage(`quotaburn: no Claude Code session logs found under ${root}`);
        return;
      }
      const data = await buildReportData(r, {
        version: extensionVersion,
        scope: 'full history',
        root,
        mb: Math.round(r.bytes / 1024 / 1024),
      });

      const panel = vscode.window.createWebviewPanel('quotaburn', 'quotaburn', vscode.ViewColumn.One, {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [],
      });
      const nonce = randomNonce();
      const kind = vscode.window.activeColorTheme.kind;
      const dark = kind === vscode.ColorThemeKind.Dark || kind === vscode.ColorThemeKind.HighContrast;
      panel.webview.html = renderHtmlReport(data, {
        nonce,
        defaultTheme: dark ? 'dark' : 'light',
        csp: `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';`,
      });
    },
  );
}

function randomNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < 32; i++) s += chars.charAt(Math.floor(Math.random() * chars.length));
  return s;
}
