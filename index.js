import { Groq } from 'groq-sdk';
import dotenv from 'dotenv';

dotenv.config();

// Inicializando o cliente do Groq (usaremos ele para as duas rotas)
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

/**
 * Função principal do Agente.
 * Ele usa um modelo rápido do Groq para classificar a tarefa,
 * e depois direciona para o modelo ideal (leve vs pesado).
 */
async function processarRequisicao(promptUsuario) {
    console.log(`\n[User]: ${promptUsuario}`);
    console.log("Analisando a intenção com o Roteador...");

    // 1. Roteador decide a complexidade
    const systemPrompt = `
    Você é um roteador de tarefas. Analise o prompt do usuário.
    Se for uma pergunta simples, uma saudação ou algo que exija resposta rápida, responda com: {"rota": "rapida"}.
    Se for algo complexo, geração de código longo, análise de texto grande ou formatação estruturada, responda com: {"rota": "profunda"}.
    Responda APENAS com o JSON.
    `;

    const classificacao = await groq.chat.completions.create({
        messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: promptUsuario }
        ],
        model: "openai/gpt-oss-20b", // Modelo rápido para tomar a decisão
        temperature: 0,
        response_format: { type: "json_object" }
    });

    const decisao = JSON.parse(classificacao.choices[0].message.content);

    // 2. Executa o modelo escolhido
    if (decisao.rota === 'rapida') {
        console.log("⚡ Rota escolhida: Rápida (Modelo Leve)");
        const respostaRapida = await groq.chat.completions.create({
            messages: [{ role: "user", content: promptUsuario }],
            model: "openai/gpt-oss-20b", // Modelo veloz para respostas triviais
        });
        console.log(`\n[Agente Rápido]: ${respostaRapida.choices[0].message.content}`);
        
    } else {
        console.log("🧠 Rota escolhida: Profunda (Modelo Pesado/Complexo)");
        const respostaProfunda = await groq.chat.completions.create({
            messages: [{ role: "user", content: promptUsuario }],
            model: "openai/gpt-oss-120b", // <-- O GIGANTE DA SUA LISTA
            max_tokens: 8000 // <-- Adicione esta linha para liberar respostas longas
        });
        console.log(`\n[Agente Profundo]:\n${respostaProfunda.choices[0].message.content}`);
    }
}

// Testando o Agente
async function run() {
    // Teste 1: Tarefa simples
    await processarRequisicao("Qual a capital de Pernambuco?");
    
    // Teste 2: Tarefa complexa
    await processarRequisicao("Crie a estrutura de um banco de dados PostgreSQL para um sistema de gestão de funcionários e ponto eletrônico, incluindo as tabelas e relacionamentos.");
}

run();