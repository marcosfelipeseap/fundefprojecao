const express = require('express');
const axios = require('axios');
const { parse } = require('csv-parse/sync');
const path = require('path'); // Necessário para a Vercel localizar as pastas

const app = express();
const port = process.env.PORT || 3000;

// Configura o EJS como motor de visualização e mapeia a pasta views para a Vercel
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

const SHEET_ID = '1MOFoH9H0u9PC-w_-ZpE5yfc4QpbdFui2lI_uoZtedt4';

// Função para limpar textos: Remove TODOS os espaços, pontos e acentos
function sanitizeForMatch(str) {
    if (!str) return '';
    return String(str)
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "") // Remove acentos
        .replace(/[^A-Za-z0-9]/g, "")    // Remove espaços, pontos, vírgulas
        .toUpperCase();
}

// Função para converter valores financeiros e quantidades em números
function parseNumber(str) {
    if (!str) return 0;
    if (typeof str === 'number') return str;
    let s = str.toString().replace(/[R$\s]/g, '');
    if (s.includes(',') && s.includes('.')) {
        s = s.replace(/\./g, '').replace(',', '.'); // Ex: 1.200,50 -> 1200.50
    } else if (s.includes(',')) {
        s = s.replace(',', '.'); // Ex: 1200,50 -> 1200.50
    }
    return parseFloat(s) || 0;
}

// Normaliza os cabeçalhos das colunas
function normalizeRow(row) {
    const normalized = {};
    for (let key in row) {
        normalized[sanitizeForMatch(key)] = row[key];
    }
    return normalized;
}

// Lista exata de produtos e processos
const targets = [
    { fundef: 1, processo: '202456010136590', item: 'CARTEIRA ESCOLAR' },
    { fundef: 1, processo: '202456010136590', item: 'CJ. ALUNO' },
    { fundef: 1, processo: '202456010136591', item: 'CJ. REFEITÓRIO' },
    { fundef: 1, processo: '202456010136591', item: 'CJ. PROFESSOR' },
    { fundef: 1, processo: '202456010136591', item: 'CADEIRA FIXA EM POLIPROPILENO' },
    { fundef: 1, processo: '202456010136591', item: 'LONGARINA' },
    { fundef: 2, processo: '202656010134023', item: 'CJ. ALUNO CIA TAM 6' },
    { fundef: 2, processo: '202656010134023', item: 'CJ. REFEITÓRIO 8 LUGARES' },
    { fundef: 2, processo: '202656010134023', item: 'ESTANTE ABERTA 4 PRATELEIRAS' },
    { fundef: 2, processo: '202656010134023', item: 'ESTANTE ABERTA 8 PRATELEIRAS' }
];

// Função para buscar e processar as abas da planilha
async function fetchSheet(sheetName) {
    const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheetName)}`;
    const response = await axios.get(url);
    return parse(response.data, { columns: true, skip_empty_lines: true }).map(normalizeRow);
}

// Rota Principal: Renderiza a página (EJS)
app.get('/', (req, res) => {
    res.render('index', { titulo: 'Dashboard Executivo - Móveis Escolares' });
});

// Rota da API: Fornece os dados
app.get('/api/dados', async (req, res) => {
    try {
        const [demandas, entregas, estoque, producao] = await Promise.all([
            fetchSheet('DEMANDAS'),
            fetchSheet('ENTREGAS'),
            fetchSheet('ESTOQUE'),
            fetchSheet('PRODUCAO')
        ]);

        const dashboardData = targets.map(t => ({
            fundef: t.fundef,
            processo: t.processo,
            item: t.item,
            matchKey: sanitizeForMatch(t.processo) + "_" + sanitizeForMatch(t.item),
            preco_orig: 0,
            preco_reaj: 0,
            eventos_producao: [],
            eventos_entrega: [],
            estoque_total: 0
        }));

        const findMatch = (proc, item) => dashboardData.find(d => d.matchKey === (sanitizeForMatch(proc) + "_" + sanitizeForMatch(item)));

        // 1. Aba DEMANDAS: Pega Preços Original e Reajustado
        demandas.forEach(row => {
            const match = findMatch(row.NPROCESSO || row.PROCESSO, row.ITEM || row.PRODUTO || row.DESCRICAO);
            if (match) {
                match.preco_orig = parseNumber(row.PRECOUNITARIO);
                match.preco_reaj = parseNumber(row.PRECOUNITARIOREAJUSTADO || row.PRECOUNITARIO);
            }
        });

        // 2. Aba PRODUCAO: Pega histórico de datas e quantidades
        producao.forEach(row => {
            const match = findMatch(row.PROCESSO || row.NPROCESSO, row.PRODUTO || row.ITEM);
            if(match) {
                match.eventos_producao.push({ data: row.DATA || '01/01/2020', qtd: parseNumber(row.QUANTIDADE || row.TOTAL) });
            }
        });

        // 3. Aba ENTREGAS: Pega histórico de datas e quantidades
        entregas.forEach(row => {
            const match = findMatch(row.NPROCESSO || row.PROCESSO, row.ITEM || row.PRODUTO);
            if(match) {
                match.eventos_entrega.push({ data: row.DATA || '01/01/2020', qtd: parseNumber(row.TOTALENTREGUE || row.QUANTIDADE) });
            }
        });

        // 4. Aba ESTOQUE: Pega total constante
        estoque.forEach(row => {
            const match = findMatch(row.PROCESSO || row.NPROCESSO, row.PRODUTO || row.ITEM);
            if(match) {
                match.estoque_total += parseNumber(row.QUANTIDADEEMESTOQUE || row.QUANTIDADE);
            }
        });

        res.json(dashboardData);
    } catch (error) {
        console.error("Erro ao processar planilhas:", error);
        res.status(500).json({ error: 'Erro ao processar dados da planilha' });
    }
});

// ==========================================
// CONFIGURAÇÃO DE AMBIENTE (LOCAL vs VERCEL)
// ==========================================

// Se NÃO estiver na Vercel (Production), mantém o servidor rodando para testes na sua máquina
if (process.env.NODE_ENV !== 'production') {
    app.listen(port, () => {
        console.log(`\n✅ Servidor rodando! Acesse: http://localhost:${port}\n`);
    });
}

// Exporta o App para a Vercel conseguir executá-lo no ambiente Serverless
module.exports = app;