import 'dotenv/config'
import Groq from 'groq-sdk'

if (process.env.RUN_GROQ_SMOKE !== '1') {
  console.log('Groq smoke ignorado. Defina RUN_GROQ_SMOKE=1 para executar uma chamada real.')
  process.exit(0)
}
if (!process.env.GROQ_API_KEY) {
  console.error('GROQ_API_KEY nao foi definida no ambiente ou no arquivo .env.')
  process.exit(1)
}

const client = new Groq({ apiKey: process.env.GROQ_API_KEY })
const completion = await client.chat.completions.create({
  model: process.env.GROQ_FAST_MODEL || 'openai/gpt-oss-20b',
  messages: [{ role: 'user', content: 'Responda apenas: GROQ_OK' }],
  temperature: 0,
  max_completion_tokens: 16
})
const answer = completion.choices[0]?.message?.content?.trim()
if (!answer) throw new Error('A Groq respondeu sem conteudo')
console.log(`Groq smoke concluido: ${answer}`)
