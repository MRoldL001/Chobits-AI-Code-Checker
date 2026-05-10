"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AIService = void 0;
exports.getConfigFromVSCode = getConfigFromVSCode;
const vscode = require("vscode");
const axios_1 = require("axios");
class AIService {
    constructor(config) {
        this.config = config;
    }
    updateConfig(config) {
        this.config = config;
    }
    async checkCodeQuality(code) {
        try {
            switch (this.config.provider) {
                case 'openai':
                    return await this.callOpenAI(code);
                case 'custom':
                    return await this.callCustomAPI(code);
                case 'local':
                default:
                    return await this.callLocalModel(code);
            }
        }
        catch (error) {
            console.error('AI service error:', error);
            vscode.window.showErrorMessage(`代码质量检查失败: ${error.message}`);
            return -1;
        }
    }
    async callOpenAI(code) {
        if (!this.config.openai?.apiKey) {
            throw new Error('未配置OpenAI API密钥');
        }
        const response = await axios_1.default.post('https://api.openai.com/v1/chat/completions', {
            model: this.config.openai.model,
            messages: [
                {
                    role: 'system',
                    content: this.config.systemPrompt
                },
                {
                    role: 'user',
                    content: `请评估以下代码的质量:\n\n${code}`
                }
            ],
            temperature: 0.3
        }, {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.config.openai.apiKey}`
            }
        });
        const content = response.data.choices[0].message.content;
        return this.parseScore(content);
    }
    async callCustomAPI(code) {
        if (!this.config.custom?.endpoint) {
            throw new Error('未配置自定义API地址');
        }
        const headers = {
            'Content-Type': 'application/json'
        };
        if (this.config.custom.apiKey) {
            headers['Authorization'] = `Bearer ${this.config.custom.apiKey}`;
        }
        const response = await axios_1.default.post(this.config.custom.endpoint, {
            model: this.config.custom.model,
            messages: [
                {
                    role: 'system',
                    content: this.config.systemPrompt
                },
                {
                    role: 'user',
                    content: `请评估以下代码的质量:\n\n${code}`
                }
            ],
            temperature: 0.3
        }, { headers });
        const content = response.data.choices?.[0]?.message?.content || response.data.content || response.data;
        return this.parseScore(content);
    }
    async callLocalModel(code) {
        try {
            const response = await axios_1.default.post('http://localhost:11434/api/chat', {
                model: 'llama2',
                messages: [
                    {
                        role: 'system',
                        content: this.config.systemPrompt
                    },
                    {
                        role: 'user',
                        content: `请评估以下代码的质量:\n\n${code}`
                    }
                ],
                stream: false
            }, {
                timeout: 30000
            });
            const content = response.data.message?.content;
            return this.parseScore(content);
        }
        catch (error) {
            throw new Error('本地模型不可用。请检查Ollama是否在 http://localhost:11434 上运行');
        }
    }
    parseScore(content) {
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
exports.AIService = AIService;
function getConfigFromVSCode() {
    const config = vscode.workspace.getConfiguration('codeChecker');
    return {
        provider: config.get('aiProvider', 'local'),
        systemPrompt: config.get('systemPrompt', ''),
        openai: {
            apiKey: config.get('openai.apiKey', ''),
            model: config.get('openai.model', 'gpt-4-turbo')
        },
        custom: {
            endpoint: config.get('custom.endpoint', ''),
            apiKey: config.get('custom.apiKey', ''),
            model: config.get('custom.model', '')
        }
    };
}
//# sourceMappingURL=aiService.js.map