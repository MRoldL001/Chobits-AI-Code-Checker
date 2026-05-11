import * as vscode from 'vscode';
import axios from 'axios';

type Diagnostic = [vscode.Uri, vscode.Diagnostic[]];

export interface AIConfig {
  provider: 'local' | 'remote';
  systemPrompt: string;
  local?: {
    model: string;
  };
  remote?: {
    endpoint: string;
    apiKey: string;
    model: string;
  };
}

export class AIService {
  private config: AIConfig;

  constructor(config: AIConfig) {
    this.config = config;
  }

  public updateConfig(config: AIConfig) {
    this.config = config;
  }

  public async checkCodeQuality(code: string, problems: Diagnostic[]): Promise<number> {
    try {
      switch (this.config.provider) {
        case 'remote':
          return await this.callRemoteAPI(code, problems);
        case 'local':
        default:
          return await this.callLocalModel(code, problems);
      }
    } catch (error) {
      console.error('AI service error:', error);
      vscode.window.showErrorMessage(`代码质量检查失败: ${(error as Error).message}`);
      return -1;
    }
  }

  private formatProblems(problems: Diagnostic[]): string {
    const allProblems: string[] = [];

    const spellingKeywords = ['spelling', 'spell', 'typo', 'misspelled', 'typographical', 'spelling error'];

    for (const [uri, diagnostics] of problems) {
      for (const diagnostic of diagnostics) {
        const message = diagnostic.message.toLowerCase();
        if (spellingKeywords.some(keyword => message.includes(keyword))) {
          continue;
        }

        const line = diagnostic.range.start.line + 1;
        const severity = diagnostic.severity === vscode.DiagnosticSeverity.Error ? 'Error' :
                        diagnostic.severity === vscode.DiagnosticSeverity.Warning ? 'Warning' : 'Info';
        const shortMessage = diagnostic.message.replace(/\n/g, ' ').substring(0, 100);
        allProblems.push(`[${severity}] Line ${line}: ${shortMessage}`);
      }
    }

    if (allProblems.length === 0) {
      return 'No significant problems detected.';
    }

    return `VS Code Problems detected (${allProblems.length} issues, spelling ignored):\n${allProblems.slice(0, 20).join('\n')}${allProblems.length > 20 ? '\n...and more' : ''}`;
  }

  private async callRemoteAPI(code: string, problems: Diagnostic[]): Promise<number> {
    if (!this.config.remote?.endpoint) {
      throw new Error('未配置远程API地址');
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };

    if (this.config.remote.apiKey) {
      headers['Authorization'] = `Bearer ${this.config.remote.apiKey}`;
    }

    const problemsInfo = this.formatProblems(problems);

    const response = await axios.post(
      this.config.remote.endpoint,
      {
        model: this.config.remote.model,
        messages: [
          {
            role: 'system',
            content: this.config.systemPrompt
          },
          {
            role: 'user',
            content: `Please evaluate the following code quality:\n\n\`\`\`\n${code}\n\`\`\`\n\n${problemsInfo}`
          }
        ],
        temperature: 0.3
      },
      { headers }
    );

    const content = response.data.choices?.[0]?.message?.content || response.data.content || response.data;
    return this.parseScore(content);
  }

  private async callLocalModel(code: string, problems: Diagnostic[]): Promise<number> {
    const model = this.config.local?.model || 'llama2';
    const problemsInfo = this.formatProblems(problems);

    try {
      const response = await axios.post(
        'http://localhost:11434/api/chat',
        {
          model: model,
          messages: [
            {
              role: 'system',
              content: this.config.systemPrompt
            },
            {
              role: 'user',
              content: `Please evaluate the following code quality:\n\n\`\`\`\n${code}\n\`\`\`\n\n${problemsInfo}`
            }
          ],
          stream: false
        },
        {
          timeout: 30000
        }
      );

      const content = response.data.message?.content;
      return this.parseScore(content);
    } catch (error) {
      throw new Error('本地模型不可用。请检查Ollama是否在 http://localhost:11434 上运行');
    }
  }

  private parseScore(content: string): number {
    if (!content) {
      throw new Error('AI返回了空响应');
    }

    const match = content.match(/\b(\d{1,3})\b/);
    if (match) {
      const score = parseInt(match[1], 10);
      if (score >= 0 && score <= 100) {
        return score;
      }
    }

    throw new Error('无法从AI响应中解析分数');
  }
}

export function getConfigFromVSCode(): AIConfig {
  const config = vscode.workspace.getConfiguration('codeChecker');
  return {
    provider: config.get<'local' | 'remote'>('aiProvider', 'local'),
    systemPrompt: config.get<string>('systemPrompt', ''),
    local: {
      model: config.get<string>('local.model', 'llama2')
    },
    remote: {
      endpoint: config.get<string>('remote.endpoint', ''),
      apiKey: config.get<string>('remote.apiKey', ''),
      model: config.get<string>('remote.model', '')
    }
  };
}
