"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BaseChatCompletionsModel = void 0;
const zod_1 = __importDefault(require("zod"));
const base_chat_model_1 = require("./base_chat_model");
const messages_1 = require("./messages");
const tools_1 = require("./tools");
class BaseChatCompletionsModel extends base_chat_model_1.BaseChatModel {
    _buildChatCompletionsParams(systemPrompt, msgs) {
        const system_prompt = systemPrompt.content
            .filter((p) => p.type === 'text')
            .map((p) => p.text)
            .join('');
        const messages = [
            {
                role: 'system',
                content: system_prompt,
            },
        ];
        for (const m of msgs) {
            if (m.role === 'user') {
                const userContent = m.content.map((c) => {
                    if (c.type === 'text') {
                        return { type: 'text', text: c.text };
                    }
                    return {
                        type: 'image_url',
                        image_url: {
                            url: c.image_url.url,
                            detail: c.image_url.detail ?? 'auto',
                        },
                    };
                });
                messages.push({
                    role: 'user',
                    content: userContent,
                });
            }
            else if (m.role === 'assistant') {
                const textContent = m.content
                    .filter((p) => p.type === 'text')
                    .map((p) => p.text)
                    .join('')
                    .trim();
                const toolCalls = m.meta?.tool_calls ?? [];
                const assistantMessage = {
                    role: 'assistant',
                };
                if (textContent) {
                    assistantMessage.content = textContent;
                }
                if (toolCalls.length > 0) {
                    assistantMessage.tool_calls = toolCalls.map((tc) => ({
                        id: tc.id,
                        type: 'function',
                        function: {
                            name: tc.name,
                            arguments: JSON.stringify(tc.arguments),
                        },
                    }));
                }
                messages.push(assistantMessage);
            }
            else if (m.role === 'tool') {
                if (!m.tool_call_id) {
                    throw new Error('Tool message missing tool_call_id');
                }
                messages.push({
                    role: 'tool',
                    tool_call_id: m.tool_call_id,
                    content: m.content
                        .filter((p) => p.type === 'text')
                        .map((p) => p.text)
                        .join(''),
                });
            }
        }
        const params = {
            model: this.params.model,
            messages,
            stream: false,
        };
        if (this.params.temperature !== undefined) {
            params.temperature = this.params.temperature;
        }
        if (this.params.maxTokens !== undefined) {
            params.max_tokens = this.params.maxTokens;
        }
        if (this.params.topP !== undefined) {
            params.top_p = this.params.topP;
        }
        if (this.params.stop !== undefined) {
            params.stop = this.params.stop;
        }
        if (this.params.seed !== undefined) {
            params.seed = this.params.seed;
        }
        if (this.boundTools.length > 0) {
            const tools = this.boundTools.map((t) => {
                const spec = (0, tools_1.toOpenAIToolSpec)(t);
                return {
                    type: 'function',
                    function: {
                        name: spec.name,
                        description: spec.description ?? '',
                        parameters: spec.parameters ?? {},
                        strict: spec.strict ?? null,
                    },
                };
            });
            params.tools = tools;
            params.tool_choice = 'auto';
        }
        if (this.structuredOutputSchema) {
            const toolName = this.structuredOutputToolName;
            const tool = {
                type: 'function',
                function: {
                    name: toolName,
                    description: 'Structured output formatter',
                    parameters: zod_1.default.toJSONSchema(this.structuredOutputSchema),
                    strict: true,
                },
            };
            console.log('Groq Structured Output JSON Schema:', JSON.stringify(tool.function.parameters, null, 2));
            params.tools = [...(params.tools ?? []), tool];
            params.tool_choice = {
                type: 'function',
                function: { name: toolName },
            };
        }
        console.log('Chat messages sent:', JSON.stringify(messages, null, 2));
        return params;
    }
    _processChatCompletionsResponse(response) {
        const choice = response.choices[0];
        if (!choice) {
            throw new Error('Chat completion returned no choices');
        }
        const message = choice.message;
        const assistant = new messages_1.AssistantMessage(message.content ?? '');
        assistant.meta = {
            raw: response,
            finish_reason: choice.finish_reason,
            logprobs: choice.logprobs,
        };
        const toolCalls = (message.tool_calls ?? [])
            .filter((tc) => tc.type === 'function')
            .map((tc) => {
            try {
                return {
                    id: tc.id,
                    name: tc.function.name,
                    arguments: JSON.parse(tc.function.arguments),
                };
            }
            catch (e) {
                throw new Error(`Failed to parse arguments for ${tc.function.name}: ${e}`);
            }
        });
        console.log('Assistant message:', assistant);
        console.log('Extracted tool calls:', toolCalls);
        if (toolCalls.length > 0) {
            assistant.meta.tool_calls = toolCalls;
        }
        if (message.tool_calls && message.tool_calls.length > 0) {
            assistant.meta.raw_tool_calls = message.tool_calls;
        }
        return { assistant, toolCalls };
    }
}
exports.BaseChatCompletionsModel = BaseChatCompletionsModel;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiL3Vzci9zcmMvYXBwL3NyYy9saWIvYWkvY29yZS9iYXNlX2NoYXRfY29tcGxldGlvbnNfbW9kZWwudHMiLCJzb3VyY2VzIjpbIi91c3Ivc3JjL2FwcC9zcmMvbGliL2FpL2NvcmUvYmFzZV9jaGF0X2NvbXBsZXRpb25zX21vZGVsLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7OztBQVFBLDhDQUFvQjtBQUVwQix1REFBa0Q7QUFDbEQseUNBQW9GO0FBQ3BGLG1DQUFxRDtBQUVyRCxNQUFzQix3QkFBeUIsU0FBUSwrQkFBYTtJQUN4RCwyQkFBMkIsQ0FDbkMsWUFBMkIsRUFDM0IsSUFBbUI7UUFFbkIsTUFBTSxhQUFhLEdBQUcsWUFBWSxDQUFDLE9BQU87YUFDdkMsTUFBTSxDQUFDLENBQUMsQ0FBQyxFQUFpQixFQUFFLENBQUMsQ0FBQyxDQUFDLElBQUksS0FBSyxNQUFNLENBQUM7YUFDL0MsR0FBRyxDQUFDLENBQUMsQ0FBQyxFQUFFLEVBQUUsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDO2FBQ2xCLElBQUksQ0FBQyxFQUFFLENBQUMsQ0FBQztRQUVaLE1BQU0sUUFBUSxHQUFpQztZQUM3QztnQkFDRSxJQUFJLEVBQUUsUUFBUTtnQkFDZCxPQUFPLEVBQUUsYUFBYTthQUN2QjtTQUNGLENBQUM7UUFFRixLQUFLLE1BQU0sQ0FBQyxJQUFJLElBQUksRUFBRSxDQUFDO1lBQ3JCLElBQUksQ0FBQyxDQUFDLElBQUksS0FBSyxNQUFNLEVBQUUsQ0FBQztnQkFDdEIsTUFBTSxXQUFXLEdBQUcsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLEVBQTZCLEVBQUU7b0JBQ2pFLElBQUksQ0FBQyxDQUFDLElBQUksS0FBSyxNQUFNLEVBQUUsQ0FBQzt3QkFDdEIsT0FBTyxFQUFFLElBQUksRUFBRSxNQUFNLEVBQUUsSUFBSSxFQUFFLENBQUMsQ0FBQyxJQUFJLEVBQUUsQ0FBQztvQkFDeEMsQ0FBQztvQkFDRCxPQUFPO3dCQUNMLElBQUks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Q0FBQyxNQUFNLEdBQUcsQ0FBQyxFQUFFLENBQUM7WUFDekIsU0FBUyxDQUFDLElBQUksQ0FBQyxVQUFVLEdBQUcsU0FBUyxDQUFDO1FBQ3hDLENBQUM7UUFDRCxJQUFJLE9BQU8sQ0FBQyxVQUFVLElBQUksT0FBTyxDQUFDLFVBQVUsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxFQUFFLENBQUM7WUFDeEQsU0FBUyxDQUFDLElBQUksQ0FBQyxjQUFjLEdBQUcsT0FBTyxDQUFDLFVBQVUsQ0FBQztRQUNyRCxDQUFDO1FBRUQsT0FBTyxFQUFFLFNBQVMsRUFBRSxTQUFTLEVBQUUsQ0FBQztJQUNsQyxDQUFDO0NBQ0Y7QUEvTEQsNERBK0xDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IE9wZW5BSSBmcm9tICdvcGVuYWknO1xuaW1wb3J0IHtcbiAgQ2hhdENvbXBsZXRpb24sXG4gIENoYXRDb21wbGV0aW9uQ29udGVudFBhcnQsXG4gIENoYXRDb21wbGV0aW9uTWVzc2FnZVBhcmFtLFxuICBDaGF0Q29tcGxldGlvbk1lc3NhZ2VUb29sQ2FsbCxcbiAgQ2hhdENvbXBsZXRpb25Ub29sLFxufSBmcm9tICdvcGVuYWkvcmVzb3VyY2VzL2NoYXQvY29tcGxldGlvbnMnO1xuaW1wb3J0IHogZnJvbSAnem9kJztcblxuaW1wb3J0IHsgQmFzZUNoYXRNb2RlbCB9IGZyb20gJy4vYmFzZV9jaGF0X21vZGVsJztcbmltcG9ydCB7IEFzc2lzdGFudE1lc3NhZ2UsIEJhc2VNZXNzYWdlLCBTeXN0ZW1NZXNzYWdlLCBUZXh0UGFydCB9IGZyb20gJy4vbWVzc2FnZXMnO1xuaW1wb3J0IHsgVG9vbENhbGwsIHRvT3BlbkFJVG9vbFNwZWMgfSBmcm9tICcuL3Rvb2xzJztcblxuZXhwb3J0IGFic3RyYWN0IGNsYXNzIEJhc2VDaGF0Q29tcGxldGlvbnNNb2RlbCBleHRlbmRzIEJhc2VDaGF0TW9kZWwge1xuICBwcm90ZWN0ZWQgX2J1aWxkQ2hhdENvbXBsZXRpb25zUGFyYW1zKFxuICAgIHN5c3RlbVByb21wdDogU3lzdGVtTWVzc2FnZSxcbiAgICBtc2dzOiBCYXNlTWVzc2FnZVtdLFxuICApOiBPcGVuQUkuQ2hhdC5Db21wbGV0aW9ucy5DaGF0Q29tcGxldGlvbkNyZWF0ZVBhcmFtc05vblN0cmVhbWluZyB7XG4gICAgY29uc3Qgc3lzdGVtX3Byb21wdCA9IHN5c3RlbVByb21wdC5jb250ZW50XG4gICAgICAuZmlsdGVyKChwKTogcCBpcyBUZXh0UGFydCA9PiBwLnR5cGUgPT09ICd0ZXh0JylcbiAgICAgIC5tYXAoKHApID0+IHAudGV4dClcbiAgICAgIC5qb2luKCcnKTtcblxuICAgIGNvbnN0IG1lc3NhZ2VzOiBDaGF0Q29tcGxldGlvbk1lc3NhZ2VQYXJhbVtdID0gW1xuICAgICAge1xuICAgICAgICByb2xlOiAnc3lzdGVtJyxcbiAgICAgICAgY29udGVudDogc3lzdGVtX3Byb21wdCxcbiAgICAgIH0sXG4gICAgXTtcblxuICAgIGZvciAoY29uc3QgbSBvZiBtc2dzKSB7XG4gICAgICBpZiAobS5yb2xlID09PSAndXNlcicpIHtcbiAgICAgICAgY29uc3QgdXNlckNvbnRlbnQgPSBtLmNvbnRlbnQubWFwKChjKTogQ2hhdENvbXBsZXRpb25Db250ZW50UGFydCA9PiB7XG4gICAgICAgICAgaWYgKGMudHlwZSA9PT0gJ3RleHQnKSB7XG4gICAgICAgICAgICByZXR1cm4geyB0eXBlOiAndGV4dCcsIHRleHQ6IGMudGV4dCB9O1xuICAgICAgICAgIH1cbiAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgdHlwZTogJ2ltYWdlX3VybCcsXG4gICAgICAgICAgICBpbWFnZV91cmw6IHtcbiAgICAgICAgICAgICAgdXJsOiBjLmltYWdlX3VybC51cmwsXG4gICAgICAgICAgICAgIGRldGFpbDogYy5pbWFnZV91cmwuZGV0YWlsID8/ICdhdXRvJyxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgfTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgbWVzc2FnZXMucHVzaCh7XG4gICAgICAgICAgcm9sZTogJ3VzZXInLFxuICAgICAgICAgIGNvbnRlbnQ6IHVzZXJDb250ZW50LFxuICAgICAgICB9KTtcbiAgICAgIH0gZWxzZSBpZiAobS5yb2xlID09PSAnYXNzaXN0YW50Jykge1xuICAgICAgICBjb25zdCB0ZXh0Q29udGVudCA9IG0uY29udGVudFxuICAgICAgICAgIC5maWx0ZXIoKHApOiBwIGlzIFRleHRQYXJ0ID0+IHAudHlwZSA9PT0gJ3RleHQnKVxuICAgICAgICAgIC5tYXAoKHApID0+IHAudGV4dClcbiAgICAgICAgICAuam9pbignJylcbiAgICAgICAgICAudHJpbSgpO1xuXG4gICAgICAgIGNvbnN0IHRvb2xDYWxscyA9IChtLm1ldGE/LnRvb2xfY2FsbHMgYXMgVG9vbENhbGxbXSB8IHVuZGVmaW5lZCkgPz8gW107XG4gICAgICAgIGNvbnN0IGFzc2lzdGFudE1lc3NhZ2U6IENoYXRDb21wbGV0aW9uTWVzc2FnZVBhcmFtID0ge1xuICAgICAgICAgIHJvbGU6ICdhc3Npc3RhbnQnLFxuICAgICAgICB9O1xuXG4gICAgICAgIGlmICh0ZXh0Q29udGVudCkge1xuICAgICAgICAgIGFzc2lzdGFudE1lc3NhZ2UuY29udGVudCA9IHRleHRDb250ZW50O1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKHRvb2xDYWxscy5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgYXNzaXN0YW50TWVzc2FnZS50b29sX2NhbGxzID0gdG9vbENhbGxzLm1hcDxDaGF0Q29tcGxldGlvbk1lc3NhZ2VUb29sQ2FsbD4oKHRjKSA9PiAoe1xuICAgICAgICAgICAgaWQ6IHRjLmlkLFxuICAgICAgICAgICAgdHlwZTogJ2Z1bmN0aW9uJyxcbiAgICAgICAgICAgIGZ1bmN0aW9uOiB7XG4gICAgICAgICAgICAgIG5hbWU6IHRjLm5hbWUsXG4gICAgICAgICAgICAgIGFyZ3VtZW50czogSlNPTi5zdHJpbmdpZnkodGMuYXJndW1lbnRzKSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgfSkpO1xuICAgICAgICB9XG5cbiAgICAgICAgbWVzc2FnZXMucHVzaChhc3Npc3RhbnRNZXNzYWdlKTtcbiAgICAgIH0gZWxzZSBpZiAobS5yb2xlID09PSAndG9vbCcpIHtcbiAgICAgICAgaWYgKCFtLnRvb2xfY2FsbF9pZCkge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcignVG9vbCBtZXNzYWdlIG1pc3NpbmcgdG9vbF9jYWxsX2lkJyk7XG4gICAgICAgIH1cbiAgICAgICAgbWVzc2FnZXMucHVzaCh7XG4gICAgICAgICAgcm9sZTogJ3Rvb2wnLFxuICAgICAgICAgIHRvb2xfY2FsbF9pZDogbS50b29sX2NhbGxfaWQsXG4gICAgICAgICAgY29udGVudDogbS5jb250ZW50XG4gICAgICAgICAgICAuZmlsdGVyKChwKTogcCBpcyBUZXh0UGFydCA9PiBwLnR5cGUgPT09ICd0ZXh0JylcbiAgICAgICAgICAgIC5tYXAoKHApID0+IHAudGV4dClcbiAgICAgICAgICAgIC5qb2luKCcnKSxcbiAgICAgICAgfSk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgY29uc3QgcGFyYW1zOiBPcGVuQUkuQ2hhdC5Db21wbGV0aW9ucy5DaGF0Q29tcGxldGlvbkNyZWF0ZVBhcmFtc05vblN0cmVhbWluZyA9IHtcbiAgICAgIG1vZGVsOiB0aGlzLnBhcmFtcy5tb2RlbCxcbiAgICAgIG1lc3NhZ2VzLFxuICAgICAgc3RyZWFtOiBmYWxzZSxcbiAgICB9O1xuXG4gICAgaWYgKHRoaXMucGFyYW1zLnRlbXBlcmF0dXJlICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIHBhcmFtcy50ZW1wZXJhdHVyZSA9IHRoaXMucGFyYW1zLnRlbXBlcmF0dXJlO1xuICAgIH1cbiAgICBpZiAodGhpcy5wYXJhbXMubWF4VG9rZW5zICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIHBhcmFtcy5tYXhfdG9rZW5zID0gdGhpcy5wYXJhbXMubWF4VG9rZW5zO1xuICAgIH1cbiAgICBpZiAodGhpcy5wYXJhbXMudG9wUCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICBwYXJhbXMudG9wX3AgPSB0aGlzLnBhcmFtcy50b3BQO1xuICAgIH1cbiAgICBpZiAodGhpcy5wYXJhbXMuc3RvcCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICBwYXJhbXMuc3RvcCA9IHRoaXMucGFyYW1zLnN0b3A7XG4gICAgfVxuICAgIGlmICh0aGlzLnBhcmFtcy5zZWVkICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIHBhcmFtcy5zZWVkID0gdGhpcy5wYXJhbXMuc2VlZDtcbiAgICB9XG5cbiAgICBpZiAodGhpcy5ib3VuZFRvb2xzLmxlbmd0aCA+IDApIHtcbiAgICAgIGNvbnN0IHRvb2xzOiBDaGF0Q29tcGxldGlvblRvb2xbXSA9IHRoaXMuYm91bmRUb29scy5tYXAoKHQpID0+IHtcbiAgICAgICAgY29uc3Qgc3BlYyA9IHRvT3BlbkFJVG9vbFNwZWModCk7XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgdHlwZTogJ2Z1bmN0aW9uJyxcbiAgICAgICAgICBmdW5jdGlvbjoge1xuICAgICAgICAgICAgbmFtZTogc3BlYy5uYW1lLFxuICAgICAgICAgICAgZGVzY3JpcHRpb246IHNwZWMuZGVzY3JpcHRpb24gPz8gJycsXG4gICAgICAgICAgICBwYXJhbWV0ZXJzOiBzcGVjLnBhcmFtZXRlcnMgPz8ge30sXG4gICAgICAgICAgICBzdHJpY3Q6IHNwZWMuc3RyaWN0ID8/IG51bGwsXG4gICAgICAgICAgfSxcbiAgICAgICAgfTtcbiAgICAgIH0pO1xuICAgICAgcGFyYW1zLnRvb2xzID0gdG9vbHM7XG4gICAgICBwYXJhbXMudG9vbF9jaG9pY2UgPSAnYXV0byc7XG4gICAgfVxuXG4gICAgaWYgKHRoaXMuc3RydWN0dXJlZE91dHB1dFNjaGVtYSkge1xuICAgICAgY29uc3QgdG9vbE5hbWUgPSB0aGlzLnN0cnVjdHVyZWRPdXRwdXRUb29sTmFtZTtcbiAgICAgIGNvbnN0IHRvb2w6IENoYXRDb21wbGV0aW9uVG9vbCA9IHtcbiAgICAgICAgdHlwZTogJ2Z1bmN0aW9uJyxcbiAgICAgICAgZnVuY3Rpb246IHtcbiAgICAgICAgICBuYW1lOiB0b29sTmFtZSxcbiAgICAgICAgICBkZXNjcmlwdGlvbjogJ1N0cnVjdHVyZWQgb3V0cHV0IGZvcm1hdHRlcicsXG4gICAgICAgICAgcGFyYW1ldGVyczogei50b0pTT05TY2hlbWEodGhpcy5zdHJ1Y3R1cmVkT3V0cHV0U2NoZW1hKSBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPixcbiAgICAgICAgICBzdHJpY3Q6IHRydWUsXG4gICAgICAgIH0sXG4gICAgICB9O1xuICAgICAgLy8gQWRkZWQgbG9nZ2luZyBoZXJlIGZvciBKU09OIHNjaGVtYVxuICAgICAgY29uc29sZS5sb2coXG4gICAgICAgICdHcm9xIFN0cnVjdHVyZWQgT3V0cHV0IEpTT04gU2NoZW1hOicsXG4gICAgICAgIEpTT04uc3RyaW5naWZ5KHRvb2wuZnVuY3Rpb24ucGFyYW1ldGVycywgbnVsbCwgMiksXG4gICAgICApO1xuXG4gICAgICBwYXJhbXMudG9vbHMgPSBbLi4uKHBhcmFtcy50b29scyA/PyBbXSksIHRvb2xdO1xuICAgICAgcGFyYW1zLnRvb2xfY2hvaWNlID0ge1xuICAgICAgICB0eXBlOiAnZnVuY3Rpb24nLFxuICAgICAgICBmdW5jdGlvbjogeyBuYW1lOiB0b29sTmFtZSB9LFxuICAgICAgfTtcbiAgICB9XG5cbiAgICAvLyBBZGRlZCBsb2dnaW5nIGhlcmUgZm9yIGNoYXQgbWVzc2FnZXMgYXJyYXlcbiAgICBjb25zb2xlLmxvZygnQ2hhdCBtZXNzYWdlcyBzZW50OicsIEpTT04uc3RyaW5naWZ5KG1lc3NhZ2VzLCBudWxsLCAyKSk7XG5cbiAgICByZXR1cm4gcGFyYW1zO1xuICB9XG5cbiAgcHJvdGVjdGVkIF9wcm9jZXNzQ2hhdENvbXBsZXRpb25zUmVzcG9uc2UocmVzcG9uc2U6IENoYXRDb21wbGV0aW9uKToge1xuICAgIGFzc2lzdGFudDogQXNzaXN0YW50TWVzc2FnZTtcbiAgICB0b29sQ2FsbHM6IFRvb2xDYWxsW107XG4gIH0ge1xuICAgIGNvbnN0IGNob2ljZSA9IHJlc3BvbnNlLmNob2ljZXNbMF07XG4gICAgaWYgKCFjaG9pY2UpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcignQ2hhdCBjb21wbGV0aW9uIHJldHVybmVkIG5vIGNob2ljZXMnKTtcbiAgICB9XG4gICAgY29uc3QgbWVzc2FnZSA9IGNob2ljZS5tZXNzYWdlO1xuXG4gICAgY29uc3QgYXNzaXN0YW50ID0gbmV3IEFzc2lzdGFudE1lc3NhZ2UobWVzc2FnZS5jb250ZW50ID8/ICcnKTtcbiAgICBhc3Npc3RhbnQubWV0YSA9IHtcbiAgICAgIHJhdzogcmVzcG9uc2UsXG4gICAgICBmaW5pc2hfcmVhc29uOiBjaG9pY2UuZmluaXNoX3JlYXNvbixcbiAgICAgIGxvZ3Byb2JzOiBjaG9pY2UubG9ncHJvYnMsXG4gICAgfTtcblxuICAgIGNvbnN0IHRvb2xDYWxscyA9IChtZXNzYWdlLnRvb2xfY2FsbHMgPz8gW10pXG4gICAgICAuZmlsdGVyKCh0YykgPT4gdGMudHlwZSA9PT0gJ2Z1bmN0aW9uJylcbiAgICAgIC5tYXAoKHRjKSA9PiB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIGlkOiB0Yy5pZCxcbiAgICAgICAgICAgIG5hbWU6IHRjLmZ1bmN0aW9uLm5hbWUsXG4gICAgICAgICAgICBhcmd1bWVudHM6IEpTT04ucGFyc2UodGMuZnVuY3Rpb24uYXJndW1lbnRzKSBhcyB1bmtub3duLFxuICAgICAgICAgIH07XG4gICAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEZhaWxlZCB0byBwYXJzZSBhcmd1bWVudHMgZm9yICR7dGMuZnVuY3Rpb24ubmFtZX06ICR7ZX1gKTtcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgLy8gQWRkZWQgbG9ncyBoZXJlIGZvciBhc3Npc3RhbnQgbWVzc2FnZSBhbmQgdG9vbCBjYWxsc1xuICAgIGNvbnNvbGUubG9nKCdBc3Npc3RhbnQgbWVzc2FnZTonLCBhc3Npc3RhbnQpO1xuICAgIGNvbnNvbGUubG9nKCdFeHRyYWN0ZWQgdG9vbCBjYWxsczonLCB0b29sQ2FsbHMpO1xuXG4gICAgaWYgKHRvb2xDYWxscy5sZW5ndGggPiAwKSB7XG4gICAgICBhc3Npc3RhbnQubWV0YS50b29sX2NhbGxzID0gdG9vbENhbGxzO1xuICAgIH1cbiAgICBpZiAobWVzc2FnZS50b29sX2NhbGxzICYmIG1lc3NhZ2UudG9vbF9jYWxscy5sZW5ndGggPiAwKSB7XG4gICAgICBhc3Npc3RhbnQubWV0YS5yYXdfdG9vbF9jYWxscyA9IG1lc3NhZ2UudG9vbF9jYWxscztcbiAgICB9XG5cbiAgICByZXR1cm4geyBhc3Npc3RhbnQsIHRvb2xDYWxscyB9O1xuICB9XG59XG4iXX0=