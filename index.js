import 'dotenv/config';
import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;
import qrcode from 'qrcode-terminal';
import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';
import ws from 'ws'; 

// ==========================================
// 1. CONFIGURAÇÕES PRINCIPAIS E CONEXÕES
// ==========================================
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const supabase = createClient(
    process.env.SUPABASE_URL, 
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    {
        realtime: {
            transport: ws
        }
    }
);
const NUMERO_DO_CORRETOR = process.env.NUMERO_DO_CORRETOR; 

// ==========================================
// 2. CONTROLO DE ESTADO DO ROBÔ
// ==========================================
const historicoConversas = new Map();
const cronometros = new Map();
const leadsTransferidos = new Set(); 

// ==========================================
// 3. INICIALIZAÇÃO DO WHATSAPP
// ==========================================
console.log("⏳ A iniciar o Bot de Triagem SDR (Consórcios)...");
const client = new Client({
    authStrategy: new LocalAuth({ clientId: 'bot-consorcio-sdr' }),
    puppeteer: {
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
});

client.on('qr', (qr) => {
    console.log('NOVO QR CODE GERADO! Clique no link abaixo para abrir a imagem limpa e escanear:');
    console.log(`https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=${encodeURIComponent(qr)}`);
});

client.on('ready', () => {
    console.log('\n✅ SDR de Consórcios ATIVO e CONECTADO!');
    console.log(`📡 Os Leads QUENTES serão enviados para: ${NUMERO_DO_CORRETOR}`);
    console.log('À espera de novos clientes...\n');
});

// ==========================================
// 4. PROCESSAMENTO DE MENSAGENS (CÉREBRO)
// ==========================================
client.on('message', async (msg) => {
    if (msg.from.includes('@g.us') || msg.from === 'status@broadcast') return;
    
    const numeroCliente = msg.from;

    if (leadsTransferidos.has(numeroCliente)) return;

    console.log(`📩 Cliente ${numeroCliente.split('@')[0]} diz: ${msg.body}`);

    if (cronometros.has(numeroCliente)) clearTimeout(cronometros.get(numeroCliente));

    try {
        // --- INICIALIZA A MEMÓRIA DA IA PARA ESTE CLIENTE ---
        if (!historicoConversas.has(numeroCliente)) {
            historicoConversas.set(numeroCliente, [{
                role: "system",
                content: `Você é a assistente virtual de triagem e SDR especialista em Consórcios da Porto Seguro.
O seu objetivo é recolher dados do cliente, esclarecer dúvidas, contornar objeções e, no final, qualificar se o cliente é um LEAD QUENTE ou FRIO.

=== BASE DE CONHECIMENTO E AUTORIDADE ===
- Trabalhamos com a Porto Seguro, uma instituição tradicional, extremamente segura e 100% fiscalizada pelo Banco Central.
- Não cobramos juros como nos financiamentos bancários convencionais, apenas uma taxa de administração fixa e diluída.
- Prazos normais: Automóveis (até 80 meses), Imóveis (até 240 meses).
- Formas de contemplação: Sorteio mensal ou Lance.

=== COMO CONTORNAR OBJEÇÕES ===
- "Demora muito": Explique que é um planeamento financeiro inteligente. Com o "lance", o cliente pode antecipar a compra saindo muito mais barato do que pagar juros ao banco.
- "Tem taxa / É caro": Esclareça que no consórcio NÃO HÁ JUROS. No financiamento bancário o cliente paga 2 bens, enquanto no consórcio paga quase apenas 1.
- "Não tenho entrada": Tranquilize-o indicando que a maior vantagem do consórcio é não exigir entrada. Concorre todos os meses pagando apenas a parcela.
- "É seguro? / Tenho medo": Dê a cartada de autoridade. Lembre que a Porto Seguro é uma das maiores e mais seguras do mercado.

REGRAS DE ATENDIMENTO:
Faça estas perguntas de forma natural, UMA DE CADA VEZ, simulando uma conversa humana amigável (nunca envie um questionário de uma vez):
1. Nome do cliente.
2. Objetivo (Imóvel, Carro, Moto, Pesados ou Investimento).
3. Valor da carta de crédito desejada.
4. Parcela máxima que fica confortável para ele pagar mensalmente.
5. Se tem algum valor para oferecer como "Lance" ou se planeia contar apenas com os sorteios.

CRITÉRIOS DE QUALIFICAÇÃO (Para usar na função final):
- LEAD QUENTE: Sabe o que quer, tem dinheiro para a parcela compatível com o bem, tem urgência ou tem valor para dar de lance.
- LEAD FRIO: Apenas curioso, acha que o dinheiro sai na hora (financiamento), não tem renda para a parcela ou não tem valor para lance e tem pressa.

FINALIZAÇÃO:
Quando tiver todas as 5 respostas, despeça-se brevemente e chame a função 'finalizar_triagem' com os dados e a sua classificação.`
            }]);
        }

        const conversaAtual = historicoConversas.get(numeroCliente);
        conversaAtual.push({ role: "user", content: msg.body });

        // --- DEFINIÇÃO DA FUNÇÃO DE QUALIFICAÇÃO ---
        const ferramentas = [
            { 
                type: "function", 
                function: { 
                    name: "finalizar_triagem", 
                    description: "Envia os dados recolhidos e a qualificação do lead para o sistema de CRM.",
                    parameters: { 
                        type: "object", 
                        properties: { 
                            nome: { type: "string" }, 
                            objetivo: { type: "string" }, 
                            valor_carta: { type: "string" }, 
                            parcela_ideal: { type: "string" }, 
                            tem_lance: { type: "string" },
                            classificacao: { type: "string", enum: ["QUENTE", "FRIO"], description: "Avaliação do potencial real de compra do cliente." },
                            feedback_consultor: { type: "string", description: "Breve resumo explicando o motivo desta classificação para o corretor ler." }
                        }, 
                        required: ["nome", "objetivo", "valor_carta", "parcela_ideal", "tem_lance", "classificacao", "feedback_consultor"] 
                    } 
                } 
            }
        ];

        // --- CHAMADA À OPENAI ---
        const respostaIA = await openai.chat.completions.create({ 
            model: "gpt-4o-mini", 
            messages: conversaAtual, 
            tools: ferramentas 
        });
        
        const mensagemIA = respostaIA.choices[0].message;
        conversaAtual.push(mensagemIA);

        // --- SE A IA FINALIZOU A TRIAGEM E CHAMOU A FUNÇÃO ---
        if (mensagemIA.tool_calls?.length > 0) {
            const toolCall = mensagemIA.tool_calls[0];
            
            if (toolCall.function.name === 'finalizar_triagem') {
                const args = JSON.parse(toolCall.function.arguments);
                const telefoneLimpo = numeroCliente.split('@')[0];

                console.log(`\n🎯 [LEAD ${args.classificacao}] ${args.nome} - Objetivo: ${args.objetivo}`);
                console.log(`🧠 Análise da IA: ${args.feedback_consultor}\n`);

                // 1. GUARDA NO BANCO DE DADOS (SUPABASE)
                const { error: dbError } = await supabase.from('leads_consorcio').insert([{
                    telefone: telefoneLimpo,
                    nome: args.nome,
                    objetivo: args.objetivo,
                    valor_carta: args.valor_carta,
                    parcela_ideal: args.parcela_ideal,
                    tem_lance: args.tem_lance,
                    status: args.classificacao, 
                    feedback: args.feedback_consultor 
                }]);

                if (dbError) console.error("❌ Erro ao salvar lead no Supabase:", dbError.message);

                // 2. LÓGICA DE ENCAMINHAMENTO (QUENTE VS FRIO)
                if (args.classificacao === 'QUENTE') {
                    const alertaCorretor = `🔥 *NOVO LEAD QUENTE (PORTO SEGURO)!* 🔥\n\n` +
                                         `👤 *Nome:* ${args.nome}\n` +
                                         `📱 *WhatsApp:* wa.me/${telefoneLimpo}\n` +
                                         `🎯 *Objetivo:* ${args.objetivo}\n` +
                                         `💰 *Crédito:* ${args.valor_carta}\n` +
                                         `📅 *Parcela:* ${args.parcela_ideal}\n` +
                                         `💸 *Lance:* ${args.tem_lance}\n\n` +
                                         `🧠 *Análise da IA:* ${args.feedback_consultor}\n\n` +
                                         `_O robô silenciou-se. Pode assumir a venda e fechar negócio!_`;
                    
                    await client.sendMessage(NUMERO_DO_CORRETOR, alertaCorretor);
                    
                    await msg.reply(`Tudo anotado, ${args.nome}! 📋\n\nO nosso especialista da Porto Seguro acabou de receber o seu perfil e vai contactá-lo por aqui em instantes com as melhores propostas de ${args.objetivo}. Obrigado!`);
                } else {
                    await msg.reply(`Obrigado pelas informações, ${args.nome}! 📋\n\nA nossa equipa comercial vai analisar o seu perfil e entraremos em contacto consigo no futuro com mais detalhes sobre os grupos que se encaixam neste momento.`);
                }

                // 3. BLOQUEIA O ROBÔ PARA ESTE NÚMERO
                leadsTransferidos.add(numeroCliente);
            }
        } else {
            await msg.reply(mensagemIA.content);
        }

        // --- GESTÃO DE MEMÓRIA ---
        const timer = setTimeout(() => { 
            historicoConversas.delete(numeroCliente); 
            console.log(`🧹 Memória limpa para o número ${numeroCliente.split('@')[0]}`);
        }, 30 * 60 * 1000);
        cronometros.set(numeroCliente, timer);

    } catch (erro) { 
        console.error(`❌ Erro no processamento:`, erro);
    }
});

client.initialize();