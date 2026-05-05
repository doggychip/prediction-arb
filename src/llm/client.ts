import 'dotenv/config';
import OpenAI from 'openai';
import type { LLMClient } from '../debate/debate-layer.js';

export type { LLMClient };

const DEFAULT_MODEL = 'anthropic/claude-haiku-4-5';

export class OpenRouterClient implements LLMClient {
  private readonly client: OpenAI;
  private readonly model: string;

  constructor() {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      throw new Error('OPENROUTER_API_KEY is not set');
    }
    this.client = new OpenAI({
      apiKey,
      baseURL: 'https://openrouter.ai/api/v1',
    });
    this.model = process.env.OPENROUTER_MODEL ?? DEFAULT_MODEL;
  }

  async complete(systemPrompt: string, userPrompt: string): Promise<string> {
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    });
    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('OpenRouter returned no content');
    }
    return content;
  }
}
