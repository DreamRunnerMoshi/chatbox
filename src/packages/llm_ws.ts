
import { Message, Session } from '../stores/types'
import * as wordCount from './utils'
import { createParser } from 'eventsource-parser'

export interface OnTextCallbackResult {
    // response content
    text: string
    // cancel for fetch
    cancel: () => void
}

export async function chat(
    apiKey: string,
    host: string,
    maxContextSize: string,
    maxTokens: string,
    modelName: string,
    temperature: number,
    msgs: Message[],
    session: Session,
    targetMsgIndex: number,
    onText: (option: OnTextCallbackResult) => void,
    onError?: (error: Error) => void,
) {
    if (msgs.length === 0) {
        throw new Error('No messages to replay')
    }
    const head = msgs[0].role === 'system' ? msgs[0] : undefined
    if (head) {
        msgs = msgs.slice(1)
    }

    const maxLen = Number(maxContextSize)
    let totalLen = head ? wordCount.estimateTokens(head.content) : 0

    let prompts: Message[] = []
    for (let i = msgs.length - 1; i >= 0; i--) {
        const msg = msgs[i]
        const msgTokenSize: number = wordCount.estimateTokens(msg.content) + 200
        if (msgTokenSize + totalLen > maxLen) {
            break
        }
        prompts = [msg, ...prompts]
        totalLen += msgTokenSize
    }
    if (head) {
        prompts = [head, ...prompts]
    }

    // fetch has been canceled
    let hasCancel = false
    // abort signal for fetch
    const controller = new AbortController()
    const cancel = () => {
        hasCancel = true
        controller.abort()
    }

    let fullText = ''
    try {
        
        const wsUrl = 'ws://ec2-54-235-47-70.compute-1.amazonaws.com:8000/ws/chatgpt/';
        const ws = new WebSocket(wsUrl);
        
        ws.onopen = () => {
            ws.send(msgs[msgs.length -1].content)
        };
        
        ws.onmessage = (event) => {
            console.log(event.data)
            if(event.data !== '[DONE]')  {
                fullText+=event.data
                session.messages[targetMsgIndex] = {
                    ...session.messages[targetMsgIndex],
                    content: fullText,
                    cancel,
                    model: modelName,
                    generating: true,
                }
                onText({ text: fullText, cancel })
            }else {
                session.messages[targetMsgIndex] = {
                    ...session.messages[targetMsgIndex],
                    content: fullText,
                    cancel,
                    model: modelName,
                    generating: false,
                }
                onText({ text: fullText, cancel })
                ws.close()
            }
        };
        
        ws.onerror = (error) => {
            console.error('WebSocket error:', error);
        };
        
        ws.onclose = () => {
            console.log('WebSocket connection closed.');
            return
        };
        
        return () => {
            console.log('returned')
            ws.close();
        };
        
    } catch (error) {
        // if a cancellation is performed
        // do not throw an exception
        // otherwise the content will be overwritten.
        if (hasCancel) {
            return
        }
        if (onError) {
            onError(error as any)
        }
        throw error
    }
}