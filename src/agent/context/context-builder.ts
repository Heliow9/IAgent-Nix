import type { ModelMessage } from '../providers/model-provider'

interface ContextInput {
  systemPrompt: string
  workspaceRules?: string
  summary?: string
  projectMap?: string
  history?: ModelMessage[]
  attachedFiles?: Array<{ path: string; content: string }>
  recentToolResults?: Array<{ name: string; content: string }>
  userPrompt: string
  maxCharacters: number
}

const SECRET_PATH = /(^|[\\/])(\.env(?:\..*)?|id_(?:rsa|ed25519)|[^\\/]+\.(?:pem|key|p12|pfx))$/i

export class ContextBuilder {
  build(input: ContextInput): ModelMessage[] {
    const systemContent = input.workspaceRules
      ? `${input.systemPrompt}\n\nWorkspace rules:\n${input.workspaceRules}`
      : input.systemPrompt
    const fixedBefore: ModelMessage[] = [{ role: 'system', content: systemContent }]
    if (input.summary) fixedBefore.push({ role: 'system', content: input.summary })
    if (input.projectMap) fixedBefore.push({ role: 'system', content: input.projectMap })

    const attachments = (input.attachedFiles ?? [])
      .filter((file) => !SECRET_PATH.test(file.path))
      .map<ModelMessage>((file) => ({ role: 'user', content: `File: ${file.path}\n${file.content}` }))
    const tools = (input.recentToolResults ?? [])
      .map<ModelMessage>((result) => ({ role: 'tool', name: result.name, content: result.content }))
    const finalMessage: ModelMessage = { role: 'user', content: input.userPrompt }
    const fixedCost = characterCost([...fixedBefore, ...attachments, ...tools, finalMessage])
    const selectedHistory: ModelMessage[] = []
    let budget = Math.max(0, input.maxCharacters - fixedCost)
    for (const message of [...(input.history ?? [])].reverse()) {
      const cost = message.content.length
      if (cost > budget) continue
      selectedHistory.unshift(message)
      budget -= cost
    }
    return [...fixedBefore, ...selectedHistory, ...attachments, ...tools, finalMessage]
  }
}

function characterCost(messages: ModelMessage[]): number {
  return messages.reduce((sum, message) => sum + message.content.length, 0)
}
