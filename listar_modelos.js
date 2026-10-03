import { Groq } from 'groq-sdk';
import dotenv from 'dotenv';

dotenv.config();

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

async function listar() {
    try {
        console.log("Buscando modelos disponíveis na Groq...");
        const modelos = await groq.models.list();
        
        console.log("\n=== MODELOS ATIVOS AGORA ===");
        modelos.data.forEach(m => console.log(`- ${m.id}`));
        console.log("============================\n");
    } catch (error) {
        console.error("Erro ao buscar modelos:", error.message);
    }
}

listar();